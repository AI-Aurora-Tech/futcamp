// ===========================================================================
// Edge Function: asaas-status
//
// Pergunta ao Asaas se o campeonato já foi pago — e libera se já foi.
//
// Por que existe: a liberação normal vem do webhook, mas webhook é frágil por
// natureza (não configurado, evento não marcado, entrega perdida, conta em
// fila). Sem isto, o organizador que pagou fica travado e sem saída. Aqui o
// botão "Já paguei" deixa de ser um F5 no banco e passa a ser uma pergunta de
// verdade ao Asaas.
//
// A regra de segurança é a mesma do webhook: quem decide é a API do Asaas,
// consultada com a chave do servidor. O app nunca diz que pagou.
//
// Corpo: { "championshipId": "<uuid>" }
// Resposta: { paid: boolean, status: string, liberadoAgora?: boolean }
//
// Secrets: ASAAS_API_KEY, ASAAS_ENV
// Publique com --no-verify-jwt:
//   supabase functions deploy asaas-status --no-verify-jwt
// ===========================================================================
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

export const VERSAO = '4'

/** Produção ou sandbox. A chave de homologação traz "hmlg" no meio. */
export function asaasBase(env: string | undefined, key: string): string {
  const sandbox = (env ?? '').toLowerCase() === 'sandbox' || /hmlg/i.test(key)
  return sandbox ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3'
}

/** Situações em que o dinheiro é nosso. */
export const PAGOS = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']

export interface PagamentoAsaas {
  id?: unknown
  status?: unknown
  value?: unknown
  externalReference?: unknown
}

/**
 * Escolhe, entre os pagamentos encontrados, um que quite a dívida.
 * Devolve `null` quando nenhum serve — nunca "quase".
 *
 * `refEsperada` fecha um buraco perigoso: a busca por `externalReference` é um
 * filtro da API, e filtro que o servidor não reconhece costuma ser IGNORADO —
 * a resposta viria com as cobranças de toda a conta. Sem conferir a referência
 * aqui, o pagamento de um campeonato liberaria outro. Quando a referência vem
 * vazia (cobrança nascida de checkout costuma não herdá-la), aceita — quem
 * garante o vínculo, nesse caminho, é o id do checkout.
 */
export function pagamentoQueQuita(
  lista: PagamentoAsaas[],
  devidoCents: number,
  refEsperada?: string,
): PagamentoAsaas | null {
  for (const p of lista ?? []) {
    if (!PAGOS.includes(String(p?.status ?? ''))) continue
    if (refEsperada) {
      const ref = p?.externalReference
      if (ref && String(ref) !== refEsperada) continue
    }
    const cents = Math.round(Number(p?.value ?? 0) * 100)
    // +1 centavo de folga para arredondamento do lado do Asaas.
    if (cents + 1 >= devidoCents) return p
  }
  return null
}

/** Ids de checkout que a gente guardou para este campeonato. */
export function idsDeCheckout(linhas: { checkout_id?: string | null }[]): string[] {
  return [...new Set((linhas ?? []).map((l) => l?.checkout_id).filter((v): v is string => !!v))]
}

/**
 * O campeonato guarda o último checkout em `payment_ref`, no formato
 * `checkout:<id>` — um vínculo que não depende da tabela `payments`, e
 * portanto não some quando a migration 0022 não foi aplicada.
 */
export function checkoutDoCampeonato(paymentRef: string | null | undefined): string | null {
  const m = /^checkout:(.+)$/.exec((paymentRef ?? '').trim())
  return m ? m[1] : null
}

/**
 * Entre as cobranças da conta, a que nasceu deste checkout. É um vínculo
 * exato (o Asaas devolve `checkoutSession` na cobrança), não um palpite por
 * valor — duas cobranças do mesmo plano têm o mesmo valor.
 */
export function cobrancaDoCheckout(
  lista: (PagamentoAsaas & { checkoutSession?: unknown })[],
  checkoutId: string,
  devidoCents: number,
): PagamentoAsaas | null {
  const doCheckout = (lista ?? []).filter((p) => String(p?.checkoutSession ?? '') === checkoutId)
  return pagamentoQueQuita(doCheckout, devidoCents)
}

/**
 * O checkout quita o campeonato? Um checkout `PAID` já é prova — o valor foi
 * definido por nós na criação, o Asaas não cobra diferente.
 */
