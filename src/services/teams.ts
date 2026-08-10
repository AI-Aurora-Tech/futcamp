import { authMode } from './auth'
import { supabase } from '../lib/supabase'
import { mutate, query } from './demo'
import { accessToken, uid } from '../lib/id'
import type { Team } from '../types'

/* eslint-disable @typescript-eslint/no-explicit-any */

function fromRow(r: any): Team {
  return {
    id: r.id,
    championshipId: r.championship_id,
    name: r.name,
    shortName: r.short_name ?? undefined,
    logo: r.logo ?? undefined,
    group: r.group ?? undefined,
    color: r.color ?? undefined,
    coach: r.coach ?? undefined,
    createdAt: r.created_at,
  }
}

function toRow(t: Partial<Team>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (t.championshipId !== undefined) row.championship_id = t.championshipId
  if (t.name !== undefined) row.name = t.name
  if (t.shortName !== undefined) row.short_name = t.shortName
  if (t.logo !== undefined) row.logo = t.logo
  if (t.group !== undefined) row.group = t.group
  if (t.color !== undefined) row.color = t.color
  if (t.coach !== undefined) row.coach = t.coach
  return row
}

export async function listTeams(championshipId: string): Promise<Team[]> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase
      .from('teams')
      .select('*')
      .eq('championship_id', championshipId)
      .order('name')
    if (error) throw error
    return (data ?? []).map(fromRow)
  }
  return query((d) =>
    d.teams.filter((t) => t.championshipId === championshipId).sort((a, b) => a.name.localeCompare(b.name)),
  )
}

export type NewTeam = Omit<Team, 'id' | 'createdAt'>

export async function createTeam(input: NewTeam): Promise<Team> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase.from('teams').insert(toRow(input)).select('*').single()
    if (error) throw error
    return fromRow(data)
  }
  const team: Team = {
    ...input,
    accessToken: input.accessToken ?? accessToken(),
    id: uid('team'),
    createdAt: new Date().toISOString(),
  }
  return mutate((d) => {
    d.teams.push(team)
    return team
  })
}

/**
 * Garante que o time tenha um token de link de inscrição e o retorna.
 * No modo Supabase o token vive em `team_invites` (via RPC `ensure_team_invite`),
 * nunca exposto na leitura pública dos times.
 */
export async function ensureTeamToken(teamId: string): Promise<string> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase.rpc('ensure_team_invite', { p_team: teamId })
    if (error) throw error
    return data as string
  }
  return mutate((d) => {
    const t = d.teams.find((x) => x.id === teamId)
    if (!t) throw new Error('Time não encontrado.')
    if (!t.accessToken) t.accessToken = accessToken()
    return t.accessToken
  })
}

export async function updateTeam(id: string, patch: Partial<Team>): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.from('teams').update(toRow(patch)).eq('id', id)
    if (error) throw error
    return
  }
  mutate((d) => {
    const i = d.teams.findIndex((t) => t.id === id)
    if (i >= 0) d.teams[i] = { ...d.teams[i], ...patch }
  })
}

export async function deleteTeam(id: string): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.from('teams').delete().eq('id', id)
    if (error) throw error
    return
  }
  mutate((d) => {
    d.teams = d.teams.filter((t) => t.id !== id)
    d.players = d.players.filter((p) => p.teamId !== id)
  })
}
