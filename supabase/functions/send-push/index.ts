// ===========================================================================
// Edge Function: send-push
//
// Faz duas coisas, nesta ordem:
//
//   1. GERA os avisos que dependem do relógio — hoje, o lembrete de 2 dias
//      antes do jogo. Nenhum gatilho de banco dispara sozinho quando o tempo
//      passa, então é aqui que esse aviso nasce (`push_gerar_lembretes`).
//   2. ENTREGA a fila `push_outbox` por Web Push (VAPID): jogo marcado,
//      lembrete, gol, suspensão, resultado, resumo da partida, classificação
//      da rodada e as alterações de elenco que vão para o organizador.
//
// Pode ser chamada de duas formas:
//   1. pelo app, logo depois da ação (entrega imediata);
//   2. por um agendamento (Supabase Schedules / pg_cron), que é o que faz o
//      lembrete de 2 dias existir — sem relógio, ele nunca sai.
//
// ⚠️ Agende esta função a cada 15 minutos. É a única peça do sistema de
//    avisos que não é disparada pelo uso do app.
//
// Corpo (opcional): { "championshipId": "<uuid>", "limit": 100 }
//
// Secrets necessários (Supabase → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY    chave pública VAPID (a mesma de VITE_VAPID_PUBLIC_KEY)
//   VAPID_PRIVATE_KEY   chave privada VAPID
//   VAPID_SUBJECT       "mailto:voce@exemplo.com" (contato do responsável)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (injetados automaticamente)
//
// Gere o par de chaves com:  npx web-push generate-vapid-keys
// ===========================================================================
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

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
  audience: 'organizer' | 'team'
  target_teams: string[] | null
  title: string
  body: string
  url: string | null
}

interface SubRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  role: 'organizer' | 'team'
  team_id: string | null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contato@tabelaco.app'
  if (!publicKey || !privateKey) {
    return json({ ok: false, error: 'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configurados.' }, 500)
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)

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

  // 1. Avisos que dependem do relógio: o lembrete de 2 dias antes do jogo.
  //    Roda antes de ler a fila para que o que nasceu agora já saia nesta
  //    mesma passada. Falhar aqui não pode impedir a entrega do resto.
  let reminders = 0
  try {
    const { data, error: remErr } = await supabase.rpc('push_gerar_lembretes')
    if (remErr) console.error('push_gerar_lembretes:', remErr.message)
    else reminders = Number(data) || 0
  } catch (err) {
    console.error('push_gerar_lembretes:', err)
  }

  // 2. Fila pendente.
  let query = supabase
    .from('push_outbox')
    .select('*')
    .is('sent_at', null)
    .order('created_at')
    .limit(limit)
  if (championshipId) query = query.eq('championship_id', championshipId)

  const { data: pending, error } = await query
  if (error) return json({ ok: false, error: error.message }, 500)
  if (!pending?.length) return json({ ok: true, sent: 0, pending: 0, reminders })

  let sent = 0
  let failed = 0
  const goneEndpoints: string[] = []

  for (const row of pending as OutboxRow[]) {
    // 3. Destinatários deste aviso.
    let subQuery = supabase
      .from('push_subscriptions')
      .select('id,endpoint,p256dh,auth,role,team_id')
      .eq('championship_id', row.championship_id)
      .eq('role', row.audience)
    if (row.audience === 'team' && row.target_teams?.length) {
      subQuery = subQuery.in('team_id', row.target_teams)
    }
    const { data: subs } = await subQuery

    const payload = JSON.stringify({
      title: row.title,
      body: row.body,
      url: row.url ?? '/',
      tag: `tabelaco-${row.championship_id}-${row.audience}`,
    })

    for (const s of (subs ?? []) as SubRow[]) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        )
        sent++
      } catch (err) {
        failed++
        // 404/410 = inscrição morta (usuário removeu o app / revogou).
        const status = (err as { statusCode?: number })?.statusCode
        if (status === 404 || status === 410) goneEndpoints.push(s.endpoint)
      }
    }

    await supabase.from('push_outbox').update({ sent_at: new Date().toISOString() }).eq('id', row.id)
  }

  // 4. Limpa inscrições mortas.
  if (goneEndpoints.length) {
    await supabase.from('push_subscriptions').delete().in('endpoint', goneEndpoints)
  }

  return json({ ok: true, sent, failed, reminders, processed: pending.length })
})
