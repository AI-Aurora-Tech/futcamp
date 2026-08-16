import { authMode } from './auth'
import { supabase } from '../lib/supabase'
import { mutate, query } from './demo'
import { uid } from '../lib/id'
import { generateGroupFixtures, generateRoundRobin } from '../lib/fixtures'
import {
  hasKnockoutStage,
  KNOCKOUT_ROUND_BASE,
  pendingAdvances,
  planKnockout,
  resolveBracketTeams,
} from '../lib/knockout'
import {
  allGroupStagesComplete,
  distributeIntoGroups,
  groupStagesOf,
  nextGroupStageToCreate,
  qualifiersOfStage,
  stageExists,
} from '../lib/groupStages'
import type {
  Championship,
  LineupEntry,
  Match,
  MatchEvent,
  MatchPhase,
  Team,
} from '../types'

/* eslint-disable @typescript-eslint/no-explicit-any */

function fromRow(r: any): Match {
  return {
    id: r.id,
    championshipId: r.championship_id,
    round: r.round,
    phase: r.phase,
    group: r.group ?? undefined,
    homeTeamId: r.home_team_id,
    awayTeamId: r.away_team_id,
    homeScore: r.home_score,
    awayScore: r.away_score,
    status: r.status,
    scheduledAt: r.scheduled_at ?? undefined,
    venue: r.venue ?? undefined,
    refereeId: r.referee_id ?? undefined,
    officialId: r.official_id ?? undefined,
    incidents: r.incidents ?? undefined,
    lineup: Array.isArray(r.lineup) ? r.lineup : undefined,
    bracketPos: r.bracket_pos ?? undefined,
    winnerTeamId: r.winner_team_id ?? undefined,
    penaltyHome: r.penalty_home ?? undefined,
    penaltyAway: r.penalty_away ?? undefined,
    stage: r.stage ?? undefined,
    createdAt: r.created_at,
  }
}

function toRow(m: Partial<Match>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (m.championshipId !== undefined) row.championship_id = m.championshipId
  if (m.round !== undefined) row.round = m.round
  if (m.phase !== undefined) row.phase = m.phase
  if (m.group !== undefined) row.group = m.group
  if (m.homeTeamId !== undefined) row.home_team_id = m.homeTeamId
  if (m.awayTeamId !== undefined) row.away_team_id = m.awayTeamId
  if (m.homeScore !== undefined) row.home_score = m.homeScore
  if (m.awayScore !== undefined) row.away_score = m.awayScore
  if (m.status !== undefined) row.status = m.status
  if (m.scheduledAt !== undefined) row.scheduled_at = m.scheduledAt
  if (m.venue !== undefined) row.venue = m.venue
  if (m.refereeId !== undefined) row.referee_id = m.refereeId
  if (m.officialId !== undefined) row.official_id = m.officialId
  if (m.incidents !== undefined) row.incidents = m.incidents
  if (m.lineup !== undefined) row.lineup = m.lineup
  if (m.bracketPos !== undefined) row.bracket_pos = m.bracketPos
  if (m.winnerTeamId !== undefined) row.winner_team_id = m.winnerTeamId
  if (m.penaltyHome !== undefined) row.penalty_home = m.penaltyHome
  if (m.penaltyAway !== undefined) row.penalty_away = m.penaltyAway
  if (m.stage !== undefined) row.stage = m.stage
  return row
}

/**
 * Abstração de escrita de partida — permite que o modal de resultado seja usado
 * tanto pelo administrador (serviço padrão) quanto pelo mesário (writer restrito
 * aos jogos atribuídos). Ver services/officials.ts.
 */
export interface MatchWriter {
  listEvents(championshipId: string): Promise<MatchEvent[]>
  updateMatch(id: string, patch: Partial<Match>): Promise<void>
  addEvent(input: NewEvent): Promise<MatchEvent>
  deleteEvent(id: string): Promise<void>
  /** Salva a escalação (atletas presentes + número da camisa da partida). */
  setLineup(matchId: string, lineup: LineupEntry[]): Promise<void>
}

