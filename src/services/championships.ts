import { authMode } from './auth'
import { supabase } from '../lib/supabase'
import { mutate, query } from './demo'
import { uid } from '../lib/id'
import { planOf, totalCents } from '../lib/pricing'
import type { Championship, ChampionshipStatus, PlanKey } from '../types'

/* eslint-disable @typescript-eslint/no-explicit-any */

function fromRow(r: any): Championship {
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    sport: r.sport,
    audience: r.audience ?? 'adulto',
    categories: Array.isArray(r.categories) ? r.categories : [],
    format: r.format,
    season: r.season ?? '',
    status: r.status,
    description: r.description ?? undefined,
    logo: r.logo ?? undefined,
    primaryColor: r.primary_color ?? undefined,
    pointsWin: r.points_win ?? 3,
    pointsDraw: r.points_draw ?? 1,
    registrationCutoffHours: r.registration_cutoff_hours ?? 0,
    closedRounds: Array.isArray(r.closed_rounds) ? r.closed_rounds : [],
    doubleRound: Boolean(r.double_round),
    numGroups: r.num_groups ?? undefined,
    teamsPerGroup: r.teams_per_group ?? undefined,
    advancePerGroup: r.advance_per_group ?? undefined,
    leagueQualifiers: r.league_qualifiers ?? undefined,
    advanceByGroup: r.advance_by_group ?? undefined,
    groupStages: Array.isArray(r.group_stages) ? r.group_stages : undefined,
    tiebreakers: Array.isArray(r.tiebreakers) ? r.tiebreakers : undefined,
    bracket: Array.isArray(r.bracket) ? r.bracket : undefined,
    thirdPlace: r.third_place ?? undefined,
    autoKnockout: r.auto_knockout ?? undefined,
    referees: Array.isArray(r.referees) ? r.referees : [],
    venues: Array.isArray(r.venues) ? r.venues : [],
    sponsors: Array.isArray(r.sponsors) ? r.sponsors : [],
    plan: r.plan ?? undefined,
    planChange: r.plan_change
      ? {
          plan: r.plan_change.plan ?? undefined,
          amountCents: r.plan_change.amount_cents ?? undefined,
          paymentStatus: r.plan_change.payment_status ?? undefined,
          paymentRef: r.plan_change.payment_ref ?? undefined,
          paidAt: r.plan_change.paid_at ?? undefined,
        }
      : undefined,
    // Campeonato antigo (antes da cobrança) não tem situação: vale como pago.
    paymentStatus: r.payment_status ?? undefined,
    amountCents: r.amount_cents ?? undefined,
    paymentRef: r.payment_ref ?? undefined,
    paidAt: r.paid_at ?? undefined,
    benchSize: r.bench_size ?? undefined,
    finishedAt: r.finished_at ?? undefined,
    createdAt: r.created_at,
  }
}

function toRow(c: Partial<Championship>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (c.ownerId !== undefined) row.owner_id = c.ownerId
  if (c.name !== undefined) row.name = c.name
  if (c.sport !== undefined) row.sport = c.sport
  if (c.audience !== undefined) row.audience = c.audience
  if (c.categories !== undefined) row.categories = c.categories
  if (c.format !== undefined) row.format = c.format
  if (c.season !== undefined) row.season = c.season
  if (c.status !== undefined) row.status = c.status
  if (c.description !== undefined) row.description = c.description
  if (c.logo !== undefined) row.logo = c.logo
  if (c.primaryColor !== undefined) row.primary_color = c.primaryColor
  if (c.pointsWin !== undefined) row.points_win = c.pointsWin
  if (c.pointsDraw !== undefined) row.points_draw = c.pointsDraw
  if (c.registrationCutoffHours !== undefined) row.registration_cutoff_hours = c.registrationCutoffHours
  if (c.closedRounds !== undefined) row.closed_rounds = c.closedRounds
  if (c.doubleRound !== undefined) row.double_round = c.doubleRound
  if (c.numGroups !== undefined) row.num_groups = c.numGroups
  if (c.teamsPerGroup !== undefined) row.teams_per_group = c.teamsPerGroup
  if (c.advancePerGroup !== undefined) row.advance_per_group = c.advancePerGroup
  if (c.leagueQualifiers !== undefined) row.league_qualifiers = c.leagueQualifiers
  if (c.advanceByGroup !== undefined) row.advance_by_group = c.advanceByGroup
  if (c.groupStages !== undefined) row.group_stages = c.groupStages
  if (c.tiebreakers !== undefined) row.tiebreakers = c.tiebreakers
  if (c.bracket !== undefined) row.bracket = c.bracket
  if (c.thirdPlace !== undefined) row.third_place = c.thirdPlace
  if (c.autoKnockout !== undefined) row.auto_knockout = c.autoKnockout
  if (c.referees !== undefined) row.referees = c.referees
  if (c.venues !== undefined) row.venues = c.venues
  if (c.sponsors !== undefined) row.sponsors = c.sponsors
  if (c.plan !== undefined) row.plan = c.plan
  if (c.benchSize !== undefined) row.bench_size = c.benchSize
  if (c.amountCents !== undefined) row.amount_cents = c.amountCents
  // `payment_status`, `payment_ref` e `paid_at` NÃO são escritos pelo app: quem
  // confirma pagamento é a Edge Function `asaas-webhook` (service role). Um gatilho
  // no banco (migration 0021) rejeita a tentativa vinda do cliente.
  return row
}

