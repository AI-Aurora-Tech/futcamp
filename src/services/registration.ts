// ---------------------------------------------------------------------------
// Inscrição de time via link (sem conta no app principal).
//
// Fluxo: o organizador envia `#/t/<teamId>?k=<token>`. Pelo link o responsável
// CRIA um usuário e senha do time e, autenticado, inscreve os atletas
// (NOME COMPLETO, CPF, DATA DE NASCIMENTO e FOTO opcional). A inscrição respeita
// a categoria e a regra de ano de nascimento do campeonato.
//
//  • Modo demo: token/credenciais no localStorage; validação client-side.
//  • Modo Supabase: token em `team_invites` e operações via RPCs SECURITY
//    DEFINER (ver migration 0003/0004).
// ---------------------------------------------------------------------------
import { authMode } from './auth'
import { supabase } from '../lib/supabase'
import { mutate, query } from './demo'
import { uid } from '../lib/id'
import { checkEligibility, checkRosterLimit } from '../lib/eligibility'
import { podeMarcarFederado } from '../lib/federated'
import { checkCpfConflict } from '../lib/duplicates'
import { registrationLockForTeam } from '../lib/matchWindow'
import type { Category, Championship, Match, Player, Position, Team } from '../types'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RegistrationData {
  team: Team
  championshipId: string
  championshipName: string
  championshipLogo?: string
  audience: 'infantil' | 'adulto'
  /** O campeonato aceita atletas federados? (infantil) */
  allowFederated: boolean
  /** Quantos por time. `null` = sem limite. */
  maxFederated: number | null
  categories: Category[]
  players: Player[]
  hasAccount: boolean
  /** Usuários dos gestores do time já cadastrados (até 2). */
  managers: string[]
  /** Prazo de inscrição (horas antes da partida). 0 = sem prazo. */
  registrationCutoffHours: number
  /** Rodadas com inscrições encerradas manualmente pelo organizador. */
  closedRounds: number[]
  /** Partidas do time (para calcular a trava de inscrição). */
  matches: Match[]
  /** Regras do campeonato, para o time baixar o regulamento. */
  championship?: Championship
}

export interface TeamInfoPatch {
  name?: string
  shortName?: string
  logo?: string
  color?: string
  coach?: string
  phone?: string
}

export interface PlayerInput {
  name: string
  cpf?: string
  birthdate?: string
  photo?: string
  number?: number
  position?: Position
  categoryId?: string
  role?: 'atleta' | 'comissao'
  federated?: boolean
  federatedIn?: 'campo' | 'futsal' | 'ambos'
}

/**
 * A RPC reclamou por não conhecer os parâmetros de federado? Sinal de que a
 * migration 0025 ainda não foi aplicada.
 */
function semMigration0025(error: { message?: string; code?: string }): boolean {
  const m = (error?.message ?? '').toLowerCase()
  return error?.code === 'PGRST202' || m.includes('does not exist') || m.includes('p_federated')
}

/** Hash leve de senha (apenas modo demo; o Supabase usa pgcrypto). */
function demoHash(password: string): string {
  let h = 5381
  const s = `futcamp:${password}`
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(16)
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
    cpf: r.cpf ?? undefined,
    categoryId: r.category_id ?? undefined,
    role: r.role ?? undefined,
    federated: r.federated ?? false,
    federatedIn: r.federated_in ?? undefined,
    createdAt: r.created_at,
  }
}

/**
 * Campeonato como o time o enxerga: só as regras da competição, que é o que
 * entra no regulamento. A RPC nem devolve o resto.
 */
function champFromRow(r: any): Championship {
  return {
    id: r.id,
    ownerId: '',
    name: r.name,
    sport: r.sport,
    audience: r.audience ?? 'adulto',
    categories: Array.isArray(r.categories) ? r.categories : [],
    format: r.format ?? 'league',
    season: r.season ?? '',
    status: 'active',
    description: r.description ?? undefined,
    logo: r.logo ?? undefined,
    pointsWin: r.points_win ?? 3,
    pointsDraw: r.points_draw ?? 1,
    registrationCutoffHours: r.registration_cutoff_hours ?? 0,
    doubleRound: Boolean(r.double_round),
    numGroups: r.num_groups ?? undefined,
    teamsPerGroup: r.teams_per_group ?? undefined,
    advancePerGroup: r.advance_per_group ?? undefined,
    leagueQualifiers: r.league_qualifiers ?? undefined,
    thirdPlace: r.third_place ?? undefined,
    tiebreakers: r.tiebreakers ?? undefined,
    allowFederated: Boolean(r.allow_federated),
    maxFederated: r.max_federated ?? null,
    createdAt: new Date().toISOString(),
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
    phone: r.phone ?? undefined,
    createdAt: r.created_at,
  }
}