export async function listMatches(championshipId: string): Promise<Match[]> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('championship_id', championshipId)
      .order('round')
      .order('created_at')
    if (error) throw error
    return (data ?? []).map(fromRow)
  }
  return query((d) =>
    d.matches
      .filter((m) => m.championshipId === championshipId)
      .sort((a, b) => a.round - b.round || a.createdAt.localeCompare(b.createdAt)),
  )
}

export type NewMatch = Omit<Match, 'id' | 'createdAt'>

export async function createMatch(input: NewMatch): Promise<Match> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase.from('matches').insert(toRow(input)).select('*').single()
    if (error) throw error
    return fromRow(data)
  }
  const match: Match = { ...input, id: uid('match'), createdAt: new Date().toISOString() }
  return mutate((d) => {
    d.matches.push(match)
    return match
  })
}

export async function updateMatch(id: string, patch: Partial<Match>): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.from('matches').update(toRow(patch)).eq('id', id)
    if (error) throw error
    return
  }
  mutate((d) => {
    const i = d.matches.findIndex((m) => m.id === id)
    if (i >= 0) d.matches[i] = { ...d.matches[i], ...patch }
  })
}

export async function deleteMatch(id: string): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.from('matches').delete().eq('id', id)
    if (error) throw error
    return
  }
  mutate((d) => {
    d.matches = d.matches.filter((m) => m.id !== id)
    d.events = d.events.filter((e) => e.matchId !== id)
  })
}

/** Remove todas as partidas de um campeonato (regerar tabela). */
export async function deleteMatchesOf(championshipId: string): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.from('matches').delete().eq('championship_id', championshipId)
    if (error) throw error
    return
  }
  mutate((d) => {
    d.matches = d.matches.filter((m) => m.championshipId !== championshipId)
    d.events = d.events.filter((e) => e.championshipId !== championshipId)
  })
}

/**
 * Trava de segurança da regeração da tabela: com jogos já encerrados, apagar
 * tudo levaria junto placares, gols, cartões e súmulas. Só passa com `force`
 * (administrador master, que confirma a perda explicitamente).
 */
async function assertRegenerationAllowed(championshipId: string, force: boolean): Promise<void> {
  if (force) return
  const existing = await listMatches(championshipId)
  const finished = existing.filter((m) => m.status === 'finished').length
  if (finished > 0) {
    throw new Error(
      `Não é possível regerar a tabela: ${finished} jogo(s) já foram encerrados. ` +
        'Regerar apagaria os resultados já registrados.',
    )
  }
}

/**
 * Gera automaticamente a tabela de pontos corridos (todos contra todos) e
 * substitui as partidas existentes do campeonato.
 */
export async function generateLeague(
  championshipId: string,
  teamIds: string[],
  doubleRound: boolean,
  force = false,
): Promise<void> {
  await assertRegenerationAllowed(championshipId, force)
  const pairings = generateRoundRobin(teamIds, doubleRound)
  await deleteMatchesOf(championshipId)
  const toInsert: NewMatch[] = pairings.map((p) => ({
    championshipId,
    round: p.round,
    phase: 'group' as MatchPhase,
    homeTeamId: p.homeTeamId,
    awayTeamId: p.awayTeamId,
    homeScore: null,
    awayScore: null,
    status: 'scheduled',
  }))
  await bulkInsert(championshipId, toInsert)
}

/** Gera a tabela de fase de grupos (round-robin dentro de cada grupo). */
export async function generateGroups(
  championshipId: string,
  groups: Record<string, string[]>,
  doubleRound: boolean,
  force = false,
): Promise<void> {
  await assertRegenerationAllowed(championshipId, force)
  const pairings = generateGroupFixtures(groups, doubleRound)
  await deleteMatchesOf(championshipId)
  const toInsert: NewMatch[] = pairings.map((p) => ({
    championshipId,
    round: p.round,
    phase: 'group' as MatchPhase,
    stage: 1,
    group: p.group,
    homeTeamId: p.homeTeamId,
    awayTeamId: p.awayTeamId,
    homeScore: null,
    awayScore: null,
    status: 'scheduled',
  }))
  await bulkInsert(championshipId, toInsert)
}

