// ===========================================================================
// Edge Function: asaas-webhook
//
// Recebe a notificação do Asaas e decide o que liberar (ou fechar).
//
// Dois assuntos chegam por aqui:
//
//   • PAGAMENTO ÚNICO de um campeonato — confirma e libera aquele campeonato;
//   • ASSINATURA MENSAL do Diamante — a cobrança do mês confirma e mantém
//     TODOS os campeonatos Diamante daquela conta abertos; se vencer sem
//     pagar, a assinatura entra em carência de 7 dias antes de fechar.
//
// O corpo da notificação não é confiável: ele só diz "olhe o pagamento X".
// Por isso a função reconsulta o pagamento (ou o checkout) na API do Asaas com
// a chave e decide pelo que a API responde — nunca pelo que chegou.
//
// Secrets:
//   ASAAS_API_KEY        chave de API do Asaas ($aact_...)
//   ASAAS_ENV            "sandbox" para testar; qualquer outra coisa = produção
//   ASAAS_WEBHOOK_TOKEN  (opcional, recomendado) o mesmo token configurado no
//                        painel do Asaas — chega no header `asaas-access-token`
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (injetados automaticamente)
//
// Publique com --no-verify-jwt (o Asaas não manda token do Supabase):
//   supabase functions deploy asaas-webhook --no-verify-jwt
// ===========================================================================
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Produção ou sandbox. A chave de homologação traz "hmlg" no meio. */
export function asaasBase(env: string | undefined, key: string): string {
  const sandbox = (env ?? '').toLowerCase() === 'sandbox' || /hmlg/i.test(key)
  return sandbox ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3'
}

/** Situações em que o dinheiro é do organizador do Tabelaço. */
export const PAGOS = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']

export const VERSAO = '3'

/**
 * O campeonato guarda o último checkout em `payment_ref`, como `checkout:<id>`.
 * É o vínculo que não depende da migration 0022 — e sem ele o webhook ficava
 * cego exatamente quando a tabela `payments` não estava em dia.
 */
export function checkoutDoCampeonato(paymentRef: string | null | undefined): string | null {
  const m = /^checkout:(.+)$/.exec((paymentRef ?? '').trim())
  return m ? m[1] : null
}

