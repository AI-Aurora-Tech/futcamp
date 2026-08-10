import { authMode } from './auth'
import { supabase } from '../lib/supabase'
import { mutate, query } from './demo'
import { uid } from '../lib/id'
import type { Player } from '../types'

/* eslint-disable @typescript-eslint/no-explicit-any */

function fromRow(r: any): Player {
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

function toRow(p: Partial<Player>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (p.teamId !== undefined) row.team_id = p.teamId
  if (p.championshipId !== undefined) row.championship_id = p.championshipId
  if (p.name !== undefined) row.name = p.name
  if (p.number !== undefined) row.number = p.number
  if (p.position !== undefined) row.position = p.position
  if (p.birthdate !== undefined) row.birthdate = p.birthdate
  if (p.photo !== undefined) row.photo = p.photo
  return row
}

export async function listPlayers(championshipId: string): Promise<Player[]> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .eq('championship_id', championshipId)
      .order('number', { nullsFirst: false })
    if (error) throw error
    return (data ?? []).map(fromRow)
  }
  return query((d) => d.players.filter((p) => p.championshipId === championshipId))
}

export type NewPlayer = Omit<Player, 'id' | 'createdAt'>

export async function createPlayer(input: NewPlayer): Promise<Player> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase.from('players').insert(toRow(input)).select('*').single()
    if (error) throw error
    return fromRow(data)
  }
  const player: Player = { ...input, id: uid('player'), createdAt: new Date().toISOString() }
  return mutate((d) => {
    d.players.push(player)
    return player
  })
}

export async function updatePlayer(id: string, patch: Partial<Player>): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.from('players').update(toRow(patch)).eq('id', id)
    if (error) throw error
    return
  }
  mutate((d) => {
    const i = d.players.findIndex((p) => p.id === id)
    if (i >= 0) d.players[i] = { ...d.players[i], ...patch }
  })
}

export async function deletePlayer(id: string): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.from('players').delete().eq('id', id)
    if (error) throw error
    return
  }
  mutate((d) => {
    d.players = d.players.filter((p) => p.id !== id)
  })
}