/**
 * Cria a PRÓXIMA fase de grupos com os classificados da fase anterior,
 * respeitando o número de vagas de cada grupo, e distribuindo os times nos
 * novos grupos. As rodadas continuam a numeração da fase anterior, para não
 * conflitar com o fechamento de inscrições por rodada.
 */
export async function createGroupStage(
  champ: Championship,
  teams: Team[],
  matches: Match[],
  stage: number,
  events: MatchEvent[] = [],
): Promise<boolean> {
  const cfg = groupStagesOf(champ)[stage - 1]
  if (!cfg || stage < 2) return false

  const qualified = qualifiersOfStage(champ, teams, matches, stage - 1, events)
  if (qualified.length < 2) return false

  const groups = distributeIntoGroups(qualified, cfg.numGroups)
  const playable = Object.fromEntries(
    Object.entries(groups).filter(([, ids]) => ids.length >= 2),
  )
  if (Object.keys(playable).length === 0) return false

  // Relê antes de inserir: não cria a mesma fase duas vezes.
  const fresh = await listMatches(champ.id)
  if (stageExists(fresh, stage)) return false

  const previousRounds = Math.max(
    0,
    ...fresh
      .filter((m) => m.phase === 'group')
      .map((m) => m.round)
      .filter((r) => r < KNOCKOUT_ROUND_BASE),
    0,
  )
  const pairings = generateGroupFixtures(playable, cfg.doubleRound ?? false)
  const toInsert: NewMatch[] = pairings.map((p) => ({
    championshipId: champ.id,
    round: previousRounds + p.round,
    phase: 'group' as MatchPhase,
    stage,
    group: p.group,
    homeTeamId: p.homeTeamId,
    awayTeamId: p.awayTeamId,
    homeScore: null,
    awayScore: null,
    status: 'scheduled',
  }))
  await bulkInsert(champ.id, toInsert)
  return true
}

/**
 * Gera o mata-mata completo (da fase inicial até a final) a partir de uma lista
 * de times já ordenada por "seed" (1º vs último). Substitui as partidas
 * existentes.
 */
export async function generateKnockout(
  championshipId: string,
  seededTeamIds: string[],
  thirdPlace = false,
  force = false,
): Promise<void> {
  await assertRegenerationAllowed(championshipId, force)
  const size = Math.max(2, nextPowerOfTwo(seededTeamIds.length))
  const padded: (string | null)[] = [...seededTeamIds]
  while (padded.length < size) padded.push(null)
  const pairs = Array.from({ length: size / 2 }, (_, i) => ({
    home: padded[i],
    away: padded[size - 1 - i],
  }))
  await deleteMatchesOf(championshipId)
  await bulkInsert(championshipId, plannedToMatches(championshipId, planKnockout(pairs, thirdPlace)))
}

