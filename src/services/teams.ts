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
    phone: r.phone ?? undefined,
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
  if (t.phone !== undefined) row.phone = t.phone
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

/**
 * Garante (e retorna) o token do link público de CRIAÇÃO de time do campeonato.
 * O organizador envia `#/novo-time/<championshipId>?k=<token>`.
 */
export async function ensureChampTeamToken(championshipId: string): Promise<string> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase.rpc('ensure_champ_team_invite', { p_champ: championshipId })
    if (error) throw error
    return data as string
  }
  return mutate((d) => {
    const c = d.championships.find((x) => x.id === championshipId)
    if (!c) throw new Error('Campeonato não encontrado.')
    if (!c.teamCreateToken) c.teamCreateToken = accessToken()
    return c.teamCreateToken
  })
}

export interface CreateTeamViaLinkInput {
  name: string
  shortName?: string
  logo?: string
  color?: string
  coach?: string
  phone?: string
  group?: string
}

/**
 * Cria um time a partir do link público de criação (valida o token do campeonato)
 * e devolve o `teamId` e o `token` de inscrição, para o responsável seguir
 * inscrevendo os atletas em `#/t/<teamId>?k=<token>`.
 */
export async function createTeamViaLink(
  championshipId: string,
  token: string,
  input: CreateTeamViaLinkInput,
): Promise<{ teamId: string; token: string }> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase.rpc('create_team_via_invite', {
      p_champ: championshipId,
      p_token: token,
      p_name: input.name.trim(),
      p_short: input.shortName?.trim() || null,
      p_logo: input.logo || null,
      p_color: input.color || null,
      p_coach: input.coach?.trim() || null,
      p_phone: input.phone?.trim() || null,
      p_group: input.group || null,
    })
    if (error) throw error
    const row = data as { team_id: string; token: string }
    return { teamId: row.team_id, token: row.token }
  }
  return mutate((d) => {
    const c = d.championships.find((x) => x.id === championshipId)
    if (!c || !c.teamCreateToken || c.teamCreateToken !== token) {
      throw new Error('Link de criação inválido ou expirado.')
    }
    const tok = accessToken()
    const team: Team = {
      id: uid('team'),
      championshipId,
      name: input.name.trim(),
      shortName: input.shortName?.trim() || undefined,
      logo: input.logo || undefined,
      color: input.color || undefined,
      coach: input.coach?.trim() || undefined,
      phone: input.phone?.trim() || undefined,
      group: input.group || undefined,
      accessToken: tok,
      createdAt: new Date().toISOString(),
    }
    d.teams.push(team)
    return { teamId: team.id, token: tok }
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

export interface TeamManager {
  username: string
  /** Senha zerada pelo administrador (aguardando o gestor criar nova senha). */
  reset: boolean
}

/** Lista os gestores (até 2) do time e se cada um está com a senha zerada. */
export async function listTeamManagers(teamId: string): Promise<TeamManager[]> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase.rpc('team_managers', { p_team: teamId })
    if (error) throw error
    const r = (data ?? {}) as {
      username?: string | null
      reset1?: boolean
      username2?: string | null
      reset2?: boolean
    }
    const out: TeamManager[] = []
    if (r.username) out.push({ username: r.username, reset: Boolean(r.reset1) })
    if (r.username2) out.push({ username: r.username2, reset: Boolean(r.reset2) })
    return out
  }
  return query((d) => {
    const t = d.teams.find((x) => x.id === teamId)
    const out: TeamManager[] = []
    if (t?.username) out.push({ username: t.username, reset: !t.passwordHash })
    if (t?.username2) out.push({ username: t.username2, reset: !t.passwordHash2 })
    return out
  })
}

/**
 * Administrador ZERA (recupera) a senha de um gestor do time. No próximo login
 * pelo link de inscrição, o gestor deverá criar uma nova senha.
 */
export async function resetTeamManagerPassword(teamId: string, username: string): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.rpc('reset_team_manager_password', {
      p_team: teamId,
      p_username: username,
    })
    if (error) throw error
    return
  }
  mutate((d) => {
    const t = d.teams.find((x) => x.id === teamId)
    if (!t) return
    if (t.username === username) t.passwordHash = '' // '' = senha zerada
    if (t.username2 === username) t.passwordHash2 = ''
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
