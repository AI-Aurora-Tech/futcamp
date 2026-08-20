// ===========================================================================
// Edge Function: mp-checkout
//
// Gera o link de pagamento do campeonato no Mercado Pago (Checkout Pro).
//
// Quem chama é o app, logo depois de criar o campeonato. O valor NÃO vem do
// navegador: a função lê `amount_cents` do banco, que foi calculado pelo
// gatilho `set_championship_price` (migration 0021) a partir do plano e do
// número de categorias. Assim ninguém consegue pagar menos mexendo no cliente.
//
// Corpo: { "championshipId": "<uuid>" }
// Resposta: { "url": "https://www.mercadopago.com.br/checkout/..." }
//
// Secrets (Supabase → Edge Functions → Secrets):
//   MP_ACCESS_TOKEN   token de PRODUÇÃO do Mercado Pago (APP_USR-...)
//   APP_URL           endereço do app, p/ voltar depois do pagamento
//                     (ex.: https://futcamp.vercel.app)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (injetados automaticamente)
//
// O token fica SÓ aqui. Nunca em `src/`, nunca com prefixo VITE_.
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

interface ChampRow {
  id: string
  name: string
  plan: string | null
  amount_cents: number | null
  payment_status: string | null
  categories: { id: string; name: string }[] | null
  owner_id: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não suportado' }, 405)

  const token = Deno.env.get('MP_ACCESS_TOKEN')
  if (!token) return json({ error: 'MP_ACCESS_TOKEN não configurado' }, 500)

  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/+$/, '')

  let championshipId = ''
  try {
    const body = await req.json()
    championshipId = String(body?.championshipId ?? '')
  } catch {
    return json({ error: 'Corpo inválido' }, 400)
  }
  if (!championshipId) return json({ error: 'championshipId é obrigatório' }, 400)

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  const { data, error } = await db
    .from('championships')
    .select('id, name, plan, amount_cents, payment_status, categories, owner_id')
    .eq('id', championshipId)
    .maybeSingle()
  if (error) return json({ error: error.message }, 500)

  const champ = data as ChampRow | null
  if (!champ) return json({ error: 'Campeonato não encontrado' }, 404)
  if (champ.payment_status === 'paid' || champ.payment_status === 'free') {
    return json({ error: 'Este campeonato já está liberado' }, 409)
  }

  const cents = champ.amount_cents ?? 0
  if (cents <= 0) return json({ error: 'Campeonato sem valor a cobrar' }, 409)

  const nCats = Array.isArray(champ.categories) ? champ.categories.length : 1
  const extra = Math.max(0, nCats - 1)
  const title =
    `Tabelaço — ${champ.name} · plano ${champ.plan ?? 'pago'}` +
    (extra > 0 ? ` + ${extra} categoria(s)` : '')

  // Uma preferência por campeonato. `external_reference` é o que amarra o
  // pagamento ao campeonato quando o webhook chegar.
  const pref = {
    items: [
      {
        id: champ.id,
        title,
        description: `Campeonato "${champ.name}" com ${nCats} categoria(s)`,
        quantity: 1,
        currency_id: 'BRL',
        unit_price: Number((cents / 100).toFixed(2)),
      },
    ],
    external_reference: champ.id,
    statement_descriptor: 'TABELACO',
    metadata: { championship_id: champ.id, owner_id: champ.owner_id, plan: champ.plan },
    back_urls: appUrl
      ? {
          success: `${appUrl}/#/pagamento/${champ.id}?status=sucesso`,
          pending: `${appUrl}/#/pagamento/${champ.id}?status=pendente`,
          failure: `${appUrl}/#/pagamento/${champ.id}?status=falha`,
        }
      : undefined,
    auto_return: appUrl ? 'approved' : undefined,
    notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/mp-webhook`,
  }

  const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Evita preferência duplicada se o organizador clicar duas vezes.
      'X-Idempotency-Key': `champ-${champ.id}-${cents}`,
    },
    body: JSON.stringify(pref),
  })

  const out = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error('mp-checkout: preferência recusada', res.status, out)
    return json({ error: out?.message ?? 'O Mercado Pago recusou a cobrança' }, 502)
  }

  // Registra a tentativa (útil para conferir depois).
  await db.from('payments').upsert(
    {
      championship_id: champ.id,
      preference_id: out.id,
      amount_cents: cents,
      status: 'pending',
    },
    { onConflict: 'preference_id' },
  )

  return json({ url: out.init_point ?? out.sandbox_init_point, preferenceId: out.id })
})