function nextPowerOfTwo(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

function plannedToMatches(
  championshipId: string,
  planned: ReturnType<typeof planKnockout>,
): NewMatch[] {
  return planned.map((p) => ({
    championshipId,
    round: p.round,
    phase: p.phase,
    homeTeamId: p.homeTeamId,
    awayTeamId: p.awayTeamId,
    homeScore: null,
    awayScore: null,
    status: p.status,
    bracketPos: p.bracketPos,
  }))
}

/**
 * Cria a fase de mata-mata do campeonato com as equipes classificadas na
 * primeira fase, respeitando o chaveamento configurado ("quem pega quem").
 * Não mexe nos jogos da primeira fase.
 */
export async function createKnockoutStage(
  champ: Championship,
  teams: Team[],
  matches: Match[],
  events: MatchEvent[] = [],
): Promise<boolean> {
  const pairs = resolveBracketTeams(champ, teams, matches, events)
  if (pairs.length === 0 || pairs.every((p) => !p.home && !p.away)) return false
  // Relê as partidas imediatamente antes de inserir: evita criar a fase duas
  // vezes quando duas telas (ou dois efeitos) disparam a criação juntas.
  const fresh = await listMatches(champ.id)
  if (fresh.some((m) => m.phase !== 'group')) return false
  await bulkInsert(champ.id, plannedToMatches(champ.id, planKnockout(pairs, champ.thirdPlace)))
  return true
}

/**
 * Mantém o mata-mata em dia:
 *  1. cria a fase eliminatória assim que TODOS os jogos da primeira fase são
 *     encerrados (se o campeonato prevê mata-mata e a criação automática está
 *     ligada);
 *  2. leva os vencedores (e os perdedores das semis, na disputa de 3º) para os
 *     confrontos da fase seguinte.
 *
 * Devolve `true` quando algo mudou — o chamador deve recarregar os dados.
 */
export function syncKnockout(
  champ: Championship,
  teams: Team[],
  matches: Match[],
  events: MatchEvent[] = [],
): Promise<boolean> {
  // Uma sincronização por campeonato de cada vez: duas chamadas simultâneas
  // (React StrictMode, duas abas do app) não podem criar o mata-mata em dobro.
  const running = inFlightSync.get(champ.id)
  if (running) return running
  const p = runSync(champ, teams, matches, events).finally(() => inFlightSync.delete(champ.id))
  inFlightSync.set(champ.id, p)
  return p
}

const inFlightSync = new Map<string, Promise<boolean>>()

async function runSync(
  champ: Championship,
  teams: Team[],
  matches: Match[],
  events: MatchEvent[],
): Promise<boolean> {
  let changed = false
  let current = matches

  // 1) Fases de grupos seguintes (2ª, 3ª…) com os classificados da anterior.
  for (let guard = 0; guard < 8; guard++) {
    const next = nextGroupStageToCreate(champ, current)
    if (next == null) break
    if (!(await createGroupStage(champ, teams, current, next, events))) break
    changed = true
    current = await listMatches(champ.id)
  }

  // 2) Mata-mata, quando TODAS as fases de grupos terminaram.
  const hasKnockoutMatches = current.some((m) => m.phase !== 'group')
  if (
    !hasKnockoutMatches &&
    champ.autoKnockout !== false &&
    hasKnockoutStage(champ) &&
    allGroupStagesComplete(champ, current)
  ) {
    if (await createKnockoutStage(champ, teams, current, events)) {
      changed = true
      current = await listMatches(champ.id)
    }
  }

  for (const { id, patch } of pendingAdvances(current)) {
    await updateMatch(id, patch)
    changed = true
  }

  return changed
}

/**
 * Mesma sincronização, porém acionável por quem NÃO tem escrita direta nas
 * partidas (o mesário). No Supabase passa pelas funções `ensure_knockout_stage`
 * e `advance_bracket` (migration 0015), que validam as regras no banco; no modo
 * demo cai no fluxo normal.
 */
export async function requestKnockoutSync(
  champ: Championship,
  teams: Team[],
  matches: Match[],
  events: MatchEvent[] = [],
): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    // As funções do banco revalidam as regras e serializam a criação.
    const stages = groupStagesOf(champ)

    // Próxima fase de grupos (2ª, 3ª…) com os classificados da anterior.
    const next = nextGroupStageToCreate(champ, matches)
    if (next != null) {
      const cfg = stages[next - 1]
      const qualified = qualifiersOfStage(champ, teams, matches, next - 1, events)
      const groups = distributeIntoGroups(qualified, cfg.numGroups)
      const playable = Object.fromEntries(
        Object.entries(groups).filter(([, ids]) => ids.length >= 2),
      )
      const previousRounds = Math.max(
        0,
        ...matches
          .filter((m) => m.phase === 'group')
          .map((m) => m.round)
          .filter((r) => r < KNOCKOUT_ROUND_BASE),
        0,
      )
      const plan = generateGroupFixtures(playable, cfg.doubleRound ?? false).map((p) => ({
        round: previousRounds + p.round,
        group: p.group,
        home_team_id: p.homeTeamId,
        away_team_id: p.awayTeamId,
      }))
      if (plan.length > 0) {
        const { error } = await supabase.rpc('ensure_group_stage', {
          p_champ: champ.id,
          p_stage: next,
          p_matches: plan,
        })
        if (error) console.warn('ensure_group_stage:', error.message)
      }
    }

    const hasKnockoutMatches = matches.some((m) => m.phase !== 'group')
    if (
      !hasKnockoutMatches &&
      champ.autoKnockout !== false &&
      hasKnockoutStage(champ) &&
      allGroupStagesComplete(champ, matches)
    ) {
      const pairs = resolveBracketTeams(champ, teams, matches, events)
      const plan = planKnockout(pairs, champ.thirdPlace).map((p) => ({
        round: p.round,
        phase: p.phase,
        home_team_id: p.homeTeamId,
        away_team_id: p.awayTeamId,
        bracket_pos: p.bracketPos,
      }))
      const { error } = await supabase.rpc('ensure_knockout_stage', {
        p_champ: champ.id,
        p_matches: plan,
        p_stages: Math.max(1, stages.length),
      })
      if (error) console.warn('ensure_knockout_stage:', error.message)
    }
    const { error } = await supabase.rpc('advance_bracket', { p_champ: champ.id })
    if (error) console.warn('advance_bracket:', error.message)
    return
  }
  await syncKnockout(champ, teams, matches, events)
}

