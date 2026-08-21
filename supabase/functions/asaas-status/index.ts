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

export const VERSAO = '1'

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
}

/**
 * Escolhe, entre os pagamentos encontrados, um que quite a dívida.
 * Devolve `null` quando nenhum serve — nunca "quase".
 */
export function pagamentoQueQuita(lista: PagamentoAsaas[], devidoCents: number): PagamentoAsaas | null {
  for (const p of lista ?? []) {
    if (!PAGOS.includes(String(p?.status ?? ''))) continue
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const key = Deno.env.get('ASAAS_API_KEY')

  if (req.method === 'GET') {
    return json({
      ok: true,
      versao: VERSAO,
      chave: key ? `${key.slice(0, 10)}…(${key.length} caracteres)` : 'AUSENTE',
      ambiente: key ? asaasBase(Deno.env.get('ASAAS_ENV'), key) : null,
    })
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
    .select('id, amount_cents, payment_status')
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
      achado = pagamentoQueQuita(lista?.data ?? [], devido)
      if (achado) referencia = String(achado.id ?? '')
    }
  }

  // 2. Pelos checkouts que criamos para este campeonato.
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
      const ck = await res.json()

      // O checkout pago já é prova: o valor foi definido por nós na criação.
      if (String(ck?.status ?? '').toUpperCase() === 'PAID') {
        achado = { id: ck?.id, status: 'CONFIRMED', value: devido / 100 }
        referencia = String(ck?.id ?? '')
        break
      }

      // Alguns retornos trazem as cobranças geradas pelo checkout.
      const cobrancas = (ck?.payments ?? ck?.payment ?? []) as PagamentoAsaas[]
      const lista = Array.isArray(cobrancas) ? cobrancas : [cobrancas]
      const quita = pagamentoQueQuita(lista, devido)
      if (quita) {
        achado = quita
        referencia = String(quita.id ?? '')
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
