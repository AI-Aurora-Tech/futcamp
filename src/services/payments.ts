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
    // O SDK devolve sempre "Edge Function returned a non-2xx status code" e
    // esconde o corpo da resposta em `error.context`. Sem ler esse corpo, quem
    // está configurando o Mercado Pago fica sem saber o que deu errado.
    if (error) return { ok: false, error: await motivo(error) }
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

/**
 * Abre a resposta que o SDK escondeu e devolve um motivo que dê para agir.
 *
 * `FunctionsHttpError.context` é a `Response` original — é lá que está o
 * `{ error: "..." }` que a Edge Function devolveu, junto com o status HTTP.
 */
export async function motivo(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown })?.context
  const res = ctx instanceof Response ? ctx : undefined
  let corpo = ''
  if (res) {
    try {
      const txt = await res.clone().text()
      try {
        const j = JSON.parse(txt)
        corpo = String(j?.error ?? j?.message ?? txt)
      } catch {
        corpo = txt
      }
    } catch {
      /* corpo já consumido — segue só com o status */
    }
  }

  const status = res?.status ?? 0
  const dica = pista(status, corpo)
  const detalhe = corpo.trim().slice(0, 300)
  if (dica) return detalhe && !dica.includes(detalhe) ? `${dica} (${detalhe})` : dica
  if (detalhe) return detalhe
  return (error as { message?: string })?.message || 'Não foi possível gerar o link de pagamento.'
}

function pista(status: number, corpo: string): string {
  const m = corpo.toLowerCase()
  if (m.includes('mp_access_token')) {
    return 'Falta o secret MP_ACCESS_TOKEN no Supabase (Project Settings → Edge Functions → Secrets).'
  }
  if (status === 403) return corpo || 'Este campeonato é de outro organizador.'
  if (status === 401) {
    // Quem devolve isso é o portão do Supabase, antes da função rodar.
    return 'O Supabase recusou a chamada antes de chegar na função. Publique de novo com: supabase functions deploy mp-checkout --no-verify-jwt'
  }
  if (status === 404) {
    return 'A função mp-checkout ainda não foi publicada no Supabase (supabase functions deploy mp-checkout).'
  }
  if (status === 409) return corpo || 'Este campeonato não tem valor a cobrar.'
  if (status === 502) {
    return 'O Mercado Pago recusou a cobrança. Confira o MP_ACCESS_TOKEN de produção e o APP_URL (precisa ser https).'
  }
  if (status >= 500) {
    return 'A função mp-checkout falhou. Veja o log em Supabase → Edge Functions → mp-checkout → Logs.'
  }
  return ''
}