/** Lista os campeonatos do organizador (ou todos, no modo demo). */
export async function listChampionships(ownerId: string): Promise<Championship[]> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase
      .from('championships')
      .select('*')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map(fromRow)
  }
  return query((d) =>
    d.championships
      .filter((c) => c.ownerId === ownerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  )
}

/**
 * TODOS os campeonatos da plataforma, de qualquer organizador.
 * Uso exclusivo do administrador master.
 */
export async function listAllChampionships(): Promise<Championship[]> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase
      .from('championships')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map(fromRow)
  }
  return query((d) =>
    [...d.championships].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  )
}

/**
 * Por quantos dias um campeonato ENCERRADO continua na vitrine pública —
 * é o tempo em que o campeão fica à vista de quem não tem o link direto.
 */
export const PUBLIC_FINISHED_DAYS = 10

const DAY_MS = 24 * 60 * 60 * 1000

/** Até quando o campeonato encerrado ainda aparece publicamente (ms). */
export function publicUntil(c: Championship): number | null {
  if (c.status !== 'finished') return null
  const at = Date.parse(c.finishedAt ?? c.createdAt)
  return Number.isNaN(at) ? null : at + PUBLIC_FINISHED_DAYS * DAY_MS
}

/** Quantos dias faltam para o campeonato encerrado sair da vitrine. */
export function daysLeftPublic(c: Championship, now = Date.now()): number | null {
  const until = publicUntil(c)
  if (until == null) return null
  return Math.max(0, Math.ceil((until - now) / DAY_MS))
}

/** O campeonato aparece na vitrine pública agora? */
export function isPubliclyListed(c: Championship, now = Date.now()): boolean {
  if (c.status === 'active') return true
  const until = publicUntil(c)
  return until != null && until > now
}

/**
 * Campeonatos visíveis publicamente: os EM ANDAMENTO e os ENCERRADOS há no
 * máximo `PUBLIC_FINISHED_DAYS` dias (para o campeão continuar à vista).
 * Os em andamento vêm primeiro.
 */
export async function listPublicChampionships(): Promise<Championship[]> {
  const now = Date.now()
  const cutoff = new Date(now - PUBLIC_FINISHED_DAYS * DAY_MS).toISOString()
  const order = (a: Championship, b: Championship) =>
    a.status === b.status
      ? b.createdAt.localeCompare(a.createdAt)
      : a.status === 'active'
        ? -1
        : 1

  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase
      .from('championships')
      .select('*')
      .or(`status.eq.active,and(status.eq.finished,finished_at.gte.${cutoff})`)
      .order('created_at', { ascending: false })
      .limit(60)
    // Banco sem a coluna finished_at (migration 0020 pendente): cai no filtro
    // antigo em vez de deixar a vitrine vazia.
    if (error) {
      const { data: actives } = await supabase
        .from('championships')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(60)
      return (actives ?? []).map(fromRow)
    }
    return (data ?? []).map(fromRow).sort(order)
  }
  return query((d) => d.championships.filter((c) => isPubliclyListed(c, now)).sort(order))
}

