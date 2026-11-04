// ---------------------------------------------------------------------------
// Co-organizadores: outras pessoas que administram o MESMO campeonato.
//
//  • Modo Supabase: convite e remoção via RPCs SECURITY DEFINER (migration 0047).
//    O vínculo é pelo e-mail — vale mesmo se a pessoa ainda não tem conta.
//  • Modo demo: guardado no localStorage.
// ---------------------------------------------------------------------------
import { authMode } from './auth'
import { supabase } from '../lib/supabase'
import { mutate, query } from './demo'
import { uid } from '../lib/id'
import type { CoOrganizer } from '../types'

/* eslint-disable @typescript-eslint/no-explicit-any */

function fromRow(r: any): CoOrganizer {
  return {
    id: r.id,
    championshipId: r.championship_id,
    email: r.email,
    name: r.name ?? '',
    createdAt: r.created_at,
  }
}

const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export async function listCoOrganizers(championshipId: string): Promise<CoOrganizer[]> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase
      .from('championship_organizers')
      .select('*')
      .eq('championship_id', championshipId)
      .order('created_at')
    // Migration 0047 ainda não aplicada: a tela mostra só o dono, sem quebrar.
    if (error) {
      console.warn('championship_organizers indisponível:', error.message)
      return []
    }
    return (data ?? []).map(fromRow)
  }
  return query((d) => d.coOrganizers.filter((o) => o.championshipId === championshipId))
}

export async function addCoOrganizer(
  championshipId: string,
  email: string,
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const mail = email.trim().toLowerCase()
  if (!EMAIL_OK.test(mail)) return { ok: false, error: 'Informe um e-mail válido.' }

  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.rpc('add_co_organizer', {
      p_champ: championshipId,
      p_email: mail,
      p_name: name.trim(),
    })
    return error ? { ok: false, error: error.message } : { ok: true }
  }
  return mutate((d) => {
    if (d.coOrganizers.some((o) => o.championshipId === championshipId && o.email === mail)) {
      return { ok: false, error: 'Este e-mail já organiza o campeonato.' }
    }
    d.coOrganizers.push({
      id: uid('org'),
      championshipId,
      email: mail,
      name: name.trim(),
      createdAt: new Date().toISOString(),
    })
    return { ok: true }
  })
}

export async function removeCoOrganizer(id: string): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    const { error } = await supabase.rpc('remove_co_organizer', { p_id: id })
    if (error) throw error
    return
  }
  mutate((d) => {
    d.coOrganizers = d.coOrganizers.filter((o) => o.id !== id)
  })
}
