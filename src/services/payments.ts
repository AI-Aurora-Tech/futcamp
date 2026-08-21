// ---------------------------------------------------------------------------
// Cobrança do campeonato (Asaas).
//
// Fluxo:
//   1. o organizador cria o campeonato escolhendo o plano;
//   2. o banco calcula o valor (plano + categorias adicionais) e grava o
//      campeonato como `pending` — bloqueado;
//   3. `startCheckout` chama a Edge Function `asaas-checkout`, que cria o
//      checkout no Asaas com a CHAVE DE API (que fica só no servidor) e
//      devolve o link de pagamento — Pix, boleto ou cartão, o pagador escolhe;
//   4. o Asaas avisa a Edge Function `asaas-webhook` quando o pagamento é
//      confirmado, e ela libera o campeonato (`paid`).
//
// Nada de chave aqui: este arquivo roda no navegador.
// ---------------------------------------------------------------------------
import { authMode } from './auth'
import { supabase } from '../lib/supabase'
import { getChampionship } from './championships'
import { mutate } from './demo'
import type { Championship } from '../types'

export interface CheckoutResult {
  ok: boolean
  /** Link do Asaas para concluir o pagamento. */
  url?: string
  /** Modo demo: não há cobrança real, o campeonato já foi liberado. */
  simulated?: boolean
  error?: string
}

/**
 * Gera (ou recupera) o link de pagamento do campeonato.
 *
 * No modo demo — sem Supabase — não existe servidor para falar com o Asaas: o
 * campeonato é liberado na hora, para dar para testar o app inteiro.
 */
export async function startCheckout(championshipId: string): Promise<CheckoutResult> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase.functions.invoke('asaas-checkout', {
      body: { championshipId },
    })
    // O SDK devolve sempre "Edge Function returned a non-2xx status code" e
    // esconde o corpo da resposta em `error.context`. Sem ler esse corpo, quem
    // está configurando o Asaas fica sem saber o que deu errado.
    if (error) return { ok: false, error: await motivo(error) }
    const url = (data as { url?: string } | null)?.url
    if (!url) return { ok: false, error: 'O Asaas não devolveu o link de pagamento.' }
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
  if (m.includes('asaas_api_key')) {
    return 'Falta o secret ASAAS_API_KEY no Supabase (Project Settings → Edge Functions → Secrets).'
  }
  if (status === 403) return corpo || 'Este campeonato é de outro organizador.'
  if (status === 401) {
    // Quem devolve isso é o portão do Supabase, antes da função rodar.
    return 'O Supabase recusou a chamada antes de chegar na função. Publique de novo com: supabase functions deploy asaas-checkout --no-verify-jwt'
  }
  if (status === 404) {
    return 'A função asaas-checkout ainda não foi publicada no Supabase (supabase functions deploy asaas-checkout --no-verify-jwt).'
  }
  if (status === 409) return corpo || 'Este campeonato não tem valor a cobrar.'
  if (status === 502) {
    return 'O Asaas recusou a cobrança. Confira a ASAAS_API_KEY (e o ASAAS_ENV) e o APP_URL, que precisa ser https.'
  }
  if (status >= 500) {
    return 'A função asaas-checkout falhou. Veja o log em Supabase → Edge Functions → asaas-checkout → Logs.'
  }
  return ''
}
