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
    federated: r.federated ?? false,
    federatedIn: r.federated_in ?? undefined,
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
  if (p.federated !== undefined) row.federated = p.federated
  if (p.federatedIn !== undefined) row.federated_in = p.federatedIn
  return row
}

/**
 * O Supabase devolve o erro como objeto simples — não como `Error`. Lançado
 * assim, a tela não reconhece e mostra só "Erro ao salvar.", escondendo o
 * motivo real. Aqui ele vira `Error` com uma mensagem que o organizador entende.
 */
function erroDoBanco(
  error: { message?: string; code?: string; details?: string },
  acao = 'salvar',
): Error {
  const msg = error?.message ?? ''
  if (error?.code === '42501' || /row-level security/i.test(msg)) {
    return new Error(
      'Sem permissão para salvar atletas neste campeonato. Sua sessão pode ter expirado — saia e entre novamente.',
    )
  }
  if (error?.code === '23505' && /players_cpf_category_unique/.test(msg + (error.details ?? ''))) {
    return new Error('Este CPF já está inscrito nesta categoria.')
  }
  return new Error(msg ? `Erro ao ${acao}: ${msg}` : `Erro ao ${acao}.`)
}

/**
 * O banco não conhece as colunas de federado? Sinal de que a migration 0025
 * ainda não foi aplicada (mesma checagem do portal do time).
 */
function semColunasFederado(error: { message?: string; code?: string }): boolean {
  const m = (error?.message ?? '').toLowerCase()
  return (error?.code === 'PGRST204' || error?.code === '42703') && m.includes('federated')
}

function semFederado(row: Record<string, unknown>): Record<string, unknown> {
  const { federated: _f, federated_in: _fi, ...rest } = row
  return rest
}

/**
 * Atletas por página. A foto mora na própria linha (data URL), então uma
 * consulta única do campeonato inteiro fica pesada a ponto de estourar o tempo
 * do banco — e o PostgREST ainda corta em 1000 linhas. Em páginas, cada pedido
 * é leve e ninguém fica de fora.
 */
const PAGINA = 200

async function listarEmPaginas(championshipId: string, columns: string): Promise<any[]> {
  if (!supabase) return []
  const rows: any[] = []
  for (let from = 0; ; from += PAGINA) {
    const { data, error } = await supabase
      .from('players')
      .select(columns)
      .eq('championship_id', championshipId)
      // `id` desempata: sem ordem estável, uma página pode repetir ou pular
      // atletas com o mesmo número.
      .order('number', { nullsFirst: false })
      .order('id')
      .range(from, from + PAGINA - 1)
    if (error) throw erroDoBanco(error, 'carregar os atletas')
    rows.push(...(data ?? []))
    if (!data || data.length < PAGINA) return rows
  }
}

export async function listPlayers(championshipId: string): Promise<Player[]> {
  if (authMode === 'supabase' && supabase) {
    return (await listarEmPaginas(championshipId, '*')).map(fromRow)
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
  // Só o necessário para a regra do CPF — sem as fotos, que são o peso.
  const players =
    authMode === 'supabase' && supabase
      ? (await listarEmPaginas(championshipId, 'id,team_id,championship_id,name,cpf,category_id')).map(fromRow)
      : await listPlayers(championshipId)
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
    const row = toRow(input)
    let { data, error } = await supabase.from('players').insert(row).select('*').single()
    // Banco sem a migration 0025: inscrever sem a marcação é melhor do que
    // não inscrever.
    if (error && semColunasFederado(error)) {
      ;({ data, error } = await supabase.from('players').insert(semFederado(row)).select('*').single())
    }
    if (error) throw erroDoBanco(error)
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
    const row = toRow(patch)
    let { error } = await supabase.from('players').update(row).eq('id', id)
    if (error && semColunasFederado(error)) {
      ;({ error } = await supabase.from('players').update(semFederado(row)).eq('id', id))
    }
    if (error) throw erroDoBanco(error)
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
    if (error) throw erroDoBanco(error)
    return
  }
  mutate((d) => {
    d.players = d.players.filter((p) => p.id !== id)
  })
}
