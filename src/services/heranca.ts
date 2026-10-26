// ---------------------------------------------------------------------------
// Cadastros que o organizador leva de um campeonato para o outro.
//
// Árbitros, campos e mesários são da pessoa que organiza, não de um
// campeonato só: criar a Copa 2027 não pode obrigar a cadastrar de novo o
// mesmo árbitro, o mesmo campo e o mesmo mesário da Copa 2026.
//
//  • Árbitros e campos: vêm dos outros campeonatos do mesmo dono, sem repetir
//    nome (o cadastro mais recente vale).
//  • Mesários: copiados no banco (`copiar_mesarios_do_organizador`, migration
//    0045) com o mesmo e-mail e a mesma senha — o hash não passa pelo app.
// ---------------------------------------------------------------------------
import { authMode } from './auth'
import { supabase } from '../lib/supabase'
import { mutate } from './demo'
import { uid } from '../lib/id'
import { getChampionship, listChampionships, updateChampionship } from './championships'
import type { Referee, Venue } from '../types'

const chave = (nome: string | undefined) => (nome ?? '').trim().toLowerCase()

/** Junta `extras` em `atual` sem repetir nome. Devolve só o que entrou. */
function juntar<T extends { name: string }>(atual: T[], extras: T[]): T[] {
  const vistos = new Set(atual.map((x) => chave(x.name)))
  const novos: T[] = []
  for (const x of extras) {
    const k = chave(x.name)
    if (!k || vistos.has(k)) continue
    vistos.add(k)
    novos.push(x)
  }
  return novos
}

export interface Herdados {
  arbitros: number
  campos: number
  mesarios: number
}

/**
 * Traz para `championshipId` os árbitros, campos e mesários dos outros
 * campeonatos do organizador `ownerId`. Nunca derruba quem chama: o que
 * falhar fica de fora (e o organizador pode cadastrar à mão).
 */
export async function herdarCadastros(championshipId: string, ownerId: string): Promise<Herdados> {
  const out: Herdados = { arbitros: 0, campos: 0, mesarios: 0 }

  // 1) Árbitros e campos.
  try {
    const [alvo, todos] = await Promise.all([getChampionship(championshipId), listChampionships(ownerId)])
    if (alvo) {
      // Do mais recente para o mais antigo: o cadastro mais novo vale.
      const outros = todos
        .filter((c) => c.id !== championshipId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      const arbitros = juntar<Referee>(alvo.referees ?? [], outros.flatMap((c) => c.referees ?? []))
      const campos = juntar<Venue>(alvo.venues ?? [], outros.flatMap((c) => c.venues ?? []))
      if (arbitros.length || campos.length) {
        // Id novo: o árbitro do campeonato antigo não pode ser o mesmo
        // registro (o id é usado nas partidas daquele campeonato).
        await updateChampionship(championshipId, {
          referees: [...(alvo.referees ?? []), ...arbitros.map((r) => ({ ...r, id: uid('ref') }))],
          venues: [...(alvo.venues ?? []), ...campos.map((v) => ({ ...v, id: uid('venue') }))],
        })
        out.arbitros = arbitros.length
        out.campos = campos.length
      }
    }
  } catch (e) {
    console.warn('herdar árbitros/campos:', e)
  }

  // 2) Mesários.
  try {
    if (authMode === 'supabase' && supabase) {
      const { data, error } = await supabase.rpc('copiar_mesarios_do_organizador', { p_champ: championshipId })
      if (error) console.warn('copiar_mesarios_do_organizador (migration 0045 aplicada?):', error.message)
      else out.mesarios = Number(data) || 0
    } else {
      out.mesarios = mutate((d) => {
        const meus = new Set(d.championships.filter((c) => c.ownerId === ownerId && c.id !== championshipId).map((c) => c.id))
        const jaTem = new Set(d.officials.filter((o) => o.championshipId === championshipId).map((o) => chave(o.username)))
        const fonte = d.officials
          .filter((o) => meus.has(o.championshipId))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        let n = 0
        for (const o of fonte) {
          const k = chave(o.username)
          if (jaTem.has(k)) continue
          jaTem.add(k)
          d.officials.push({ ...o, id: uid('mesa'), championshipId, createdAt: new Date().toISOString() })
          n++
        }
        return n
      })
    }
  } catch (e) {
    console.warn('herdar mesários:', e)
  }

  return out
}