/** Carrega os dados de inscrição se o token conferir; caso contrário, null. */
export async function loadRegistration(
  teamId: string,
  token: string,
): Promise<RegistrationData | null> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase.rpc('team_registration', { p_team: teamId, p_token: token })
    if (error || !data) return null
    return {
      team: teamFromRow(data.team),
      championshipId: data.team?.championship_id,
      championshipName: data.championship_name ?? 'Campeonato',
      championshipLogo: data.championship_logo ?? undefined,
      audience: data.audience ?? 'adulto',
      allowFederated: Boolean(data.allow_federated),
      maxFederated: data.max_federated ?? null,
      categories: Array.isArray(data.categories) ? data.categories : [],
      players: Array.isArray(data.players) ? data.players.map(playerFromRow) : [],
      hasAccount: Boolean(data.has_account),
      managers: Array.isArray(data.managers) ? (data.managers as string[]) : [],
      registrationCutoffHours: data.registration_cutoff_hours ?? 0,
      closedRounds: Array.isArray(data.closed_rounds) ? data.closed_rounds : [],
      matches: Array.isArray(data.matches) ? data.matches.map(matchFromRow) : [],
      championship: data.championship ? champFromRow(data.championship) : undefined,
    }
  }

  return query((d) => {
    const team = d.teams.find((t) => t.id === teamId)
    if (!team || !team.accessToken || team.accessToken !== token) return null
    const champ = d.championships.find((c) => c.id === team.championshipId)
    return {
      team,
      championshipId: team.championshipId,
      championshipName: champ?.name ?? 'Campeonato',
      championshipLogo: champ?.logo,
      audience: champ?.audience ?? 'adulto',
      allowFederated: Boolean(champ?.allowFederated),
      maxFederated: champ?.maxFederated ?? null,
      championship: champ ?? undefined,
      categories: champ?.categories ?? [],
      players: d.players
        .filter((p) => p.teamId === teamId)
        .sort((a, b) => (a.number ?? 99) - (b.number ?? 99)),
      hasAccount: Boolean(team.username && team.passwordHash),
      managers: [team.username, team.username2].filter((u): u is string => Boolean(u)),
      registrationCutoffHours: champ?.registrationCutoffHours ?? 0,
      closedRounds: champ?.closedRounds ?? [],
      matches: d.matches.filter((m) => m.homeTeamId === teamId || m.awayTeamId === teamId),
    }
  })
}

function matchFromRow(r: any): Match {
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
    createdAt: r.created_at,
  }
}

function assertTokenDemo(teamId: string, token: string): void {
  const ok = query((d) => {
    const t = d.teams.find((x) => x.id === teamId)
    return Boolean(t && t.accessToken && t.accessToken === token)
  })
  if (!ok) throw new Error('Link inválido ou expirado.')
}

// ---------------------------------------------------------------------------
// Acesso do time (usuário + senha)
// ---------------------------------------------------------------------------

/** Cria o usuário/senha do responsável pelo time (uma única vez). */
export async function createTeamAccount(
  teamId: string,
  token: string,
  username: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.rpc('create_team_account', {
      p_team: teamId,
      p_token: token,
      p_username: username.trim(),
      p_password: password,
    })
    return error ? { ok: false, error: error.message } : { ok: true }
  }
  try {
    assertTokenDemo(teamId, token)
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
  return mutate((d) => {
    const t = d.teams.find((x) => x.id === teamId)
    if (!t) return { ok: false, error: 'Time não encontrado.' }
    const u = username.trim()
    const slot1 = Boolean(t.username && t.passwordHash)
    const slot2 = Boolean(t.username2 && t.passwordHash2)
    if (slot1 && slot2) return { ok: false, error: 'Este time já possui 2 gestores.' }
    if (t.username === u || t.username2 === u) return { ok: false, error: 'Este usuário já existe neste time.' }
    if (!slot1) {
      t.username = u
      t.passwordHash = demoHash(password)
    } else {
      t.username2 = u
      t.passwordHash2 = demoHash(password)
    }
    return { ok: true }
  })
}

