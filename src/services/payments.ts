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
import type { Championship, Subscription } from '../types'

export interface CheckResult {
  champ: Championship | null
  /** A pergunta ao Asaas realmente aconteceu? */
  consultou: boolean
  /** Por que não deu para perguntar (função não publicada, rede, etc.). */
  erro?: string
}

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
 * pela espera automática depois do checkout (o webhook é quem libera).
 */
export async function refreshPayment(championshipId: string): Promise<Championship | null> {
  return getChampionship(championshipId)
}

/**
 * Pergunta ao Asaas, na hora, se o campeonato já foi pago — e libera se já
 * foi. É o que o botão "Já paguei" faz.
 *
 * Existe porque webhook falha: não configurado, evento não marcado, entrega
 * perdida. Sem esta consulta, quem pagou ficaria travado esperando um aviso
 * que talvez nunca chegue. Quem decide continua sendo a API do Asaas — o app
 * só pergunta.
 */
export async function checkPayment(championshipId: string): Promise<CheckResult> {
  let consultou = true
  let erro: string | undefined

  if (authMode === 'supabase' && supabase) {
    try {
      const { error } = await supabase.functions.invoke('asaas-status', { body: { championshipId } })
      if (error) {
        consultou = false
        erro = await motivo(error)
      }
    } catch (e) {
      consultou = false
      erro = (e as Error)?.message
    }
  }

  // Mesmo sem conseguir perguntar, relê o campeonato: o webhook pode ter
  // liberado enquanto isso.
  return { champ: await refreshPayment(championshipId), consultou, erro }
}

/**
 * Libera o campeonato sem pagamento pelo app — exclusivo do administrador
 * master (dinheiro na mão, transferência direta, cortesia, ou uma confirmação
 * que o Asaas não entregou). Quem valida é o banco, na
 * `master_release_championship`: o navegador não decide isso.
 */
/**
 * Registra o valor NEGOCIADO do plano Diamante (só o master).
 *
 * O Diamante não tem preço de tabela: o consultor combina com o cliente e é
 * este valor que vira a cobrança. Depois disso o link de pagamento sai pelo
 * mesmo caminho de todo mundo — `startCheckout` —, já amarrado ao campeonato.
 *
 * `cents` igual a zero devolve o campeonato para "a combinar".
 */
export async function setNegotiatedPrice(
  championshipId: string,
  cents: number,
  nota?: string,
  kind: 'avulso' | 'mensal' = 'avulso',
  months = 12,
): Promise<Championship | null> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.rpc('set_negotiated_price', {
      p_champ: championshipId,
      p_cents: Math.max(0, Math.round(cents)),
      p_nota: nota ?? null,
      p_kind: kind,
      p_months: Math.max(1, Math.round(months)),
    })
    if (error) {
      throw new Error(
        /function .* does not exist/i.test(error.message)
          ? 'As migrations 0036/0037 do plano Diamante ainda não foram aplicadas no Supabase.'
          : error.message,
      )
    }
    return refreshPayment(championshipId)
  }

  // Demo: guarda o valor no navegador, para dar para ver a tela funcionando.
  mutate((d) => {
    const i = d.championships.findIndex((c) => c.id === championshipId)
    if (i >= 0) {
      d.championships[i] = {
        ...d.championships[i],
        negotiatedCents: cents > 0 ? Math.round(cents) : undefined,
        negotiatedNote: nota?.trim() || undefined,
        negotiatedKind: cents > 0 ? kind : undefined,
        negotiatedMonths: cents > 0 && kind === 'mensal' ? Math.max(1, Math.round(months)) : undefined,
        amountCents: Math.max(0, Math.round(cents)),
        paymentStatus: 'pending',
      }
    }
  })
  return getChampionship(championshipId)
}

