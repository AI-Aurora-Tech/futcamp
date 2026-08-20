// ===========================================================================
// Edge Function: mp-webhook
//
// Recebe a notificação do Mercado Pago e LIBERA o campeonato quando o
// pagamento é aprovado.
//
// O corpo da notificação não é confiável: ele só diz "olhe o pagamento X".
// Por isso a função consulta o pagamento na API do Mercado Pago com o
// ACCESS TOKEN e decide pelo que a API responde — nunca pelo que chegou.
//
// Secrets:
//   MP_ACCESS_TOKEN   token de PRODUÇÃO do Mercado Pago (APP_USR-...)
//   MP_WEBHOOK_SECRET (opcional) assinatura configurada no painel do MP
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (injetados automaticamente)
//
// Publique com --no-verify-jwt (o Mercado Pago não manda token do Supabase):
//   supabase functions deploy mp-webhook --no-verify-jwt
// ===========================================================================
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Tira o id do pagamento das várias formas que o Mercado Pago notifica. */
function paymentIdFrom(url: URL, body: Record<string, unknown>): string | null {
  const q = url.searchParams
  const fromQuery = q.get('data.id') ?? q.get('id')
  if (fromQuery) return fromQuery
  const data = body?.data as { id?: string | number } | undefined
  if (data?.id) return String(data.id)
  if (body?.resource && typeof body.resource === 'string') {
    const m = body.resource.match(/(\d+)\s*$/)
    if (m) return m[1]
  }
  return null
}

serve(async (req) => {
  // O Mercado Pago reenvia a notificação se não receber 200 rápido; por isso
  // qualquer situação "sem o que fazer" também responde 200.
  if (req.method !== 'POST') return json({ ok: true, skipped: 'method' })

  const token = Deno.env.get('MP_ACCESS_TOKEN')
  if (!token) {
    console.error('mp-webhook: MP_ACCESS_TOKEN ausente')
    return json({ ok: false }, 500)
  }

  const url = new URL(req.url)
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const topic = url.searchParams.get('type') ?? url.searchParams.get('topic') ?? String(body?.type ?? '')
  if (topic && !topic.includes('payment')) return json({ ok: true, skipped: topic })

  const paymentId = paymentIdFrom(url, body)
  if (!paymentId) return json({ ok: true, skipped: 'sem id' })

  // Fonte da verdade: a própria API do Mercado Pago.
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    console.error('mp-webhook: pagamento não consultado', paymentId, res.status)
    return json({ ok: false }, 502)
  }
  const pay = await res.json()

  const champId: string | undefined = pay.external_reference ?? pay.metadata?.championship_id
  if (!champId) return json({ ok: true, skipped: 'sem external_reference' })

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  const cents = Math.round(Number(pay.transaction_amount ?? 0) * 100)

  await db.from('payments').upsert(
    {
      championship_id: champId,
      payment_id: String(pay.id),
      preference_id: pay.order?.id ? String(pay.order.id) : null,
      amount_cents: cents,
      status: pay.status,
      raw: pay,
    },
    { onConflict: 'payment_id' },
  )

  if (pay.status !== 'approved') {
    return json({ ok: true, status: pay.status })
  }

  // Confere o valor: só libera se pagou pelo menos o que era devido.
  const { data: champ } = await db
    .from('championships')
    .select('id, amount_cents, payment_status')
    .eq('id', champId)
    .maybeSingle()
  if (!champ) return json({ ok: true, skipped: 'campeonato inexistente' })
  if (champ.payment_status === 'paid') return json({ ok: true, status: 'já liberado' })

  const devido = champ.amount_cents ?? 0
  if (cents + 1 < devido) {
    console.error('mp-webhook: valor menor que o devido', { champId, cents, devido })
    return json({ ok: true, status: 'valor insuficiente' })
  }

  const { error } = await db.rpc('mark_championship_paid', {
    p_champ: champId,
    p_payment_ref: String(pay.id),
  })
  if (error) {
    console.error('mp-webhook: falha ao liberar', error.message)
    return json({ ok: false }, 500)
  }

  return json({ ok: true, status: 'liberado' })
})
