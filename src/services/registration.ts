// ---------------------------------------------------------------------------
// Inscrição de time via link (sem login).
// O representante do time acessa `#/t/<teamId>?k=<token>` e edita o escudo e o
// elenco. Todas as operações são validadas pelo token.
//
//  • Modo demo: o token vive em Team.accessToken (localStorage).
//  • Modo Supabase: o token vive em `team_invites` e as operações passam por
//    RPCs SECURITY DEFINER (o token nunca é exposto na leitura pública).
// ---------------------------------------------------------------------------
import { authMode } from './auth'
import { supabase } from '../lib/supabase'
import { mutate, query } from './demo'
import { uid } from '../lib/id'
import type { Player, Position, Team } from '../types'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RegistrationData {
  team: Team
  championshipName: string
  championshipLogo?: string
  players: Player[]
}

export interface TeamInfoPatch {
  name?: string
  shortName?: string
  logo?: string
  color?: string
  coach?: string
}

export interface PlayerInput {
  name: string
  number?: number
  position?: Position
}

function playerFromRow(r: any): Player {
  return {
    id: r.id,
    teamId: r.team_id,
    championshipId: r.championship_id,
    name: r.name,
    number: r.number ?? undefined,
    position: r.position ?? undefined,
    birthdate: r.birthdate ?? undefined,
    photo: r.photo ?? undefined,
    createdAt: r.created_at,
  }
}

function teamFromRow(r: any): Team {
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

/** Carrega os dados de inscrição se o token conferir; caso contrário, null. */
export async function loadRegistration(
  teamId: string,
  token: string,
): Promise<RegistrationData | null> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase.rpc('team_registration', {
      p_team: teamId,
      p_token: token,
    })
    if (error || !data) return null
    return {
      team: teamFromRow(data.team),
      championshipName: data.championship_name ?? 'Campeonato',
      championshipLogo: data.championship_logo ?? undefined,
      players: Array.isArray(data.players) ? data.players.map(playerFromRow) : [],
    }
  }

  return query((d) => {
    const team = d.teams.find((t) => t.id === teamId)
    if (!team || !team.accessToken || team.accessToken !== token) return null
    const champ = d.championships.find((c) => c.id === team.championshipId)
    return {
      team,
      championshipName: champ?.name ?? 'Campeonato',
      championshipLogo: champ?.logo,
      players: d.players
        .filter((p) => p.teamId === teamId)
        .sort((a, b) => (a.number ?? 99) - (b.number ?? 99)),
    }
  })
}

function assertTokenDemo(teamId: string, token: string): void {
  const ok = query((d) => {
    const t = d.teams.find((x) => x.id === teamId)
    return Boolean(t && t.accessToken && t.accessToken === token)
  })
  if (!ok) throw new Error('Link inválido ou expirado.')
}

export async function saveTeamInfo(
  teamId: string,
  token: string,
  patch: TeamInfoPatch,
): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.rpc('reg_update_team', {
      p_team: teamId,
      p_token: token,
      p_name: patch.name ?? null,
      p_short: patch.shortName ?? null,
      p_logo: patch.logo ?? null,
      p_color: patch.color ?? null,
      p_coach: patch.coach ?? null,
    })
    if (error) throw error
    return
  }
  assertTokenDemo(teamId, token)
  mutate((d) => {
    const i = d.teams.findIndex((t) => t.id === teamId)
    if (i >= 0) {
      const t = d.teams[i]
      d.teams[i] = {
        ...t,
        name: patch.name ?? t.name,
        shortName: patch.shortName ?? t.shortName,
        logo: patch.logo ?? t.logo,
        color: patch.color ?? t.color,
        coach: patch.coach ?? t.coach,
      }
    }
  })
}

export async function addRegPlayer(
  teamId: string,
  token: string,
  input: PlayerInput,
): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.rpc('reg_add_player', {
      p_team: teamId,
      p_token: token,
      p_name: input.name,
      p_number: input.number ?? null,
      p_position: input.position ?? null,
    })
    if (error) throw error
    return
  }
  assertTokenDemo(teamId, token)
  mutate((d) => {
    const team = d.teams.find((t) => t.id === teamId)
    if (!team) return
    d.players.push({
      id: uid('player'),
      teamId,
      championshipId: team.championshipId,
      name: input.name,
      number: input.number,
      position: input.position,
      createdAt: new Date().toISOString(),
    })
  })
}

export async function updateRegPlayer(
  teamId: string,
  token: string,
  playerId: string,
  patch: PlayerInput,
): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.rpc('reg_update_player', {
      p_team: teamId,
      p_token: token,
      p_player: playerId,
      p_name: patch.name,
      p_number: patch.number ?? null,
      p_position: patch.position ?? null,
    })
    if (error) throw error
    return
  }
  assertTokenDemo(teamId, token)
  mutate((d) => {
    const i = d.players.findIndex((p) => p.id === playerId && p.teamId === teamId)
    if (i >= 0) {
      d.players[i] = {
        ...d.players[i],
        name: patch.name,
        number: patch.number,
        position: patch.position,
      }
    }
  })
}

export async function removeRegPlayer(
  teamId: string,
  token: string,
  playerId: string,
): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.rpc('reg_delete_player', {
      p_team: teamId,
      p_token: token,
      p_player: playerId,
    })
    if (error) throw error
    return
  }
  assertTokenDemo(teamId, token)
  mutate((d) => {
    d.players = d.players.filter((p) => !(p.id === playerId && p.teamId === teamId))
  })
}
