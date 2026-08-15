import { authMode } from './auth'
import { supabase } from '../lib/supabase'
import { mutate, query } from './demo'
import { uid } from '../lib/id'
import {
  generateGroupFixtures,
  generateRoundRobin,
  seedKnockoutPairings,
} from '../lib/fixtures'
import type { LineupEntry, Match, MatchEvent, MatchPhase } from '../types'

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
 * Gera automaticamente a tabela de pontos corridos (todos contra todos) e
 * substitui as partidas existentes do campeonato.
 */
export async function generateLeague(
  championshipId: string,
  teamIds: string[],
  doubleRound: boolean,
): Promise<void> {
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
): Promise<void> {
  const pairings = generateGroupFixtures(groups, doubleRound)
  await deleteMatchesOf(championshipId)
  const toInsert: NewMatch[] = pairings.map((p) => ({
    championshipId,
    round: p.round,
    phase: 'group' as MatchPhase,
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
 * Gera a fase inicial de mata-mata a partir de uma lista de times já ordenada
 * por "seed" (1º vs último). Substitui as partidas existentes.
 */
export async function generateKnockout(
  championshipId: string,
  seededTeamIds: string[],
): Promise<void> {
  const pairings = seedKnockoutPairings(seededTeamIds)
  await deleteMatchesOf(championshipId)
  const toInsert: NewMatch[] = pairings.map((p, i) => ({
    championshipId,
    round: i + 1,
    phase: (p.group as MatchPhase) ?? 'final',
    homeTeamId: p.homeTeamId,
    awayTeamId: p.awayTeamId,
    homeScore: null,
    awayScore: null,
    status: 'scheduled',
  }))
  await bulkInsert(championshipId, toInsert)
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
