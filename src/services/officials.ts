// ---------------------------------------------------------------------------
// Mesários: pessoas com login próprio que lançam os dados das partidas em tempo
// real. O administrador cria os mesários e atribui jogos (match.officialId).
//
//  • Modo demo: credenciais e escrita no localStorage; o writer só deixa
//    alterar jogos atribuídos ao mesário.
//  • Modo Supabase: login e escrita via RPCs SECURITY DEFINER (migration 0006).
// ---------------------------------------------------------------------------
import { authMode } from './auth'
import { supabase } from '../lib/supabase'
import { mutate, query } from './demo'
import { simpleHash, uid } from '../lib/id'
import {
  addEvent as addEventAdmin,
  deleteEvent as deleteEventAdmin,
  listEvents as listEventsAdmin,
  type MatchWriter,
  type NewEvent,
} from './matches'
import type { Match, MatchEvent, Official } from '../types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const hash = (pw: string) => simpleHash(`mesa:${pw}`)

function fromRow(r: any): Official {
  return {
    id: r.id,
    championshipId: r.championship_id,
    name: r.name,
    username: r.username,
    createdAt: r.created_at,
  }
}

// ---------------------------------------------------------------------------
// Administrador
// ---------------------------------------------------------------------------
export async function listOfficials(championshipId: string): Promise<Official[]> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase
      .from('officials')
      .select('id, championship_id, name, username, created_at')
      .eq('championship_id', championshipId)
      .order('name')
    // Se a tabela ainda não existe (migration 0006 não aplicada), não quebra a
    // tela — apenas retorna vazio.
    if (error) {
      console.warn('officials indisponível:', error.message)
      return []
    }
    return (data ?? []).map(fromRow)
  }
  return query((d) => d.officials.filter((o) => o.championshipId === championshipId))
}

export async function createOfficial(
  championshipId: string,
  name: string,
  username: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.rpc('create_official', {
      p_champ: championshipId,
      p_name: name.trim(),
      p_username: username.trim(),
      p_password: password,
    })
    return error ? { ok: false, error: error.message } : { ok: true }
  }
  return mutate((d) => {
    const uname = username.trim().toLowerCase()
    if (d.officials.some((o) => o.championshipId === championshipId && o.username.toLowerCase() === uname)) {
      return { ok: false, error: 'Já existe um mesário com esse usuário.' }
    }
    d.officials.push({
      id: uid('mesa'),
      championshipId,
      name: name.trim(),
      username: username.trim(),
      passwordHash: hash(password),
      createdAt: new Date().toISOString(),
    })
    return { ok: true }
  })
}

export async function deleteOfficial(id: string): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.from('officials').delete().eq('id', id)
    if (error) throw error
    return
  }
  mutate((d) => {
    d.officials = d.officials.filter((o) => o.id !== id)
    // Desatribui os jogos do mesário removido.
    d.matches = d.matches.map((m) => (m.officialId === id ? { ...m, officialId: undefined } : m))
  })
}

/**
 * Administrador ZERA (recupera) a senha do mesário. No próximo login com o
 * e-mail, o portal pedirá para criar uma nova senha.
 */
export async function resetOfficialPassword(id: string): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.rpc('reset_official_password', { p_official: id })
    if (error) throw error
    return
  }
  mutate((d) => {
    const o = d.officials.find((x) => x.id === id)
    if (o) o.passwordHash = '' // '' = senha zerada
  })
}

// ---------------------------------------------------------------------------
// Mesário (portal)
// ---------------------------------------------------------------------------
export async function mesaLogin(
  championshipId: string,
  username: string,
  password: string,
): Promise<{ ok: boolean; official?: Official; needsPassword?: boolean; error?: string }> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase.rpc('mesa_login', {
      p_champ: championshipId,
      p_username: username.trim(),
      p_password: password,
    })
    if (error) return { ok: false, error: error.message }
    if (data) return { ok: true, official: fromRow(data) }
    // Sem sessão: pode ser senha errada OU senha zerada pelo administrador.
    const { data: needs } = await supabase.rpc('mesa_needs_password', {
      p_champ: championshipId,
      p_username: username.trim(),
    })
    if (needs) return { ok: false, needsPassword: true }
    return { ok: false, error: 'E-mail ou senha inválidos.' }
  }
  return query((d) => {
    const uname = username.trim().toLowerCase()
    const o = d.officials.find(
      (x) => x.championshipId === championshipId && x.username.toLowerCase() === uname,
    )
    if (!o) return { ok: false, error: 'E-mail ou senha inválidos.' }
    if (!o.passwordHash) return { ok: false, needsPassword: true } // '' = senha zerada
    if (o.passwordHash !== hash(password)) return { ok: false, error: 'E-mail ou senha inválidos.' }
    return { ok: true, official: o }
  })
}