/** Autentica o responsável pelo time. */
export async function teamLogin(
  teamId: string,
  token: string,
  username: string,
  password: string,
): Promise<{ ok: boolean; needsPassword?: boolean; error?: string }> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase.rpc('team_login', {
      p_team: teamId,
      p_token: token,
      p_username: username.trim(),
      p_password: password,
    })
    if (error) return { ok: false, error: error.message }
    if (data) return { ok: true }
    // Sem sessão: pode ser senha errada OU senha zerada pelo administrador.
    const { data: needs } = await supabase.rpc('team_needs_password', {
      p_team: teamId,
      p_token: token,
      p_username: username.trim(),
    })
    if (needs) return { ok: false, needsPassword: true }
    return { ok: false, error: 'Usuário ou senha inválidos.' }
  }
  return query((d) => {
    const t = d.teams.find((x) => x.id === teamId)
    if (!t || t.accessToken !== token) return { ok: false, error: 'Link inválido.' }
    const u = username.trim()
    const hash = demoHash(password)
    // Slot 1
    if (t.username === u) {
      if (!t.passwordHash) return { ok: false, needsPassword: true } // '' = senha zerada
      return t.passwordHash === hash ? { ok: true } : { ok: false, error: 'Usuário ou senha inválidos.' }
    }
    // Slot 2
    if (t.username2 === u) {
      if (!t.passwordHash2) return { ok: false, needsPassword: true }
      return t.passwordHash2 === hash ? { ok: true } : { ok: false, error: 'Usuário ou senha inválidos.' }
    }
    return { ok: false, error: 'Usuário ou senha inválidos.' }
  })
}

/**
 * Define uma nova senha do gestor quando a conta está com a senha zerada
 * (recuperação iniciada pelo administrador). Não exige a senha antiga.
 */
export async function setTeamPassword(
  teamId: string,
  token: string,
  username: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase.rpc('team_set_password', {
      p_team: teamId,
      p_token: token,
      p_username: username.trim(),
      p_new: newPassword,
    })
    if (error) return { ok: false, error: error.message }
    return data ? { ok: true } : { ok: false, error: 'Não foi possível redefinir a senha.' }
  }
  return mutate((d) => {
    const t = d.teams.find((x) => x.id === teamId)
    if (!t || t.accessToken !== token) return { ok: false, error: 'Link inválido.' }
    const u = username.trim()
    if (t.username === u && !t.passwordHash) {
      t.passwordHash = demoHash(newPassword)
      return { ok: true }
    }
    if (t.username2 === u && !t.passwordHash2) {
      t.passwordHash2 = demoHash(newPassword)
      return { ok: true }
    }
    return { ok: false, error: 'Esta conta não está com a senha zerada.' }
  })
}

// ---------------------------------------------------------------------------
// Dados do time
// ---------------------------------------------------------------------------
export async function saveTeamInfo(teamId: string, token: string, patch: TeamInfoPatch): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.rpc('reg_update_team', {
      p_team: teamId,
      p_token: token,
      p_name: patch.name ?? null,
      p_short: patch.shortName ?? null,
      p_logo: patch.logo ?? null,
      p_color: patch.color ?? null,
      p_coach: patch.coach ?? null,
      p_phone: patch.phone ?? null,
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
        phone: patch.phone ?? t.phone,
      }
    }
  })
}

// ---------------------------------------------------------------------------
// Atletas (com validação de categoria / ano de nascimento)
// ---------------------------------------------------------------------------

/** Valida prazo, elegibilidade e limites no modo demo (o Supabase valida via RPC). */
function validateDemo(teamId: string, input: PlayerInput, excludePlayerId?: string): void {
  const role = input.role ?? 'atleta'
  const { category, existing, cutoff, closedRounds, matches, champPlayers, teamNames } = query((d) => {
    const team = d.teams.find((t) => t.id === teamId)
    const champ = d.championships.find((c) => c.id === team?.championshipId)
    const category = champ?.categories.find((c) => c.id === input.categoryId)
    const existing = d.players.filter(
      (p) => p.teamId === teamId && p.categoryId === input.categoryId && p.id !== excludePlayerId,
    )
    const matches = d.matches.filter((m) => m.homeTeamId === teamId || m.awayTeamId === teamId)
    return {
      category,
      existing,
      cutoff: champ?.registrationCutoffHours ?? 0,
      closedRounds: champ?.closedRounds ?? [],
      matches,
      champPlayers: d.players.filter((p) => p.championshipId === team?.championshipId),
      teamNames: new Map(
        d.teams.filter((t) => t.championshipId === team?.championshipId).map((t) => [t.id, t.name]),
      ),
    }
  })

  // Um CPF, um time no campeonato (podendo repetir no mesmo time em outra categoria).
  const cpfCheck = checkCpfConflict({
    cpf: input.cpf,
    teamId,
    categoryId: input.categoryId,
    players: champPlayers,
    teamName: (id) => teamNames.get(id),
    ignorePlayerId: excludePlayerId,
  })
  if (!cpfCheck.ok) throw new Error(cpfCheck.reason ?? 'CPF já inscrito neste campeonato.')

  const lock = registrationLockForTeam(teamId, matches, cutoff, closedRounds)
  if (lock.locked) {
    throw new Error(
      lock.reason === 'manual'
        ? 'As inscrições da próxima rodada foram encerradas pelo organizador.'
        : 'As inscrições deste time estão encerradas para a próxima partida. Reabrem após o jogo.',
    )
  }

  if (role === 'atleta') {
    const elig = checkEligibility({ category, birthdate: input.birthdate, existingInCategory: existing })
    if (!elig.ok) throw new Error(elig.reason ?? 'Atleta não elegível para esta categoria.')
  }

  const limit = checkRosterLimit({ category, role, existingInCategory: existing })
  if (!limit.ok) throw new Error(limit.reason ?? 'Limite da categoria atingido.')

  // Federados: no Supabase quem barra é a `assert_federated_allowed` (0025);
  // no modo demo não há servidor, então a regra vale aqui.
  if (input.federated) {
    const { champ, doTime } = query((d) => {
      const t = d.teams.find((x) => x.id === teamId)
      return {
        champ: d.championships.find((c) => c.id === t?.championshipId) ?? null,
        doTime: d.players.filter((p) => p.teamId === teamId),
      }
    })
    const v = podeMarcarFederado(champ, doTime, excludePlayerId)
    if (!v.ok) throw new Error(v.motivo ?? 'Atleta federado não permitido.')
  }
}

