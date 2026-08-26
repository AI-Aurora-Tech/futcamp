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
// informa nome, CPF e cartão na página do Asaas — o Tabelaço não precisa
// pedir, nem guardar, dado fiscal nem número de cartão de ninguém.
//
// Dois tipos de cobrança:
//
//   • DETACHED  — pagamento único, de um campeonato. É o caso de todo mundo.
//   • RECURRENT — assinatura mensal do plano Diamante, debitada no cartão de
//     crédito todo mês. NÃO é parcelamento: cada mês é uma cobrança de R$ X,
//     e não uma autorização do total, então o limite do cliente fica livre.
//     Exige contrato aceito (`subscriptions`, migration 0037).
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

/**
 * Versão desta função. Vai em toda resposta de erro e no GET de conferência —
 * é assim que se sabe, sem adivinhar, qual código está publicado no Supabase.
 * Suba este número a cada mudança.
 */
export const VERSAO = '6'

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

/**
 * Data no formato que o Asaas espera (YYYY-MM-DD), somando meses ou dias.
 * O ciclo é mensal, então somar mês a mês é o certo — 30 dias erraria o
 * aniversário da cobrança ao longo do ano.
 */
export function emDias(dias: number, base = new Date()): string {
  const d = new Date(base)
  d.setDate(d.getDate() + dias)
  return d.toISOString().slice(0, 10)
}

