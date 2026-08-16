import { authMode } from './auth'
import { supabase } from '../lib/supabase'
import { mutate, query } from './demo'
import { uid } from '../lib/id'
import { checkCpfConflict } from '../lib/duplicates'
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
    cpf: r.cpf ?? undefined,
    categoryId: r.category_id ?? undefined,
    role: r.role ?? undefined,
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
  if (p.cpf !== undefined) row.cpf = p.cpf
  if (p.categoryId !== undefined) row.category_id = p.categoryId
  if (p.role !== undefined) row.role = p.role
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

/**
 * Um CPF pertence a um único time dentro do campeonato (podendo repetir no
 * mesmo time em outra categoria). Vale para o painel do administrador e para o
 * modo demo; no Supabase a mesma regra é garantida por índice e gatilho.
 */
async function assertCpfAvailable(
  championshipId: string,
  patch: Partial<Player>,
  ignorePlayerId?: string,
): Promise<void> {
  const cpf = (patch.cpf ?? '').replace(/\D/g, '')
  if (!cpf || !patch.teamId) return
  const players = await listPlayers(championshipId)
  const teams = await listTeamNames(championshipId)
  const check = checkCpfConflict({
    cpf,
    teamId: patch.teamId,
    categoryId: patch.categoryId,
    players,
    teamName: (id) => teams.get(id),
    ignorePlayerId,
  })
  if (!check.ok) throw new Error(check.reason ?? 'CPF já inscrito neste campeonato.')
}

/** Nomes dos times do campeonato (só para compor a mensagem de erro). */
async function listTeamNames(championshipId: string): Promise<Map<string, string>> {
  if (authMode === 'supabase' && supabase) {
    const { data } = await supabase
      .from('teams')
      .select('id,name')
      .eq('championship_id', championshipId)
    return new Map((data ?? []).map((t: any) => [t.id as string, t.name as string]))
  }
  return query(
    (d) =>
      new Map(
        d.teams.filter((t) => t.championshipId === championshipId).map((t) => [t.id, t.name]),
      ),
  )
}

export async function createPlayer(input: NewPlayer): Promise<Player> {
  await assertCpfAvailable(input.championshipId, input)
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
  if (patch.championshipId && patch.cpf !== undefined) {
    await assertCpfAvailable(patch.championshipId, patch, id)
  }
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