async function bulkInsert(championshipId: string, matches: NewMatch[]): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const rows = matches.map(toRow)
    const { error } = await supabase.from('matches').insert(rows)
    if (error) throw error
    return
  }
  mutate((d) => {
    for (const m of matches) {
      d.matches.push({ ...m, id: uid('match'), createdAt: new Date().toISOString() })
    }
    void championshipId
  })
}

/** Salva a escalação da partida (atletas presentes + números). */
export async function setLineup(matchId: string, lineup: LineupEntry[]): Promise<void> {
  return updateMatch(matchId, { lineup })
}

/** Writer padrão (administrador). */
export const defaultMatchWriter: MatchWriter = { listEvents, updateMatch, addEvent, deleteEvent, setLineup }

// ---------------------------------------------------------------------------
// Eventos de partida
// ---------------------------------------------------------------------------

function eventFromRow(r: any): MatchEvent {
  return {
    id: r.id,
    matchId: r.match_id,
    championshipId: r.championship_id,
    teamId: r.team_id,
    playerId: r.player_id ?? undefined,
    playerInId: r.player_in_id ?? undefined,
    detail: r.detail ?? undefined,
    type: r.type,
    minute: r.minute ?? undefined,
    createdAt: r.created_at,
  }
}

function eventToRow(e: Partial<MatchEvent>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (e.matchId !== undefined) row.match_id = e.matchId
  if (e.championshipId !== undefined) row.championship_id = e.championshipId
  if (e.teamId !== undefined) row.team_id = e.teamId
  if (e.playerId !== undefined) row.player_id = e.playerId
  if (e.playerInId !== undefined) row.player_in_id = e.playerInId
  if (e.detail !== undefined) row.detail = e.detail
  if (e.type !== undefined) row.type = e.type
  if (e.minute !== undefined) row.minute = e.minute
  return row
}

export async function listEvents(championshipId: string): Promise<MatchEvent[]> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase
      .from('match_events')
      .select('*')
      .eq('championship_id', championshipId)
    if (error) throw error
    return (data ?? []).map(eventFromRow)
  }
  return query((d) => d.events.filter((e) => e.championshipId === championshipId))
}

export type NewEvent = Omit<MatchEvent, 'id' | 'createdAt'>

export async function addEvent(input: NewEvent): Promise<MatchEvent> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase.from('match_events').insert(eventToRow(input)).select('*').single()
    if (error) throw error
    return eventFromRow(data)
  }
  const ev: MatchEvent = { ...input, id: uid('ev'), createdAt: new Date().toISOString() }
  return mutate((d) => {
    d.events.push(ev)
    return ev
  })
}

export async function deleteEvent(id: string): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.from('match_events').delete().eq('id', id)
    if (error) throw error
    return
  }
  mutate((d) => {
    d.events = d.events.filter((e) => e.id !== id)
  })
}