export function emMeses(meses: number, base = new Date()): string {
  const d = new Date(base)
  const dia = d.getDate()
  d.setMonth(d.getMonth() + meses)
  // Fim de mês: 31/01 + 1 mês vira 03/03 se não corrigir.
  if (d.getDate() < dia) d.setDate(0)
  return d.toISOString().slice(0, 10)
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
 * Ordem de tentativas para o `billingTypes`.
 *
 * O Asaas recusa a cobrança INTEIRA quando uma das formas não está disponível
 * na conta — boleto que depende de aprovação, Pix sem chave cadastrada. Como
 * não dá para saber de fora o que a conta tem, a função tenta a lista
 * completa, depois tira uma forma de cada vez e, por fim, cada uma sozinha.
 * Na prática: a primeira combinação que a conta aceitar é a que vale.
 *
 * A ordem de remoção começa pelo boleto porque é o mais comum de faltar.
 */
export function escadaDeTipos(tipos: string[]): string[][] {
  const combos: string[][] = [tipos]
  for (const fora of ['BOLETO', 'PIX', 'CREDIT_CARD']) {
    if (tipos.includes(fora)) combos.push(tipos.filter((t) => t !== fora))
  }
  for (const unico of ['CREDIT_CARD', 'PIX', 'BOLETO']) {
    if (tipos.includes(unico)) combos.push([unico])
  }

  const vistos = new Set<string>()
  return combos.filter((t) => {
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
  /** Formas usadas na tentativa que valeu (ou na última que falhou). */
  tipos: string[]
  /** Todas as combinações tentadas, para a mensagem de erro fazer sentido. */
  tentadas: string[][]
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
  let ultimo: TentativaCheckout = { ok: false, out: {}, status: 0, motivo: '', tipos: [], tentadas: [] }
  const tentadas: string[][] = []

  for (let i = 0; i < escada.length; i++) {
    const tipos = escada[i]
    tentadas.push(tipos)
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

    if (res.ok) {
      if (i > 0) console.log('asaas-checkout: aceito com', tipos.join(','), '— considere fixar em ASAAS_BILLING_TYPES')
      return { ok: true, out, status: res.status, motivo: '', tipos, tentadas }
    }

    ultimo = { ok: false, out, status: res.status, motivo: motivoAsaas(out, bruto), tipos, tentadas }
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
  negotiated_kind: string | null
  negotiated_months: number | null
}

interface SubRow {
  id: string
  cents: number
  months: number
  status: string
  contract_at: string | null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const key = Deno.env.get('ASAAS_API_KEY')

  // GET = conferência: diz qual versão está publicada e como está configurada,
  // sem revelar nada da chave além de estar (ou não) presente.
  if (req.method === 'GET') {
    return json({
      ok: true,
      versao: VERSAO,
      chave: key ? `${key.slice(0, 10)}…(${key.length} caracteres)` : 'AUSENTE',
      ambiente: key ? asaasBase(Deno.env.get('ASAAS_ENV'), key) : null,
      appUrl: (Deno.env.get('APP_URL') ?? '') || 'AUSENTE',
      formas: escadaDeTipos(tiposDeCobranca(Deno.env.get('ASAAS_BILLING_TYPES'))),
    })
  }

  if (req.method !== 'POST') return json({ error: 'Método não suportado', versao: VERSAO }, 405)

  if (!key) return json({ error: 'ASAAS_API_KEY não configurado', versao: VERSAO }, 500)
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
    return json({ error: 'Corpo inválido', versao: VERSAO }, 400)
  }
  if (!championshipId) return json({ error: 'championshipId é obrigatório', versao: VERSAO }, 400)

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  const { data, error } = await db
    .from('championships')
    .select('id, name, plan, amount_cents, payment_status, categories, owner_id, negotiated_kind, negotiated_months')
    .eq('id', championshipId)
    .maybeSingle()
  if (error) return json({ error: error.message, versao: VERSAO }, 500)

  const champ = data as ChampRow | null
  if (!champ) return json({ error: 'Campeonato não encontrado', versao: VERSAO }, 404)

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
      if (!master) return json({ error: 'Este campeonato é de outro organizador', versao: VERSAO }, 403)
    }
  }

  if (champ.payment_status === 'paid' || champ.payment_status === 'free') {
    return json({ error: 'Este campeonato já está liberado', versao: VERSAO }, 409)
  }

  // Diamante vendido como assinatura: a cobrança é mensal e exige contrato
  // aceito. Sem o aceite não há o que cobrar — e é ele que registra o
  // compromisso dos 12 meses, que o Asaas não sabe representar.
  const mensal = (champ.negotiated_kind ?? '').toLowerCase() === 'mensal'
  let assinatura: SubRow | null = null
  if (mensal) {
    const { data: sub } = await db
      .from('subscriptions')
      .select('id, cents, months, status, contract_at')
      .eq('owner_id', champ.owner_id)
      .in('status', ['pending', 'active', 'overdue'])
      .maybeSingle()
    assinatura = (sub as SubRow | null) ?? null
    if (!assinatura || !assinatura.contract_at) {
      return json({ error: 'O contrato da assinatura ainda não foi aceito.', versao: VERSAO }, 409)
    }
    if (assinatura.status !== 'pending') {
      return json({ error: 'Esta conta já tem uma assinatura ativa.', versao: VERSAO }, 409)
    }
  }

  const cents = mensal ? (assinatura?.cents ?? 0) : (champ.amount_cents ?? 0)
  if (cents <= 0) return json({ error: 'Campeonato sem valor a cobrar', versao: VERSAO }, 409)

  const nCats = Array.isArray(champ.categories) ? champ.categories.length : 1
  const extra = Math.max(0, nCats - 1)
  const descricao = (
    `Campeonato "${champ.name}" · ${nCats} categoria(s)` +
    (extra > 0 ? ` (1 inclusa + ${extra})` : '')
  ).slice(0, 200)

  const meses = Math.max(1, assinatura?.months ?? champ.negotiated_months ?? 12)
  const item = {
    name: nomeItem(champ.plan),
    description: mensal
      ? `Plano Diamante — assinatura mensal (${meses} meses)`.slice(0, 200)
      : descricao,
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
  // Na assinatura o `externalReference` aponta para a CONTA, e não para um
  // campeonato: é a conta que assina, e é ela que precisa ser reencontrada a
  // cada cobrança mensal.
  const corpo: Record<string, unknown> = mensal
    ? {
        chargeTypes: ['RECURRENT'],
        minutesToExpire: 1440,
        externalReference: `owner:${champ.owner_id}`,
        items: [item],
        callback,
        subscription: {
          cycle: 'MONTHLY',
          nextDueDate: emDias(0),
          // O contrato tem prazo: a recorrência termina junto com ele.
          endDate: emMeses(meses),
        },
      }
    : {
        chargeTypes: ['DETACHED'],
        minutesToExpire: 1440,
        externalReference: champ.id,
        items: [item],
        callback,
      }

  // Recorrência é no cartão: não existe assinatura de boleto que o cliente
  // não precise pagar todo mês na mão. A escada de formas fica de fora.
  const tentativa = await criarCheckout(
    fetch,
    base,
    key,
    corpo,
    mensal ? [['CREDIT_CARD']] : escadaDeTipos(tiposDeCobranca(Deno.env.get('ASAAS_BILLING_TYPES'))),
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
    return json(
      {
        error: `Asaas ${tentativa.status}: ${tentativa.motivo}${ajuda}`,
        tentadas: tentativa.tentadas.map((t) => t.join('+')).join(' → '),
        versao: VERSAO,
      },
      502,
    )
  }

  const link = (out?.link ?? out?.url) as string | undefined
  if (!link) {
    console.error('asaas-checkout: resposta sem link', JSON.stringify(out).slice(0, 300))
    return json({ error: 'O Asaas não devolveu o link de pagamento.', versao: VERSAO }, 502)
  }

  // Assinatura: guarda o checkout NELA. É o terceiro caminho para o webhook
  // reencontrar a conta quando a cobrança mensal chegar.
  if (mensal && assinatura) {
    const { error: erroSub } = await db
      .from('subscriptions')
      .update({ checkout_id: String(out.id ?? ''), updated_at: new Date().toISOString() })
      .eq('id', assinatura.id)
    if (erroSub) console.error('asaas-checkout: falha ao vincular o checkout à assinatura', erroSub.message)
  }

  // Guarda a tentativa. É por aqui que o webhook reencontra o campeonato caso
  // o evento não traga o `externalReference`.
  const { error: erroRegistro } = await db.from('payments').upsert(
    {
      championship_id: champ.id,
      provider: 'asaas',
      checkout_id: String(out.id ?? ''),
      amount_cents: cents,
      status: 'pending',
    },
    { onConflict: 'checkout_id' },
  )

  // Falhar aqui não impede o pagamento, mas atrapalharia a confirmação depois —
  // e o motivo mais comum é a migration 0022 não ter sido aplicada.
  if (erroRegistro) {
    console.error(
      'asaas-checkout: NÃO consegui registrar o checkout em payments —',
      erroRegistro.message,
      '— a migration 0022_asaas.sql foi aplicada?',
    )
  }

  // Guarda o checkout TAMBÉM no próprio campeonato, em `payment_ref` (coluna
  // da migration 0021, que certamente existe). Depender só da tabela
  // `payments` deixava o vínculo refém da 0022: sem ela, o registro acima
  // falha calado e o pagamento fica órfão — ninguém consegue reencontrá-lo.
  // Só a service role escreve aqui; o gatilho da 0021 barra o resto.
  const { error: erroVinculo } = await db
    .from('championships')
    .update({ payment_ref: `checkout:${out.id}` })
    .eq('id', champ.id)
    .eq('payment_status', 'pending')
  if (erroVinculo) console.error('asaas-checkout: falha ao gravar o vínculo', erroVinculo.message)

  return json({
    url: link,
    checkoutId: out.id,
    recorrente: mensal,
    formas: tentativa.tipos,
    aviso: erroRegistro ? `checkout não registrado: ${erroRegistro.message}` : undefined,
    versao: VERSAO,
  })
})
