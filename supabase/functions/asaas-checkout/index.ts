// ===========================================================================
// Edge Function: asaas-checkout
//
// Gera o link de pagamento do campeonato no Asaas (Checkout hospedado).
//
// Quem chama é o app, logo depois de criar o campeonato. O valor NÃO vem do
// navegador: a função lê `amount_cents` do banco, que foi calculado pelo
// gatilho `set_championship_price` (migration 0021) a partir do plano e do
// número de categorias. Assim ninguém consegue pagar menos mexendo no cliente.
//
// Usa o Checkout (e não a cobrança direta) porque nele o próprio pagador
// informa nome e CPF na página do Asaas — o Tabelaço não precisa pedir, nem
// guardar, dado fiscal de ninguém.
//
// Corpo: { "championshipId": "<uuid>" }
// Resposta: { "url": "https://www.asaas.com/checkoutSession/show/..." }
//
// Secrets (Supabase → Edge Functions → Secrets):
//   ASAAS_API_KEY   chave de API do Asaas ($aact_...)
//   ASAAS_ENV       "sandbox" para testar; qualquer outra coisa = produção
//   APP_URL         endereço https do app, p/ voltar depois do pagamento
//                   (ex.: https://tabelaco.auroratech.app.br)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (injetados automaticamente)
//
// Publique com --no-verify-jwt:
//   supabase functions deploy asaas-checkout --no-verify-jwt
//
// A conferência de quem chamou é feita AQUI DENTRO (`db.auth.getUser`), não no
// portão do Supabase: o portão devolve 401 "Invalid credentials" sem explicar
// nada quando a chave do projeto é do formato novo (sb_publishable_...) ou
// quando as chaves legadas foram desativadas.
//
// A chave fica SÓ aqui. Nunca em `src/`, nunca com prefixo VITE_.
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

/** Produção ou sandbox. A chave de homologação traz "hmlg" no meio. */
export function asaasBase(env: string | undefined, key: string): string {
  const sandbox = (env ?? '').toLowerCase() === 'sandbox' || /hmlg/i.test(key)
  return sandbox ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3'
}

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

  const key = Deno.env.get('ASAAS_API_KEY')
  if (!key) return json({ error: 'ASAAS_API_KEY não configurado' }, 500)
  const base = asaasBase(Deno.env.get('ASAAS_ENV'), key)

  // O Asaas só aceita callback com endereço https público — com http,
  // localhost ou APP_URL vazio, a volta automática é omitida.
  const appUrl = (Deno.env.get('APP_URL') ?? '').trim().replace(/\/+$/, '')
  const podeVoltar = /^https:\/\//i.test(appUrl) && !/localhost|127\.0\.0\.1/i.test(appUrl)

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

  // Quem chamou? Se veio uma sessão válida, ela precisa ser do dono do
  // campeonato (ou de um master). Sem sessão reconhecível a cobrança segue: o
  // link só permite PAGAR por este campeonato — não abre nada nem revela dado
  // que a página pública já não mostre.
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (jwt) {
    const { data: quem } = await db.auth.getUser(jwt)
    const user = quem?.user
    if (user && user.id !== champ.owner_id) {
      const email = (user.email ?? '').toLowerCase()
      const { data: master } = await db
        .from('master_admins')
        .select('email')
        .ilike('email', email)
        .maybeSingle()
      if (!master) return json({ error: 'Este campeonato é de outro organizador' }, 403)
    }
  }

  if (champ.payment_status === 'paid' || champ.payment_status === 'free') {
    return json({ error: 'Este campeonato já está liberado' }, 409)
  }

  const cents = champ.amount_cents ?? 0
  if (cents <= 0) return json({ error: 'Campeonato sem valor a cobrar' }, 409)

  const nCats = Array.isArray(champ.categories) ? champ.categories.length : 1
  const extra = Math.max(0, nCats - 1)
  const nome =
    `Tabelaço — ${champ.name} · plano ${champ.plan ?? 'pago'}` +
    (extra > 0 ? ` + ${extra} categoria(s)` : '')

  // `externalReference` é o que amarra o pagamento ao campeonato quando o
  // webhook chegar. O valor vai em reais, com dois decimais.
  const checkout = {
    billingTypes: ['PIX', 'BOLETO', 'CREDIT_CARD'],
    chargeTypes: ['DETACHED'],
    minutesToExpire: 1440,
    externalReference: champ.id,
    items: [
      {
        name: nome.slice(0, 100),
        description: `Campeonato "${champ.name}" com ${nCats} categoria(s)`.slice(0, 500),
        quantity: 1,
        value: Number((cents / 100).toFixed(2)),
      },
    ],
    callback: podeVoltar
      ? {
          successUrl: `${appUrl}/#/pagamento/${champ.id}?status=sucesso`,
          cancelUrl: `${appUrl}/#/pagamento/${champ.id}?status=falha`,
          expiredUrl: `${appUrl}/#/pagamento/${champ.id}?status=pendente`,
        }
      : undefined,
  }

  const res = await fetch(`${base}/checkouts`, {
    method: 'POST',
    headers: {
      access_token: key,
      'Content-Type': 'application/json',
      'User-Agent': 'Tabelaco',
    },
    body: JSON.stringify(checkout),
  })

  const bruto = await res.text()
  let out: Record<string, unknown> = {}
  try {
    out = JSON.parse(bruto)
  } catch {
    out = {}
  }

  if (!res.ok) {
    // O Asaas devolve os problemas em `errors: [{ code, description }]` — é
    // ali que ele diz qual campo recusou.
    const erros = Array.isArray(out?.errors)
      ? (out.errors as { code?: unknown; description?: unknown }[])
          .map((e) => [e?.code, e?.description].filter(Boolean).join(': '))
          .filter(Boolean)
          .join(' | ')
      : ''
    const motivo = erros || bruto.slice(0, 300) || 'O Asaas recusou a cobrança'
    console.error('asaas-checkout: checkout recusado', res.status, bruto)
    const ajuda =
      res.status === 401
        ? ' (a ASAAS_API_KEY parece inválida ou é de outro ambiente — confira ASAAS_ENV)'
        : /callback|url/i.test(motivo)
          ? ' (confira o secret APP_URL — precisa ser o endereço https do app)'
          : ''
    return json({ error: `Asaas ${res.status}: ${motivo}${ajuda}` }, 502)
  }

  const link = (out?.link ?? out?.url) as string | undefined
  if (!link) {
    console.error('asaas-checkout: resposta sem link', bruto)
    return json({ error: 'O Asaas não devolveu o link de pagamento.' }, 502)
  }

  // Guarda a tentativa. É por aqui que o webhook reencontra o campeonato caso
  // o evento não traga o `externalReference`.
  await db.from('payments').upsert(
    {
      championship_id: champ.id,
      provider: 'asaas',
      checkout_id: String(out.id ?? ''),
      amount_cents: cents,
      status: 'pending',
    },
    { onConflict: 'checkout_id' },
  )

  return json({ url: link, checkoutId: out.id })
})