export async function addRegPlayer(teamId: string, token: string, input: PlayerInput): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const base = {
      p_team: teamId,
      p_token: token,
      p_name: input.name,
      p_cpf: input.cpf ?? null,
      p_birthdate: input.birthdate ?? null,
      p_photo: input.photo ?? null,
      p_number: input.number ?? null,
      p_position: input.position ?? null,
      p_category: input.categoryId ?? null,
      p_role: input.role ?? 'atleta',
    }
    const { error } = await supabase.rpc('reg_add_player', {
      ...base,
      p_federated: input.federated ?? false,
      p_federated_in: input.federatedIn ?? null,
    })
    // Banco sem a migration 0025: a RPC ainda não tem os parâmetros novos.
    // Inscrever sem a marcação é melhor do que não inscrever.
    if (error && semMigration0025(error)) {
      const { error: e2 } = await supabase.rpc('reg_add_player', base)
      if (e2) throw e2
      return
    }
    if (error) throw error
    return
  }
  assertTokenDemo(teamId, token)
  validateDemo(teamId, input)
  mutate((d) => {
    const team = d.teams.find((t) => t.id === teamId)
    if (!team) return
    d.players.push({
      id: uid('player'),
      teamId,
      championshipId: team.championshipId,
      name: input.name,
      cpf: input.cpf,
      birthdate: input.birthdate,
      photo: input.photo,
      number: input.number,
      position: input.position,
      categoryId: input.categoryId,
      role: input.role ?? 'atleta',
      federated: input.federated ?? false,
      federatedIn: input.federated ? input.federatedIn : undefined,
      createdAt: new Date().toISOString(),
    })
  })
}

export async function updateRegPlayer(
  teamId: string,
  token: string,
  playerId: string,
  input: PlayerInput,
): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const base = {
      p_team: teamId,
      p_token: token,
      p_player: playerId,
      p_name: input.name,
      p_cpf: input.cpf ?? null,
      p_birthdate: input.birthdate ?? null,
      p_photo: input.photo ?? null,
      p_number: input.number ?? null,
      p_position: input.position ?? null,
      p_category: input.categoryId ?? null,
      p_role: input.role ?? 'atleta',
    }
    const { error } = await supabase.rpc('reg_update_player', {
      ...base,
      p_federated: input.federated ?? false,
      p_federated_in: input.federatedIn ?? null,
    })
    if (error && semMigration0025(error)) {
      const { error: e2 } = await supabase.rpc('reg_update_player', base)
      if (e2) throw e2
      return
    }
    if (error) throw error
    return
  }
  assertTokenDemo(teamId, token)
  validateDemo(teamId, input, playerId)
  mutate((d) => {
    const i = d.players.findIndex((p) => p.id === playerId && p.teamId === teamId)
    if (i >= 0) {
      d.players[i] = {
        ...d.players[i],
        name: input.name,
        cpf: input.cpf,
        birthdate: input.birthdate,
        photo: input.photo,
        number: input.number,
        position: input.position,
        categoryId: input.categoryId,
        role: input.role ?? 'atleta',
        federated: input.federated ?? false,
        federatedIn: input.federated ? input.federatedIn : undefined,
      }
    }
  })
}

export async function removeRegPlayer(teamId: string, token: string, playerId: string): Promise<void> {
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
