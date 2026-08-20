// ---------------------------------------------------------------------------
// Cobrança do campeonato (Mercado Pago).
//
// Fluxo:
//   1. o organizador cria o campeonato escolhendo o plano;
//   2. o banco calcula o valor (plano + categorias adicionais) e grava o
//      campeonato como `pending` — bloqueado;
//   3. `startCheckout` chama a Edge Function `mp-checkout`, que cria a
//      preferência no Mercado Pago com o ACCESS TOKEN (que fica só no servidor)
//      e devolve o link de pagamento;
//   4. o Mercado Pago avisa a Edge Function `mp-webhook` quando o pagamento é
//      aprovado, e ela libera o campeonato (`paid`).
//
// Nada de token aqui: este arquivo roda no navegador.
// ---------------------------------------------------------------------------
import { authMode } from './auth'
import { supabase } from '../lib/supabase'
import { getChampionship } from './championships'
import { mutate } from './demo'
import type { Championship } from '../types'

export interface CheckoutResult {
  ok: boolean
  /** Link do Mercado Pago para concluir o pagamento. */
  url?: string
  /** Modo demo: não há cobrança real, o campeonato já foi liberado. */
  simulated?: boolean
  error?: string
}

/**
 * Gera (ou recupera) o link de pagamento do campeonato.
 *
 * No modo demo — sem Supabase — não existe servidor para falar com o Mercado
 * Pago: o campeonato é liberado na hora, para dar para testar o app inteiro.
 */
export async function startCheckout(championshipId: string): Promise<CheckoutResult> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase.functions.invoke('mp-checkout', {
      body: { championshipId },
    })
    if (error) return { ok: false, error: traduz(error.message) }
    const url = (data as { url?: string } | null)?.url
    if (!url) return { ok: false, error: 'O Mercado Pago não devolveu o link de pagamento.' }
    return { ok: true, url }
  }

  // Demo: libera sem cobrar.
  mutate((d) => {
    const i = d.championships.findIndex((c) => c.id === championshipId)
    if (i >= 0) {
      d.championships[i] = {
        ...d.championships[i],
        paymentStatus: 'paid',
        paidAt: new Date().toISOString(),
        paymentRef: 'demo',
      }
    }
  })
  return { ok: true, simulated: true }
}

/**
 * Reconsulta o campeonato para ver se o pagamento já foi confirmado — usado
 * pelo botão "Já paguei" e pela espera automática depois do checkout.
 */
export async function refreshPayment(championshipId: string): Promise<Championship | null> {
  return getChampionship(championshipId)
}

function traduz(msg: string | undefined): string {
  const m = (msg ?? '').toLowerCase()
  if (m.includes('not found') || m.includes('404')) {
    return 'Cobrança indisponível: a função mp-checkout ainda não foi publicada no Supabase.'
  }
  if (m.includes('token')) {
    return 'O Mercado Pago recusou as credenciais. Confira o secret MP_ACCESS_TOKEN.'
  }
  return msg || 'Não foi possível gerar o link de pagamento.'
}