/** É um uuid? Só assim vale como id de campeonato. */
export function ehUuid(v: unknown): boolean {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

/**
 * A assinatura marca a referência como `owner:<uuid>`, e não com o id de um
 * campeonato: quem assina é a CONTA, e é ela que precisa ser reencontrada a
 * cada cobrança mensal.
 */
export function contaDaReferencia(ref: unknown): string | null {
  const m = /^owner:([0-9a-f-]{36})$/i.exec(String(ref ?? '').trim())
  return m && ehUuid(m[1]) ? m[1] : null
}

/** Situações em que a cobrança venceu sem pagamento. */
export const ATRASADOS = ['OVERDUE']

/** O que o Asaas diz da cobrança, traduzido para o que o banco entende. */
export function situacaoDaAssinatura(status: string): 'paga' | 'atrasada' | null {
  if (PAGOS.includes(status)) return 'paga'
  if (ATRASADOS.includes(status)) return 'atrasada'
  return null
}

serve(async (req) => {
  // O Asaas reenvia a notificação (e chega a pausar a fila) se não receber
  // 200; por isso qualquer situação "sem o que fazer" também responde 200.
  if (req.method !== 'POST') return json({ ok: true, skipped: 'method' })

  const key = Deno.env.get('ASAAS_API_KEY')
  if (!key) {
    console.error('asaas-webhook: ASAAS_API_KEY ausente')
    return json({ ok: false }, 500)
  }
  const base = asaasBase(Deno.env.get('ASAAS_ENV'), key)

  // Se o token de webhook estiver configurado, ele é obrigatório: sem isso
  // qualquer um que descubra a URL poderia mandar um "pagou" falso. Mesmo
  // assim nada é liberado sem a reconsulta abaixo.
  const esperado = Deno.env.get('ASAAS_WEBHOOK_TOKEN')
  if (esperado && req.headers.get('asaas-access-token') !== esperado) {
    console.error('asaas-webhook: token do webhook não confere')
    return json({ ok: false }, 401)
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const evento = String(body?.event ?? '')
  const pagamento = body?.payment as Record<string, unknown> | undefined
  const checkout = body?.checkout as Record<string, unknown> | undefined

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  const api = (caminho: string) => fetch(`${base}${caminho}`, { headers: { access_token: key } })

  /**
   * Descobre o campeonato, em três caminhos independentes — nenhum deles
   * suficiente sozinho:
   *   1. a referência que o Asaas devolve (cobrança de checkout não a herda);
   *   2. a tabela `payments` (só existe com a migration 0022 aplicada);
   *   3. o `payment_ref` do próprio campeonato (coluna da 0021, sempre existe).
   */
  async function acharCampeonato(ref: unknown, checkoutId: unknown, payId: unknown): Promise<string | null> {
    if (ehUuid(ref)) return String(ref)

    const chave = checkoutId ? 'checkout_id' : payId ? 'payment_id' : null
    const valor = checkoutId ?? payId
    if (chave && valor) {
      const { data, error } = await db
        .from('payments')
        .select('championship_id')
        .eq(chave, String(valor))
        .maybeSingle()
      if (error) console.error('asaas-webhook: payments indisponível —', error.message)
      if (data?.championship_id) return data.championship_id
    }

    if (checkoutId) {
      const { data } = await db
        .from('championships')
        .select('id')
        .eq('payment_ref', `checkout:${checkoutId}`)
        .maybeSingle()
      if (data?.id) return data.id
    }

    return null
  }

  let champId: string | null = null
  let cents = 0
  let referencia = ''
  let situacao = ''
  /** Veio de uma cobrança (tem valor a conferir) ou de um checkout (não tem)? */
  let porCobranca = false

  if (pagamento?.id) {
    porCobranca = true
    // Fonte da verdade: a própria API do Asaas.
    const res = await api(`/payments/${pagamento.id}`)
    if (!res.ok) {
      console.error('asaas-webhook: pagamento não consultado', pagamento.id, res.status)
      return json({ ok: false }, 502)
    }
    const pay = await res.json()
    situacao = String(pay?.status ?? '')
    cents = Math.round(Number(pay?.value ?? 0) * 100)
    referencia = String(pay?.id ?? '')

    // ---- Assinatura mensal do Diamante ----------------------------------
    //
    // Toda cobrança gerada por uma assinatura traz o id dela. A conta é
    // procurada por três caminhos, porque nenhum é garantido: a referência
    // externa (que o Asaas pode ou não propagar da assinatura para a
    // cobrança), o id da assinatura e o checkout que a originou.
    const assinaturaId = pay?.subscription ? String(pay.subscription) : null
    if (assinaturaId) {
      const traduzida = situacaoDaAssinatura(situacao)
      if (!traduzida) return json({ ok: true, status: situacao, assinatura: assinaturaId })

      let owner = contaDaReferencia(pay?.externalReference)
      if (!owner) {
        const { data } = await db
          .from('subscriptions')
          .select('owner_id')
          .or(`asaas_id.eq.${assinaturaId},checkout_id.eq.${String(pay?.checkoutSession ?? '')}`)
          .maybeSingle()
        owner = data?.owner_id ?? null
      }
      if (!owner) {
        console.error('asaas-webhook: assinatura sem conta identificada', assinaturaId)
        return json({ ok: true, skipped: 'assinatura não identificada' })
      }

      const { data: resultado, error: erroSub } = await db.rpc('assinatura_atualizar', {
        p_owner: owner,
        p_situacao: traduzida,
        p_asaas_id: assinaturaId,
        p_checkout: pay?.checkoutSession ? String(pay.checkoutSession) : null,
        p_proxima: pay?.dueDate ? new Date(`${pay.dueDate}T12:00:00Z`).toISOString() : null,
        p_carencia_dias: 7,
      })
      if (erroSub) {
        console.error('asaas-webhook: falha ao atualizar a assinatura', erroSub.message)
        return json({ ok: false }, 500)
      }
      return json({ ok: true, assinatura: assinaturaId, resultado })
    }

    champId = await acharCampeonato(pay?.externalReference, pay?.checkoutSession, pay?.id)

    if (champId) {
      const { error: erroRegistro } = await db.from('payments').upsert(
        {
          championship_id: champId,
          provider: 'asaas',
          payment_id: referencia,
          checkout_id: pay?.checkoutSession ? String(pay.checkoutSession) : null,
          amount_cents: cents,
          status: situacao,
          raw: pay,
        },
        { onConflict: 'payment_id' },
      )
      if (erroRegistro) {
        console.error(
          'asaas-webhook: não consegui registrar o pagamento —',
          erroRegistro.message,
          '— a migration 0022_asaas.sql foi aplicada?',
        )
      }
    }

    if (!PAGOS.includes(situacao)) return json({ ok: true, status: situacao })
  } else if (checkout?.id) {
    // Checkout pago: o valor foi definido por nós na criação, então o Asaas não
    // tem como cobrar a menos — o `status` da API já é prova suficiente.
    const res = await api(`/checkouts/${checkout.id}`)
    if (!res.ok) {
      console.error('asaas-webhook: checkout não consultado', checkout.id, res.status)
      return json({ ok: false }, 502)
    }
    const ck = await res.json()
    situacao = String(ck?.status ?? '')
    referencia = String(ck?.id ?? '')
    champId = await acharCampeonato(ck?.externalReference, ck?.id, null)
    if (situacao.toUpperCase() !== 'PAID') return json({ ok: true, status: situacao })
  } else {
    return json({ ok: true, skipped: evento || 'sem pagamento' })
  }

  if (!champId) return json({ ok: true, skipped: 'campeonato não identificado' })

  const { data: champ } = await db
    .from('championships')
    .select('id, amount_cents, payment_status')
    .eq('id', champId)
    .maybeSingle()
  if (!champ) return json({ ok: true, skipped: 'campeonato inexistente' })
  if (champ.payment_status === 'paid') return json({ ok: true, status: 'já liberado' })

  // Confere o valor: só libera se pagou pelo menos o que era devido.
  //
  // O `cents > 0` que estava aqui abria um buraco: uma cobrança cujo valor não
  // desse para ler (campo ausente, formato inesperado) virava cents = 0 e
  // passava batido — liberando de graça. Agora, quando o aviso é de cobrança,
  // o valor É a prova e precisa cobrir o devido. Só o caminho do checkout
  // dispensa a conferência, porque ali o valor foi definido por nós na criação
  // e o Asaas não tem como cobrar diferente.
  const devido = champ.amount_cents ?? 0
  if (porCobranca && devido > 0 && cents + 1 < devido) {
    console.error('asaas-webhook: valor menor que o devido', { champId, cents, devido })
    return json({ ok: true, status: 'valor insuficiente' })
  }

  const { error } = await db.rpc('mark_championship_paid', {
    p_champ: champId,
    p_payment_ref: referencia,
  })
  if (error) {
    console.error('asaas-webhook: falha ao liberar', error.message)
    return json({ ok: false }, 500)
  }

  // Rede de segurança: aproveita a passagem para encerrar assinaturas cuja
  // carência estourou. O agendamento diário continua sendo o responsável —
  // isto só antecipa quando há movimento na conta.
  await db.rpc('assinaturas_varrer').catch(() => {})

  return json({ ok: true, status: 'liberado' })
})
