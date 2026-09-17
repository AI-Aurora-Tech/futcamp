// ===========================================================================
// Edge Function: send-whatsapp
//
// Entrega os avisos do Tabelaço aos RESPONSÁVEIS dos times pelo WhatsApp, via
// Evolution API. Faz duas coisas, nesta ordem:
//
//   1. GERA os avisos que dependem do relógio — hoje, o lembrete de 6 horas
//      antes do fim do prazo de inscrição da rodada. Nenhum gatilho de banco
//      dispara sozinho quando o tempo passa, então é aqui que esse aviso nasce
//      (`wa_gerar_lembretes_inscricao`).
//   2. ENTREGA a fila `whatsapp_outbox`: jogo marcado/remarcado, jogo encerrado
//      (com o placar) e o lembrete de inscrição. Cada linha guarda os TIMES; o
//      telefone do responsável (teams.phone) é resolvido aqui, na hora do envio.
//
// Pode ser chamada de duas formas:
//   1. pelo app, logo depois da ação (entrega imediata de "jogo marcado" e
//      "jogo encerrado");
//   2. por um agendamento (Supabase Schedules / pg_cron), que é o que faz o
//      lembrete de inscrição existir — sem relógio, ele nunca sai.
//
// ⚠️ Agende esta função a cada 15 minutos. É a única peça que dispara o
//    lembrete de inscrição, que não nasce do uso do app.
//
// Corpo (opcional): { "championshipId": "<uuid>", "limit": 100 }
//
// Secrets necessários (Supabase → Edge Functions → Secrets):
//   EVOLUTION_API_URL     base da sua Evolution API (ex.: https://evo.seudominio.com)
//   EVOLUTION_API_KEY     a apikey da instância (header `apikey`)
//   EVOLUTION_INSTANCE    o nome da instância conectada ao número do organizador
//   EVOLUTION_COUNTRY_CODE (opcional) DDI para números sem código de país; padrão 55
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (injetados automaticamente)
//
// A Evolution é auto-hospedada: a URL e a instância são suas. O endpoint usado
// é o `POST {EVOLUTION_API_URL}/message/sendText/{EVOLUTION_INSTANCE}` (v2).
// ===========================================================================
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

interface OutboxRow {
  id: number
  championship_id: string
  target_teams: string[] | null
  message: string
}

/**
 * Normaliza um telefone para o formato que a Evolution espera: só dígitos, com
 * DDI. Um número brasileiro salvo sem o país (10 ou 11 dígitos) recebe o DDI;
 * um que já vem com DDI (12–13 dígitos) fica como está. É a mesma régua do link
 * `wa.me` do app (src/lib/whatsapp.ts), só que aplicada no servidor.
 */
function normalizePhone(raw: string, ddi: string): string | null {
  const digits = (raw ?? '').replace(/\D/g, '')
  if (digits.length < 8) return null
  if (digits.length === 10 || digits.length === 11) return ddi + digits
  return digits
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const apiUrl = (Deno.env.get('EVOLUTION_API_URL') ?? '').replace(/\/+$/, '')
  const apiKey = Deno.env.get('EVOLUTION_API_KEY') ?? ''
  const instance = Deno.env.get('EVOLUTION_INSTANCE') ?? ''
  const ddi = (Deno.env.get('EVOLUTION_COUNTRY_CODE') ?? '55').replace(/\D/g, '') || '55'
  if (!apiUrl || !apiKey || !instance) {
    return json(
      { ok: false, error: 'EVOLUTION_API_URL/EVOLUTION_API_KEY/EVOLUTION_INSTANCE não configurados.' },
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
    /* sem corpo: drena tudo que estiver pendente */
  }

  // 1. Avisos que dependem do relógio: o lembrete de 6h antes do prazo de
  //    inscrição. Roda antes de ler a fila para que o que nasceu agora já saia
  //    nesta mesma passada. Falhar aqui não pode impedir a entrega do resto.
  let reminders = 0
  try {
    const { data, error } = await supabase.rpc('wa_gerar_lembretes_inscricao')
    if (error) console.error('wa_gerar_lembretes_inscricao:', error.message)
    else reminders = Number(data) || 0
  } catch (err) {
    console.error('wa_gerar_lembretes_inscricao:', err)
  }

  // 2. Fila pendente.
  let query = supabase
    .from('whatsapp_outbox')
    .select('id,championship_id,target_teams,message')
    .is('sent_at', null)
    .order('created_at')
    .limit(limit)
  if (championshipId) query = query.eq('championship_id', championshipId)

  const { data: pending, error } = await query
  if (error) return json({ ok: false, error: error.message }, 500)
  if (!pending?.length) return json({ ok: true, sent: 0, pending: 0, reminders })

  const sendText = `${apiUrl}/message/sendText/${encodeURIComponent(instance)}`

  let sent = 0
  let failed = 0

  for (const row of pending as OutboxRow[]) {
    // 3. Telefones dos responsáveis deste aviso.
    const { data: teams } = await supabase
      .from('teams')
      .select('id,phone')
      .in('id', row.target_teams ?? [])

    const numbers = Array.from(
      new Set(
        (teams ?? [])
          .map((t) => normalizePhone(t.phone ?? '', ddi))
          .filter((n): n is string => !!n),
      ),
    )

    if (!numbers.length) {
      // Ninguém com telefone válido: não deixa a linha travando a fila para
      // sempre. Marca como enviada com a razão registrada.
      await supabase
        .from('whatsapp_outbox')
        .update({ sent_at: new Date().toISOString(), attempts: 1, last_error: 'sem telefone válido' })
        .eq('id', row.id)
      continue
    }

    let allOk = true
    let lastError: string | null = null

    for (const number of numbers) {
      try {
        const res = await fetch(sendText, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: apiKey },
          body: JSON.stringify({ number, text: row.message }),
        })
        if (res.ok) {
          sent++
        } else {
          allOk = false
          failed++
          lastError = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`
        }
      } catch (err) {
        allOk = false
        failed++
        lastError = String(err).slice(0, 300)
      }
    }

    if (allOk) {
      await supabase
        .from('whatsapp_outbox')
        .update({ sent_at: new Date().toISOString() })
        .eq('id', row.id)
    } else {
      // Deixa na fila para a próxima passada, com o erro registrado. Depois de
      // muitas tentativas, para de tentar — um número que a Evolution recusa
      // toda vez não melhora esperando.
      const attempts = (await supabase
        .from('whatsapp_outbox')
        .select('attempts')
        .eq('id', row.id)
        .single()).data?.attempts ?? 0
      const next = attempts + 1
      await supabase
        .from('whatsapp_outbox')
        .update({
          attempts: next,
          last_error: lastError,
          // 5 tentativas e desiste: marca como "enviada" para sair da fila.
          sent_at: next >= 5 ? new Date().toISOString() : null,
        })
        .eq('id', row.id)
    }
  }

  return json({ ok: true, sent, failed, reminders, processed: pending.length })
})
