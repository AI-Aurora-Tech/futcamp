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
//   ASAAS_BILLING_TYPES  (opcional) formas aceitas, separadas por vírgula
//                        (padrão: PIX,BOLETO,CREDIT_CARD)
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

/**
 * Nome do item na cobrança. O Asaas aceita no máximo **30 caracteres** aqui —
 * o nome do campeonato vai na descrição, que é folgada.
 */
export function nomeItem(plan: string | null): string {
  const p = (plan ?? 'pago').trim()
  const tier = p.charAt(0).toUpperCase() + p.slice(1)
  return `Tabelaço — Plano ${tier}`.slice(0, 30)
}

/** Formas de pagamento aceitas (secret `ASAAS_BILLING_TYPES` sobrescreve). */
export function tiposDeCobranca(env: string | undefined): string[] {
  const tipos = (env ?? 'PIX,BOLETO,CREDIT_CARD')
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)
  return tipos.length ? [...new Set(tipos)] : ['CREDIT_CARD']
}

/**
 * Ordem de tentativas. Conta sem chave Pix cadastrada recusa a cobrança
 * inteira — em vez de travar o organizador, a função tenta de novo sem o Pix.
 */
export function escadaDeTipos(tipos: string[]): string[][] {
  const semPix = tipos.filter((t) => t !== 'PIX')
  const escada = [tipos, semPix, ['CREDIT_CARD']]
  const vistos = new Set<string>()
  return escada.filter((t) => {
    const k = t.join(',')
    if (!t.length || vistos.has(k)) return false
    vistos.add(k)
    return true
  })
}

/** A recusa é por forma de pagamento indisponível (vale tentar sem ela)? */
export function ehRecusaDeTipo(motivo: string): boolean {
  return /pix|billingtypes|forma de (pagamento|cobran)/i.test(motivo)
}

/** Junta os `errors: [{ code, description }]` que o Asaas devolve. */
export function motivoAsaas(out: Record<string, unknown>, bruto: string): string {
  const erros = Array.isArray(out?.errors)
    ? (out.errors as { code?: unknown; description?: unknown }[])
        .map((e) => [e?.code, e?.description].filter(Boolean).join(': '))
        .filter(Boolean)
        .join(' | ')
    : ''
  return erros || bruto.slice(0, 300) || 'O Asaas recusou a cobrança'
}

export interface TentativaCheckout {
  ok: boolean
  out: Record<string, unknown>
  status: number
  motivo: string
  tipos: string[]
}

/**
 * Cria o checkout tentando as formas de pagamento em ordem. Recebe o `fetch`
 * por parâmetro para dar para testar sem rede.
 */
export async function criarCheckout(
  buscar: typeof fetch,
  base: string,
  key: string,
  corpo: Record<string, unknown>,
  escada: string[][],
): Promise<TentativaCheckout> {
  let ultimo: TentativaCheckout = { ok: false, out: {}, status: 0, motivo: '', tipos: [] }

  for (let i = 0; i < escada.length; i++) {
    const tipos = escada[i]
    const res = await buscar(`${base}/checkouts`, {
      method: 'POST',
      headers: { access_token: key, 'Content-Type': 'application/json', 'User-Agent': 'Tabelaco' },
      body: JSON.stringify({ ...corpo, billingTypes: tipos }),
    })

    const bruto = await res.text()
    let out: Record<string, unknown> = {}
    try {
      out = JSON.parse(bruto)
    } catch {
      out = {}
    }

    if (res.ok) return { ok: true, out, status: res.status, motivo: '', tipos }

    ultimo = { ok: false, out, status: res.status, motivo: motivoAsaas(out, bruto), tipos }
    console.error('asaas-checkout: checkout recusado', res.status, tipos.join(','), bruto)

    // Só insiste quando a recusa foi pela forma de pagamento (ex.: conta sem
    // chave Pix). Qualquer outro erro para aqui.
    if (!ehRecusaDeTipo(ultimo.motivo)) return ultimo
    if (i < escada.length - 1) console.log('asaas-checkout: tentando sem', tipos.join(','))
  }

  return ultimo
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
  const descricao = (
    `Campeonato "${champ.name}" · ${nCats} categoria(s)` +
    (extra > 0 ? ` (1 inclusa + ${extra})` : '')
  ).slice(0, 200)

  const item = {
    name: nomeItem(champ.plan),
    description: descricao,
    quantity: 1,
    value: Number((cents / 100).toFixed(2)),
  }

  const callback = podeVoltar
    ? {
        successUrl: `${appUrl}/#/pagamento/${champ.id}?status=sucesso`,
        cancelUrl: `${appUrl}/#/pagamento/${champ.id}?status=falha`,
        expiredUrl: `${appUrl}/#/pagamento/${champ.id}?status=pendente`,
      }
    : undefined

  // `externalReference` é o que amarra o pagamento ao campeonato quando o
  // webhook chegar.
  const tentativa = await criarCheckout(
    fetch,
    base,
    key,
    {
      chargeTypes: ['DETACHED'],
      minutesToExpire: 1440,
      externalReference: champ.id,
      items: [item],
      callback,
    },
    escadaDeTipos(tiposDeCobranca(Deno.env.get('ASAAS_BILLING_TYPES'))),
  )

  const out = tentativa.out
  if (!tentativa.ok) {
    const ajuda =
      tentativa.status === 401
        ? ' (a ASAAS_API_KEY parece inválida ou é de outro ambiente — confira ASAAS_ENV)'
        : /callback|url/i.test(tentativa.motivo)
          ? ' (confira o secret APP_URL — precisa ser o endereço https do app)'
          : /pix/i.test(tentativa.motivo)
            ? ' (cadastre uma chave Pix no Asaas ou ajuste o secret ASAAS_BILLING_TYPES)'
            : ''
    return json({ error: `Asaas ${tentativa.status}: ${tentativa.motivo}${ajuda}` }, 502)
  }

  const link = (out?.link ?? out?.url) as string | undefined
  if (!link) {
    console.error('asaas-checkout: resposta sem link', JSON.stringify(out).slice(0, 300))
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
