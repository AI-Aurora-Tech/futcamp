// ===========================================================================
// Edge Function: whatsapp-evolution
//
// Faz duas coisas, nesta ordem:
//
//   1. GERA os avisos que dependem do relógio — o aviso 18 h antes do prazo
//      final de inscrição (`wa_gerar_prazos`). Nenhum gatilho de banco dispara
//      sozinho quando o tempo passa, então é aqui que esse aviso nasce.
//   2. ENTREGA a fila `whatsapp_outbox` pela Evolution API, respeitando o
//      intervalo de 10 s entre um envio e o outro. O relógio do último envio
//      mora em `whatsapp_throttle`, então os 10 s valem MESMO entre execuções
//      diferentes desta função.
//
// Pode ser chamada de duas formas:
//   1. pelo app, logo depois da ação (agendar, encerrar, cancelar) — entrega o
//      que já dá para entregar agora;
//   2. por um agendamento (Supabase Schedules / pg_cron), que é o que faz o
//      aviso de prazo existir e o que termina de drenar a fila quando ela é
//      grande (10 s × N não cabe numa requisição só).
//
// ⚠️ Agende esta função a cada 1–2 minutos. É a única peça que não é disparada
//    pelo uso do app, e é ela que respeita o ritmo de 10 s.
//
// Corpo (opcional): { "championshipId": "<uuid>", "limit": 100 }
//
// Secrets necessários (Supabase → Edge Functions → Secrets):
//   EVOLUTION_API_URL    base da sua Evolution (ex.: https://evo.suaempresa.com)
//   EVOLUTION_API_KEY    a apikey da instância (fica só no servidor)
//   EVOLUTION_INSTANCE   o nome da instância conectada ao WhatsApp
//   APP_URL              endereço público do app, para os links (opcional)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (injetados automaticamente)
//
// GET responde a própria versão e como está configurada, sem revelar a chave.
// ===========================================================================
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VERSAO = '1'

// Ritmo de envio pedido pelo organizador: 10 s de um envio para o outro.
const INTERVALO_MS = 10_000
// Orçamento de tempo por execução: sobra para o agendamento drenar o resto.
const ORCAMENTO_MS = 110_000

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const APP_URL = (Deno.env.get('APP_URL') ?? 'https://tabelaco.auroratech.app.br').replace(/\/+$/, '')

interface OutboxRow {
  id: number
  championship_id: string
  to_phone: string
  body: string
  attempts: number
}

/** Troca [[LINK]] pelo endereço público do campeonato (rota por hash). */
function comLink(body: string, championshipId: string): string {
  return body.replace(/\[\[LINK\]\]/g, `${APP_URL}/#/c/${championshipId}`)
}

/** Envia UMA mensagem pela Evolution API. Devolve ok + erro legível. */
async function enviar(
  base: string,
  instance: string,
  apikey: string,
  number: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const url = `${base.replace(/\/+$/, '')}/message/sendText/${encodeURIComponent(instance)}`
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey },
      body: JSON.stringify({ number, text }),
    })
    if (resp.ok) return { ok: true }
    const detalhe = (await resp.text()).slice(0, 300)
    return { ok: false, error: `HTTP ${resp.status}: ${detalhe}` }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const base = Deno.env.get('EVOLUTION_API_URL') ?? ''
  const apikey = Deno.env.get('EVOLUTION_API_KEY') ?? ''
  const instance = Deno.env.get('EVOLUTION_INSTANCE') ?? ''

  // GET: diagnóstico. Diz a versão e a configuração, sem vazar a apikey.
  if (req.method === 'GET') {
    return json({
      versao: VERSAO,
      base: base || '(vazio)',
      instancia: instance || '(vazio)',
      apikey: apikey ? `configurada (${apikey.length} caracteres)` : '(vazio)',
      appUrl: APP_URL,
      intervaloSegundos: INTERVALO_MS / 1000,
    })
  }

  if (!base || !apikey || !instance) {
    return json(
      { ok: false, error: 'EVOLUTION_API_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE não configurados.', versao: VERSAO },
      500,
    )
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  let championshipId: string | undefined
  let limit = 100
  try {
    const body = await req.json()
    championshipId = body?.championshipId
    if (Number.isFinite(body?.limit)) limit = Math.min(500, Math.max(1, body.limit))
  } catch {
    /* sem corpo: drena o que estiver pendente */
  }

  // 1. Avisos que dependem do relógio: 18 h antes do prazo de inscrição.
  //    Falhar aqui não pode impedir a entrega do resto.
  let prazos = 0
  try {
    const { data, error } = await supabase.rpc('wa_gerar_prazos')
    if (error) console.error('wa_gerar_prazos:', error.message)
    else prazos = Number(data) || 0
  } catch (err) {
    console.error('wa_gerar_prazos:', err)
  }

  // 2. Fila pendente, mais antiga primeiro.
  let query = supabase
    .from('whatsapp_outbox')
    .select('id,championship_id,to_phone,body,attempts')
    .is('sent_at', null)
    .order('created_at')
    .limit(limit)
  if (championshipId) query = query.eq('championship_id', championshipId)

  const { data: pending, error } = await query
  if (error) return json({ ok: false, error: error.message, versao: VERSAO }, 500)
  if (!pending?.length) return json({ ok: true, sent: 0, pending: 0, prazos, versao: VERSAO })

  // Relógio do último envio: os 10 s valem entre execuções diferentes.
  const { data: throttle } = await supabase
    .from('whatsapp_throttle')
    .select('last_sent_at')
    .eq('id', true)
    .maybeSingle()
  let lastSent = throttle?.last_sent_at ? new Date(throttle.last_sent_at).getTime() : 0

  const iniciou = Date.now()
  let sent = 0
  let failed = 0
  let dropped = 0

  for (const row of pending as OutboxRow[]) {
    // Respeita os 10 s desde o último envio (de qualquer execução).
    const espera = INTERVALO_MS - (Date.now() - lastSent)
    if (espera > 0) {
      // Se esperar estouraria o orçamento, para: o resto sai no próximo
      // agendamento, sem nunca enviar dois em menos de 10 s.
      if (Date.now() - iniciou + espera > ORCAMENTO_MS) break
      await sleep(espera)
    }

    const r = await enviar(base, instance, apikey, row.to_phone, comLink(row.body, row.championship_id))
    const agora = new Date()
    lastSent = agora.getTime()
    await supabase.from('whatsapp_throttle').update({ last_sent_at: agora.toISOString() }).eq('id', true)

    if (r.ok) {
      await supabase.from('whatsapp_outbox').update({ sent_at: agora.toISOString() }).eq('id', row.id)
      sent++
    } else {
      const attempts = (row.attempts ?? 0) + 1
      // Depois de 5 tentativas, desiste dessa mensagem para não travar a fila.
      const desiste = attempts >= 5
      await supabase
        .from('whatsapp_outbox')
        .update({
          attempts,
          last_error: r.error?.slice(0, 500) ?? 'erro',
          sent_at: desiste ? agora.toISOString() : null,
        })
        .eq('id', row.id)
      if (desiste) dropped++
      failed++
    }

    if (Date.now() - iniciou > ORCAMENTO_MS) break
  }

  return json({ ok: true, sent, failed, dropped, prazos, processed: pending.length, versao: VERSAO })
})