/**
 * Define uma nova senha do mesário quando a conta está com a senha zerada
 * (recuperação iniciada pelo administrador). Não exige a senha antiga.
 */
export async function setOfficialPassword(
  championshipId: string,
  username: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase.rpc('mesa_set_password', {
      p_champ: championshipId,
      p_username: username.trim(),
      p_new: newPassword,
    })
    if (error) return { ok: false, error: error.message }
    return data ? { ok: true } : { ok: false, error: 'Não foi possível redefinir a senha.' }
  }
  return mutate((d) => {
    const uname = username.trim().toLowerCase()
    const o = d.officials.find(
      (x) => x.championshipId === championshipId && x.username.toLowerCase() === uname,
    )
    if (!o) return { ok: false, error: 'Mesário não encontrado.' }
    if (o.passwordHash) return { ok: false, error: 'Esta conta não está com a senha zerada.' }
    o.passwordHash = hash(newPassword)
    return { ok: true }
  })
}

/** Partidas atribuídas ao mesário. */
export async function listAssignedMatches(
  championshipId: string,
  officialId: string,
): Promise<Match[]> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('championship_id', championshipId)
      .eq('official_id', officialId)
      .order('scheduled_at', { nullsFirst: false })
    if (error) throw error
    // Reaproveita o mapeamento público do serviço de partidas.
    return (data ?? []).map((r: any) => ({
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
      officialId: r.official_id ?? undefined,
      createdAt: r.created_at,
    }))
  }
  return query((d) =>
    d.matches.filter((m) => m.championshipId === championshipId && m.officialId === officialId),
  )
}

export interface MesaContext {
  championshipId: string
  officialId: string
  username: string
  password: string
}

/** Cria um writer restrito aos jogos atribuídos ao mesário. */
export function mesaWriter(ctx: MesaContext): MatchWriter {
  if (authMode === 'supabase' && supabase) {
    const sb = supabase
    return {
      listEvents: (championshipId) => listEventsAdmin(championshipId), // leitura é pública
      async updateMatch(id, patch) {
        const { error } = await sb.rpc('mesa_update_match', {
          p_champ: ctx.championshipId,
          p_username: ctx.username,
          p_password: ctx.password,
          p_match: id,
          p_home: patch.homeScore ?? null,
          p_away: patch.awayScore ?? null,
          p_status: patch.status ?? null,
          p_incidents: patch.incidents ?? null,
        })
        if (error) throw error
      },
      async addEvent(input) {
        const { data, error } = await sb.rpc('mesa_add_event', {
          p_champ: ctx.championshipId,
          p_username: ctx.username,
          p_password: ctx.password,
          p_match: input.matchId,
          p_team: input.teamId,
          p_player: input.playerId ?? null,
          p_player_in: input.playerInId ?? null,
          p_type: input.type,
          p_minute: input.minute ?? null,
          p_detail: input.detail ?? null,
        })
        if (error) throw error
        return {
          id: data?.id ?? uid('ev'),
          matchId: input.matchId,
          championshipId: input.championshipId,
          teamId: input.teamId,
          playerId: input.playerId,
          playerInId: input.playerInId,
          detail: input.detail,
          type: input.type,
          minute: input.minute,
          createdAt: new Date().toISOString(),
        }
      },
      async deleteEvent(id) {
        const { error } = await sb.rpc('mesa_delete_event', {
          p_champ: ctx.championshipId,
          p_username: ctx.username,
          p_password: ctx.password,
          p_event: id,
        })
        if (error) throw error
      },
    }
  }

  // Demo: opera no localStorage, restringindo aos jogos do mesário.
  function assertAssigned(matchId: string) {
    const ok = query((d) => d.matches.some((m) => m.id === matchId && m.officialId === ctx.officialId))
    if (!ok) throw new Error('Você não tem permissão para lançar dados desta partida.')
  }
  return {
    listEvents: (championshipId) => listEventsAdmin(championshipId),
    async updateMatch(id, patch) {
      assertAssigned(id)
      mutate((d) => {
        const i = d.matches.findIndex((m) => m.id === id)
        if (i >= 0) d.matches[i] = { ...d.matches[i], ...patch }
      })
    },
    async addEvent(input: NewEvent): Promise<MatchEvent> {
      assertAssigned(input.matchId)
      return addEventAdmin(input)
    },
    async deleteEvent(id) {
      const ev = query((d) => d.events.find((e) => e.id === id))
      if (ev) assertAssigned(ev.matchId)
      return deleteEventAdmin(id)
    },
  }
}