export async function getChampionship(id: string): Promise<Championship | null> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase.from('championships').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    return data ? fromRow(data) : null
  }
  return query((d) => d.championships.find((c) => c.id === id) ?? null)
}

/** O que a troca de plano devolve, para a tela dizer o que aconteceu. */
export interface TrocaDePlano {
  plan: PlanKey
  tier: string
  amountCents: number
  /** A troca gerou cobrança (subiu de plano)? */
  cobra: boolean
  aPagarCents: number
}

/**
 * Troca o plano de um campeonato JÁ CRIADO, sem perder nada.
 *
 * Subir de plano cobra a diferença e devolve o campeonato para "pendente" até
 * o pagamento — times, elencos e tabela ficam onde estão, só o painel fecha.
 * Descer vale na hora e não devolve dinheiro.
 *
 * Quem decide isso é o BANCO (`change_championship_plan`): o gatilho de preço
 * recusa qualquer mexida do cliente nos campos de cobrança, e é isso que
 * impede alguém de se promover para Ouro pelo navegador.
 */
export async function changePlan(champId: string, plan: PlanKey): Promise<TrocaDePlano> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase.rpc('change_championship_plan', {
      p_champ: champId,
      p_plan: plan,
    })
    if (error) {
      throw new Error(
        /does not exist|PGRST202/i.test(error.message ?? '')
          ? 'A troca de plano ainda não foi liberada neste servidor (migration 0032).'
          : error.message,
      )
    }
    const r = data as any
    return {
      plan: r.plan,
      tier: r.tier,
      amountCents: r.amount_cents ?? 0,
      cobra: Boolean(r.cobra),
      aPagarCents: r.a_pagar ?? 0,
    }
  }

  return mutate((d) => {
    const c = d.championships.find((x) => x.id === champId)
    if (!c) throw new Error('Campeonato não encontrado.')
    if ((c.plan ?? 'gratis') === plan) {
      throw new Error(`O campeonato já está no plano ${planOf(plan).tier}.`)
    }
    const novo = totalCents(plan, c.categories.length)
    const jaPago = c.paymentStatus === 'paid' || c.paymentStatus === 'free' ? c.amountCents ?? 0 : 0
    const sobe = novo > jaPago

    if (sobe) {
      c.planChange = c.planChange ?? {
        plan: c.plan,
        amountCents: c.amountCents,
        paymentStatus: c.paymentStatus,
        paymentRef: c.paymentRef,
        paidAt: c.paidAt,
      }
      c.plan = plan
      c.amountCents = novo
      c.paymentStatus = 'pending'
      c.paymentRef = undefined
      c.paidAt = undefined
    } else {
      c.planChange = undefined
      c.plan = plan
      c.amountCents = novo
      c.paymentStatus = novo > 0 ? c.paymentStatus ?? 'free' : 'free'
      if (novo === 0) {
        c.paymentRef = undefined
        c.paidAt = undefined
      }
    }
    return {
      plan,
      tier: planOf(plan).tier,
      amountCents: novo,
      cobra: sobe,
      aPagarCents: sobe ? novo : 0,
    }
  })
}

/** Desfaz um upgrade que ainda não foi pago, devolvendo o campeonato ao que era. */
export async function revertPlan(champId: string): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.rpc('revert_championship_plan', { p_champ: champId })
    if (error) throw new Error(error.message)
    return
  }
  mutate((d) => {
    const c = d.championships.find((x) => x.id === champId)
    if (!c?.planChange) throw new Error('Não há troca de plano pendente neste campeonato.')
    const v = c.planChange
    c.plan = v.plan
    c.amountCents = v.amountCents
    c.paymentStatus = v.paymentStatus
    c.paymentRef = v.paymentRef
    c.paidAt = v.paidAt
    c.planChange = undefined
    return null
  })
}

