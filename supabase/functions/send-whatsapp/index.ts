// ===========================================================================
// Edge Function: send-whatsapp  (versão simples)
//
// Entrega os avisos do Tabelaço aos RESPONSÁVEIS dos times pelo WhatsApp, via
// Evolution API. Só isso — o lembrete de inscrição foi removido.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   EVOLUTION_API_URL    base da Evolution (ex.: https://evo.seudominio.com)
//   EVOLUTION_API_KEY    apikey da instância (header `apikey`)
//   EVOLUTION_INSTANCE   nome da instância conectada ao WhatsApp
//   (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY são injetados automaticamente)
//
// Modos:
//   GET  → diz a configuração (sem vazar a chave).
//   POST {"test":true,"to":"5511999998888","text":"oi"} → envia UMA mensagem e
//          devolve a RESPOSTA CRUA da Evolution (status + corpo). Serve para
//          descobrir por que uma mensagem "aceita" não é entregue.
//   POST {"championshipId":"..."} (ou {}) → drena a fila whatsapp_outbox,
//          respeitando 10 s entre um envio e o outro.
// ===========================================================================
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VERSAO = 'simples-1'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const DELAY_MS = 10_000       // 10 s entre um envio e o outro
const ORCAMENTO_MS = 110_000  // teto de tempo por execução

interface OutboxRow {
  id: number
  championship_id: string
  target_teams: string[] | null
  message: string
  attempts: number
}

/** Número só com dígitos, com DDI. BR sem país (10/11 díg.) ganha 55. */
function normalizePhone(raw: string): string | null {
  const d = (raw ?? '').replace(/\D/g, '')
  if (d.length < 8) return null
  if (d.length === 10 || d.length === 11) return '55' + d
  return d
}

/** Envia texto pela Evolution. Devolve status + corpo (para diagnóstico). */
async function enviar(base: string, instance: string, apikey: string, number: string, text: string) {
  const url = `${base.replace(/\/+$/, '')}/message/sendText/${encodeURIComponent(instance)}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey },
    body: JSON.stringify({ number, text }),
  })
  const corpo = (await resp.text()).slice(0, 500)
  return { ok: resp.ok, status: resp.status, corpo }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const base = (Deno.env.get('EVOLUTION_API_URL') ?? '').replace(/\/+$/, '')
  const apikey = Deno.env.get('EVOLUTION_API_KEY') ?? ''
  const instance = Deno.env.get('EVOLUTION_INSTANCE') ?? ''

  if (req.method === 'GET') {
    return json({
      versao: VERSAO,
      base: base || '(vazio)',
      instancia: instance || '(vazio)',
      apikey: apikey ? `configurada (${apikey.length} caracteres)` : '(vazio)',
    })
  }

  if (!base || !apikey || !instance) {
    return json({ ok: false, error: 'EVOLUTION_API_URL/EVOLUTION_API_KEY/EVOLUTION_INSTANCE não configurados.', versao: VERSAO }, 500)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  let championshipId: string | undefined
  let teste: { to?: string; text?: string } | null = null
  try {
    const b = await req.json()
    championshipId = b?.championshipId
    if (b?.test) teste = { to: b?.to, text: b?.text }
  } catch { /* sem corpo: drena tudo */ }

  // --- MODO TESTE: envia 1 mensagem e devolve a resposta crua da Evolution ---
  if (teste) {
    const to = normalizePhone(String(teste.to ?? ''))
    if (!to) return json({ ok: false, error: 'Informe "to" (telefone com DDI).', versao: VERSAO }, 400)
    const r = await enviar(base, instance, apikey, to, teste.text || 'Teste do Tabelaço ✅')
    return json({ ok: r.ok, to, status: r.status, resposta: r.corpo, versao: VERSAO }, r.ok ? 200 : 502)
  }

  // --- DRENAR A FILA ---
  let q = supabase
    .from('whatsapp_outbox')
    .select('id,championship_id,target_teams,message,attempts')
    .is('sent_at', null)
    .order('created_at')
    .limit(100)
  if (championshipId) q = q.eq('championship_id', championshipId)

  const { data: pending, error } = await q
  if (error) return json({ ok: false, error: error.message, versao: VERSAO }, 500)
  if (!pending?.length) return json({ ok: true, sent: 0, pending: 0, versao: VERSAO })

  // Logo (emoji) do campeonato: troca a 🏆 no início. Imagem é ignorada (mantém 🏆).
  // notify_whatsapp: número do ORGANIZADOR que recebe cópia de cada aviso.
  const champIds = Array.from(new Set((pending as OutboxRow[]).map((r) => r.championship_id)))
  const { data: champs } = await supabase
    .from('championships')
    .select('id,logo,notify_whatsapp')
    .in('id', champIds)
  const logoOf = new Map<string, string | null>((champs ?? []).map((c) => [c.id, c.logo ?? null]))
  const orgOf = new Map<string, string | null>((champs ?? []).map((c) => [c.id, c.notify_whatsapp ?? null]))

  const iniciou = Date.now()
  let sent = 0, failed = 0, first = true

  for (const row of pending as OutboxRow[]) {
    const { data: teams } = await supabase.from('teams').select('id,phone').in('id', row.target_teams ?? [])
    const numbers = Array.from(new Set([
      ...(teams ?? []).map((t) => normalizePhone(t.phone ?? '')),
      normalizePhone(orgOf.get(row.championship_id) ?? ''), // cópia para o organizador
    ].filter((n): n is string => !!n)))

    if (!numbers.length) {
      await supabase.from('whatsapp_outbox')
        .update({ sent_at: new Date().toISOString(), attempts: (row.attempts ?? 0) + 1, last_error: 'sem telefone válido' })
        .eq('id', row.id)
      continue
    }

    const logo = logoOf.get(row.championship_id) ?? null
    const isEmoji = !!logo && !logo.startsWith('data:') && !logo.startsWith('http')
    const text = isEmoji ? row.message.replace('🏆', logo!) : row.message

    let ok = true
    let err: string | null = null
    for (const number of numbers) {
      if (!first) {
        if (Date.now() - iniciou + DELAY_MS > ORCAMENTO_MS) { ok = false; err = 'orçamento de tempo: resto fica pendente'; break }
        await sleep(DELAY_MS)
      }
      first = false
      try {
        const r = await enviar(base, instance, apikey, number, text)
        if (r.ok) sent++
        else { ok = false; failed++; err = `HTTP ${r.status}: ${r.corpo}` }
      } catch (e) { ok = false; failed++; err = String(e).slice(0, 400) }
    }

    if (ok) {
      await supabase.from('whatsapp_outbox').update({ sent_at: new Date().toISOString() }).eq('id', row.id)
    } else {
      const next = (row.attempts ?? 0) + 1
      await supabase.from('whatsapp_outbox')
        .update({ attempts: next, last_error: err, sent_at: next >= 5 ? new Date().toISOString() : null })
        .eq('id', row.id)
    }
    if (Date.now() - iniciou > ORCAMENTO_MS) break
  }

  return json({ ok: true, sent, failed, processed: pending.length, versao: VERSAO })
})
