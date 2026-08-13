import { authMode } from './auth'
import { supabase } from '../lib/supabase'
import { mutate, query } from './demo'
import { uid } from '../lib/id'
import type { Championship } from '../types'

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
    referees: Array.isArray(r.referees) ? r.referees : [],
    venues: Array.isArray(r.venues) ? r.venues : [],
    sponsors: Array.isArray(r.sponsors) ? r.sponsors : [],
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
  if (c.referees !== undefined) row.referees = c.referees
  if (c.venues !== undefined) row.venues = c.venues
  if (c.sponsors !== undefined) row.sponsors = c.sponsors
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

/** Campeonatos EM ANDAMENTO (status "active") visíveis publicamente. */
export async function listPublicChampionships(): Promise<Championship[]> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase
      .from('championships')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(60)
    if (error) throw error
    return (data ?? []).map(fromRow)
  }
  return query((d) =>
    d.championships
      .filter((c) => c.status === 'active')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  )
}

export async function getChampionship(id: string): Promise<Championship | null> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase.from('championships').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    return data ? fromRow(data) : null
  }
  return query((d) => d.championships.find((c) => c.id === id) ?? null)
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
  const champ: Championship = {
    ...input,
    id: uid('champ'),
    ownerId,
    createdAt: new Date().toISOString(),
  }
  return mutate((d) => {
    d.championships.push(champ)
    return champ
  })
}

export async function updateChampionship(
  id: string,
  patch: Partial<Championship>,
): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.from('championships').update(toRow(patch)).eq('id', id)
    if (error) throw error
    return
  }
  mutate((d) => {
    const i = d.championships.findIndex((c) => c.id === id)
    if (i >= 0) d.championships[i] = { ...d.championships[i], ...patch }
  })
}

export async function deleteChampionship(id: string): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.from('championships').delete().eq('id', id)
    if (error) throw error
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