/**
 * Muda a situação de UMA categoria — rascunho, em andamento ou encerrada.
 *
 * Categorias começam e terminam em datas diferentes; encerrar o Sub-11 não
 * pode encerrar o Sub-17. No Supabase quem escreve é a RPC
 * `set_categoria_status`: a situação mora dentro do jsonb das categorias, e
 * reescrever o array inteiro do navegador faria uma aba apagar o que a outra
 * acabou de salvar.
 */
export async function setCategoryStatus(
  champId: string,
  categoryId: string,
  status: ChampionshipStatus,
): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.rpc('set_categoria_status', {
      p_champ: champId,
      p_category: categoryId,
      p_status: status,
    })
    if (error) {
      throw new Error(
        /does not exist|PGRST202/i.test(error.message ?? '')
          ? 'A separação por categoria ainda não foi liberada neste servidor (migration 0033).'
          : error.message,
      )
    }
    return
  }
  mutate((d) => {
    const c = d.championships.find((x) => x.id === champId)
    const cat = c?.categories.find((x) => x.id === categoryId)
    if (!cat) return null
    cat.status = status
    cat.finishedAt = status === 'finished' ? new Date().toISOString() : undefined
    return null
  })
}

export type NewChampionship = Omit<Championship, 'id' | 'createdAt' | 'ownerId'>

export async function createChampionship(
  ownerId: string,
  input: NewChampionship,
): Promise<Championship> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase
      .from('championships')
      .insert(toRow({ ...input, ownerId }))
      .select('*')
      .single()
    if (error) throw error
    return fromRow(data)
  }
  // Modo demo: o preço é calculado aqui (no Supabase quem calcula é o gatilho
  // da migration 0021, para o cliente não conseguir "zerar" o valor).
  const cents = totalCents(input.plan, input.categories.length)
  const champ: Championship = {
    ...input,
    amountCents: cents,
    paymentStatus: cents > 0 ? 'pending' : 'free',
    id: uid('champ'),
    ownerId,
    createdAt: new Date().toISOString(),
  }
  return mutate((d) => {
    d.championships.push(champ)
    return champ
  })
}

/**
 * Recusa da RLS. O caso mais comum é o master estar cadastrado só no
 * `VITE_MASTER_ADMINS` (que vale no navegador) e não na tabela `master_admins`
 * (que é quem vale no banco) — aí o app mostra os botões de master mas o
 * Postgres não deixa escrever.
 */
const RECUSADO = (acao: string) =>
  `O banco não deixou ${acao} este campeonato. Se você é o administrador master, ` +
  `confira se o seu e-mail está na tabela master_admins do Supabase (migration 0015).`

export async function updateChampionship(
  id: string,
  patch: Partial<Championship>,
): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    // `.select()` para saber quantas linhas mudaram: quando a RLS recusa, o
    // Postgres não devolve erro — ele simplesmente não altera nada, e a tela
    // ficaria dizendo que salvou.
    const { data, error } = await supabase
      .from('championships')
      .update(toRow(patch))
      .eq('id', id)
      .select('id')
    if (error) throw error
    if (!data?.length) throw new Error(RECUSADO('editar'))
    return
  }
  mutate((d) => {
    const i = d.championships.findIndex((c) => c.id === id)
    if (i < 0) return
    const next = { ...d.championships[i], ...patch }
    // Carimba (ou apaga) a data de encerramento na troca de status — no
    // Supabase quem faz isso é o gatilho da migration 0020.
    if (patch.status !== undefined && patch.status !== d.championships[i].status) {
      next.finishedAt = patch.status === 'finished' ? new Date().toISOString() : undefined
    }
    d.championships[i] = next
  })
}

export async function deleteChampionship(id: string): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase.from('championships').delete().eq('id', id).select('id')
    if (error) throw error
    if (!data?.length) throw new Error(RECUSADO('excluir'))
    return
  }
  mutate((d) => {
    d.championships = d.championships.filter((c) => c.id !== id)
    d.teams = d.teams.filter((t) => t.championshipId !== id)
    d.players = d.players.filter((p) => p.championshipId !== id)
    d.matches = d.matches.filter((m) => m.championshipId !== id)
    d.events = d.events.filter((e) => e.championshipId !== id)
  })
}