export function checkoutQuita(
  ck: Record<string, unknown> | null,
  devidoCents: number,
): { pagamento: PagamentoAsaas; referencia: string } | null {
  if (!ck) return null
  if (String(ck?.status ?? '').toUpperCase() === 'PAID') {
    return {
      pagamento: { id: ck?.id, status: 'CONFIRMED', value: devidoCents / 100 },
      referencia: String(ck?.id ?? ''),
    }
  }
  // Alguns retornos trazem as cobranças geradas pelo checkout.
  const cru = (ck?.payments ?? ck?.payment ?? []) as PagamentoAsaas | PagamentoAsaas[]
  const lista = Array.isArray(cru) ? cru : [cru]
  const quita = pagamentoQueQuita(lista, devidoCents)
  return quita ? { pagamento: quita, referencia: String(quita.id ?? '') } : null
}

const quitaPeloCheckout = async (ck: Record<string, unknown>, devido: number) => checkoutQuita(ck, devido)

/**
 * Conta o que a busca encontrou em cada caminho, para achar onde ela para.
 * Só devolve ids, situações e valores — nada do pagador.
 */
async function diagnosticar(championshipId: string, key: string, autorizado: boolean) {
  const base = asaasBase(Deno.env.get('ASAAS_ENV'), key)
  const api = (caminho: string) => fetch(`${base}${caminho}`, { headers: { access_token: key } })
  const resumo = (p: PagamentoAsaas) => ({ id: p?.id, status: p?.status, value: p?.value })

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  const { data: champ } = await db
    .from('championships')
    .select('id, name, amount_cents, payment_status')
    .eq('id', championshipId)
    .maybeSingle()

  const { data: linhas, error: erroLinhas } = await db
    .from('payments')
    .select('checkout_id, payment_id, status, amount_cents')
    .eq('championship_id', championshipId)
    .order('created_at', { ascending: false })
    .limit(10)

  const out: Record<string, unknown> = {
    versao: VERSAO,
    ambiente: base,
    campeonato: champ ?? 'NÃO ENCONTRADO',
    registroLocal: erroLinhas ? `ERRO: ${erroLinhas.message}` : (linhas ?? []),
  }

  const r1 = await api(`/payments?externalReference=${encodeURIComponent(championshipId)}&limit=20`)
  out.porExternalReference = r1.ok
    ? ((await r1.json())?.data ?? []).map(resumo)
    : `HTTP ${r1.status}`

  const r2 = await api(`/checkouts?externalReference=${encodeURIComponent(championshipId)}&limit=10`)
  out.checkoutsPorReferencia = r2.ok
    ? ((await r2.json())?.data ?? []).map((c: Record<string, unknown>) => ({ id: c?.id, status: c?.status }))
    : `HTTP ${r2.status}`

  const porId: Record<string, unknown> = {}
  for (const id of idsDeCheckout(linhas ?? [])) {
    const r = await api(`/checkouts/${id}`)
    porId[id] = r.ok ? { status: (await r.json())?.status } : `HTTP ${r.status}`
  }
  out.checkoutsGuardados = porId

  // Últimas cobranças da conta: se o pagamento existe mas nenhuma busca acha,
  // é aqui que dá para ver com que referência ele nasceu. Esta é a única parte
  // que mostra movimento alheio ao campeonato perguntado, então exige o token.
  if (autorizado) {
    const r4 = await api('/payments?limit=10')
    out.ultimasCobrancasDaConta = r4.ok
      ? ((await r4.json())?.data ?? []).map((p: Record<string, unknown>) => ({
          id: p?.id,
          status: p?.status,
          value: p?.value,
          externalReference: p?.externalReference ?? null,
          checkoutSession: p?.checkoutSession ?? null,
        }))
      : `HTTP ${r4.status}`
  } else {
    out.ultimasCobrancasDaConta =
      'omitido — acrescente &token=<ASAAS_WEBHOOK_TOKEN> para ver as últimas cobranças da conta'
  }

  return out
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const key = Deno.env.get('ASAAS_API_KEY')

  // GET sem parâmetro = conferência da publicação.
  // GET ?championshipId=... = diagnóstico: mostra onde a busca está parando,
  // sem expor dado de pagador (só ids, situações e valores).
  if (req.method === 'GET') {
    const q = new URL(req.url).searchParams
    const alvo = q.get('championshipId')
    if (!alvo || !key) {
      return json({
        ok: true,
        versao: VERSAO,
        chave: key ? `${key.slice(0, 10)}…(${key.length} caracteres)` : 'AUSENTE',
        ambiente: key ? asaasBase(Deno.env.get('ASAAS_ENV'), key) : null,
        dica: 'acrescente ?championshipId=<uuid> para ver por que um pagamento não foi encontrado',
      })
    }
    const segredo = Deno.env.get('ASAAS_WEBHOOK_TOKEN')
    return json(await diagnosticar(alvo, key, !!segredo && q.get('token') === segredo))
  }

  if (req.method !== 'POST') return json({ error: 'Método não suportado', versao: VERSAO }, 405)
  if (!key) return json({ error: 'ASAAS_API_KEY não configurado', versao: VERSAO }, 500)
  const base = asaasBase(Deno.env.get('ASAAS_ENV'), key)

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

  const { data: champ } = await db
    .from('championships')
    .select('id, amount_cents, payment_status, payment_ref')
    .eq('id', championshipId)
    .maybeSingle()
  if (!champ) return json({ error: 'Campeonato não encontrado', versao: VERSAO }, 404)
  if (champ.payment_status !== 'pending') {
    return json({ paid: champ.payment_status === 'paid', status: champ.payment_status, versao: VERSAO })
  }

  const devido = champ.amount_cents ?? 0
  const api = (caminho: string) => fetch(`${base}${caminho}`, { headers: { access_token: key } })

  const tentado: string[] = []
  let achado: PagamentoAsaas | null = null
  let referencia = ''

  // 1. Pelo `externalReference` — o caminho direto, quando o Asaas propaga a
  //    referência do checkout para a cobrança.
  {
    const res = await api(`/payments?externalReference=${encodeURIComponent(championshipId)}&limit=20`)
    tentado.push(`payments?externalReference (${res.status})`)
    if (res.ok) {
      const lista = await res.json()
      achado = pagamentoQueQuita(lista?.data ?? [], devido, championshipId)
      if (achado) referencia = String(achado.id ?? '')
    }
  }

  // 2. Pelos checkouts do Asaas com a nossa referência — não depende do que
  //    guardamos no banco, então funciona mesmo se o registro local falhou.
  if (!achado) {
    const res = await api(`/checkouts?externalReference=${encodeURIComponent(championshipId)}&limit=10`)
    tentado.push(`checkouts?externalReference (${res.status})`)
    if (res.ok) {
      const lista = await res.json()
      for (const ck of (lista?.data ?? []) as Record<string, unknown>[]) {
        // Mesmo cuidado: se o filtro foi ignorado, vieram checkouts de outros
        // campeonatos — e um deles pago liberaria este de graça.
        if (String(ck?.externalReference ?? '') !== championshipId) continue
        const r = await quitaPeloCheckout(ck, devido)
        if (r) {
          achado = r.pagamento
          referencia = r.referencia
          break
        }
      }
    }
  }

  // 3. Pelo checkout guardado no próprio campeonato — o caminho que sobrevive
  //    mesmo sem a tabela `payments` em dia.
  const meuCheckout = checkoutDoCampeonato(champ.payment_ref)
  if (!achado && meuCheckout) {
    const res = await api(`/checkouts/${meuCheckout}`)
    tentado.push(`checkouts/${meuCheckout} via campeonato (${res.status})`)
    if (res.ok) {
      const r = await quitaPeloCheckout(await res.json(), devido)
      if (r) {
        achado = r.pagamento
        referencia = r.referencia
      }
    }

    // O checkout pode continuar "ativo" mesmo com a cobrança paga (o caso de
    // marcar como recebido em dinheiro, por exemplo). Aí a prova está na
    // cobrança que ele gerou.
    if (!achado) {
      const res2 = await api('/payments?limit=50')
      tentado.push(`payments?limit=50 (${res2.status})`)
      if (res2.ok) {
        const lista = (await res2.json())?.data ?? []
        const quita = cobrancaDoCheckout(lista, meuCheckout, devido)
        if (quita) {
          achado = quita
          referencia = String(quita.id ?? '')
        }
      }
    }
  }

  // 4. Pelos checkouts que criamos para este campeonato.
  if (!achado) {
    const { data: linhas } = await db
      .from('payments')
      .select('checkout_id')
      .eq('championship_id', championshipId)
      .order('created_at', { ascending: false })
      .limit(10)

    for (const id of idsDeCheckout(linhas ?? [])) {
      const res = await api(`/checkouts/${id}`)
      tentado.push(`checkouts/${id} (${res.status})`)
      if (!res.ok) continue
      const r = await quitaPeloCheckout(await res.json(), devido)
      if (r) {
        achado = r.pagamento
        referencia = r.referencia
        break
      }
    }
  }

  if (!achado) {
    return json({ paid: false, status: 'pending', tentado, versao: VERSAO })
  }

  const { error } = await db.rpc('mark_championship_paid', {
    p_champ: championshipId,
    p_payment_ref: referencia || 'asaas',
  })
  if (error) {
    console.error('asaas-status: falha ao liberar', error.message)
    return json({ error: 'Pagamento confirmado, mas a liberação falhou.', versao: VERSAO }, 500)
  }

  await db
    .from('payments')
    .update({ status: String(achado.status ?? 'CONFIRMED') })
    .eq('championship_id', championshipId)
    .is('payment_id', null)

  console.log('asaas-status: liberado', championshipId, referencia)
  return json({ paid: true, status: 'paid', liberadoAgora: true, versao: VERSAO })
})