export async function masterRelease(championshipId: string, nota?: string): Promise<Championship | null> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.rpc('master_release_championship', {
      p_champ: championshipId,
      p_nota: nota ?? null,
    })
    if (error) {
      throw new Error(
        /function .* does not exist/i.test(error.message)
          ? 'A migration 0023_master_release.sql ainda não foi aplicada no Supabase.'
          : error.message,
      )
    }
    return refreshPayment(championshipId)
  }

  mutate((d) => {
    const i = d.championships.findIndex((c) => c.id === championshipId)
    if (i >= 0) {
      d.championships[i] = {
        ...d.championships[i],
        paymentStatus: 'paid',
        paidAt: new Date().toISOString(),
        paymentRef: nota || 'liberado pelo master',
      }
    }
  })
  return refreshPayment(championshipId)
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
  /** Rastro da função: versão publicada e combinações tentadas. */
  let rastro = ''
  if (res) {
    try {
      const txt = await res.clone().text()
      try {
        const j = JSON.parse(txt)
        corpo = String(j?.error ?? j?.message ?? txt)
        const partes = [
          j?.versao ? `função v${j.versao}` : '',
          j?.tentadas ? `tentou ${j.tentadas}` : '',
        ].filter(Boolean)
        rastro = partes.length ? ` · ${partes.join(' · ')}` : ''
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
  if (dica) return (detalhe && !dica.includes(detalhe) ? `${dica} (${detalhe})` : dica) + rastro
  if (detalhe) return detalhe + rastro
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

/* -------------------------------------------------------------------------- */
/* Assinatura do plano Diamante                                               */
/* -------------------------------------------------------------------------- */

function subFromRow(r: Record<string, unknown>): Subscription {
  return {
    id: String(r.id),
    ownerId: String(r.owner_id),
    cents: Number(r.cents ?? 0),
    months: Number(r.months ?? 12),
    status: r.status as Subscription['status'],
    startedAt: (r.started_at as string) ?? undefined,
    nextDueAt: (r.next_due_at as string) ?? undefined,
    endsAt: (r.ends_at as string) ?? undefined,
    graceUntil: (r.grace_until as string) ?? undefined,
    contractVersion: (r.contract_version as string) ?? undefined,
    contractName: (r.contract_name as string) ?? undefined,
    contractDocument: (r.contract_document as string) ?? undefined,
    contractAt: (r.contract_at as string) ?? undefined,
  }
}

/**
 * A assinatura viva desta conta, se houver.
 *
 * A RLS já restringe: o organizador enxerga a própria, o master enxerga
 * todas. Aqui não há filtro de dono de propósito — quem filtra é o banco.
 */
export async function getSubscription(): Promise<Subscription | null> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .in('status', ['pending', 'active', 'overdue'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    // Tabela ausente (migration 0037 não aplicada) não pode quebrar a tela.
    if (error) return null
    return data ? subFromRow(data as Record<string, unknown>) : null
  }
  return demoSub
}

/** Modo demo: a assinatura mora na memória, só para a tela dar para ver. */
let demoSub: Subscription | null = null

/**
 * Aceite do contrato — é ele que cria a assinatura.
 *
 * O texto vai por inteiro para o banco: contrato é o que a pessoa leu naquele
 * dia, e reconstruí-lo depois a partir de um número de versão seria confiar
 * que ninguém mexeu no modelo.
 */
export async function acceptContract(params: {
  championshipId: string
  nome: string
  documento: string
  versao: string
  texto: string
}): Promise<Subscription | null> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.rpc('assinatura_aceitar', {
      p_champ: params.championshipId,
      p_nome: params.nome,
      p_documento: params.documento,
      p_versao: params.versao,
      p_texto: params.texto,
      p_ip: null,
    })
    if (error) {
      throw new Error(
        /function .* does not exist/i.test(error.message)
          ? 'A migration 0037_assinatura_diamante.sql ainda não foi aplicada no Supabase.'
          : error.message,
      )
    }
    return getSubscription()
  }

  const champ = await getChampionship(params.championshipId)
  demoSub = {
    id: 'demo-sub',
    ownerId: champ?.ownerId ?? 'demo',
    cents: champ?.negotiatedCents ?? 0,
    months: champ?.negotiatedMonths ?? 12,
    status: 'pending',
    contractVersion: params.versao,
    contractName: params.nome,
    contractDocument: params.documento,
    contractAt: new Date().toISOString(),
  }
  return demoSub
}
