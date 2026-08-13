import type { Match, MatchEvent, Player, Team } from '../types'

export interface DisciplineRow {
  playerId?: string
  teamId: string
  name: string
  team: string
  /** Amarelos acumulados na fase de grupos / pontos corridos (jogos finalizados). */
  yellows: number
  /** Cartões vermelhos (qualquer fase, jogos finalizados). */
  reds: number
  suspended: boolean
  reasons: string[]
}

/**
 * Calcula a situação disciplinar e a SUSPENSÃO AUTOMÁTICA:
 *  • 3 cartões amarelos acumulados na fase de grupos / pontos corridos, ou
 *  • 1 cartão vermelho (em qualquer fase, na última partida realizada do time).
 *
 * Observação: é um alerta automático. Como o app não controla "suspensão já
 * cumprida", o amarelo sinaliza a cada múltiplo de 3 e o vermelho sinaliza
 * quando ocorreu na última partida finalizada do time.
 */
export function computeDiscipline(
  matches: Match[],
  events: MatchEvent[],
  players: Player[],
  teams: Team[],
): DisciplineRow[] {
  const finished = matches.filter((m) => m.status === 'finished')
  const finishedIds = new Set(finished.map((m) => m.id))
  const phaseById = new Map(finished.map((m) => [m.id, m.phase] as const))
  const pName = new Map(players.map((p) => [p.id, p.name] as const))
  const teamNameById = new Map(teams.map((t) => [t.id, t.shortName || t.name] as const))

  // Última partida finalizada de cada time (por rodada, depois data/criação).
  const lastMatchByTeam = new Map<string, Match>()
  for (const m of finished) {
    for (const tid of [m.homeTeamId, m.awayTeamId]) {
      if (!tid) continue
      const cur = lastMatchByTeam.get(tid)
      if (!cur || m.round > cur.round || (m.round === cur.round && (m.scheduledAt ?? m.createdAt) > (cur.scheduledAt ?? cur.createdAt))) {
        lastMatchByTeam.set(tid, m)
      }
    }
  }

  const rows = new Map<string, DisciplineRow>()
  const keyOf = (e: MatchEvent) => e.playerId ?? `team:${e.teamId}`
  const ensure = (e: MatchEvent): DisciplineRow => {
    const k = keyOf(e)
    let r = rows.get(k)
    if (!r) {
      r = {
        playerId: e.playerId,
        teamId: e.teamId,
        name: e.playerId ? pName.get(e.playerId) ?? 'Jogador' : teamNameById.get(e.teamId) ?? 'Time',
        team: teamNameById.get(e.teamId) ?? '',
        yellows: 0,
        reds: 0,
        suspended: false,
        reasons: [],
      }
      rows.set(k, r)
    }
    return r
  }

  for (const e of events) {
    if (!finishedIds.has(e.matchId)) continue
    if (e.type === 'yellow_card') {
      // Só acumula na fase de grupos / pontos corridos.
      if (phaseById.get(e.matchId) === 'group') ensure(e).yellows++
    } else if (e.type === 'red_card') {
      ensure(e).reds++
    }
  }

  const result = [...rows.values()]
  for (const r of result) {
    if (r.yellows > 0 && r.yellows % 3 === 0) {
      r.suspended = true
      r.reasons.push(`${r.yellows}º amarelo (suspensão automática)`)
    }
    // Vermelho na última partida finalizada do time → suspenso no próximo jogo.
    if (r.playerId) {
      const last = lastMatchByTeam.get(r.teamId)
      if (last) {
        const redInLast = events.some(
          (e) => e.matchId === last.id && e.type === 'red_card' && e.playerId === r.playerId,
        )
        if (redInLast) {
          r.suspended = true
          r.reasons.push('cartão vermelho na última partida')
        }
      }
    }
  }

  // Ordena: suspensos primeiro, depois por cartões.
  return result.sort(
    (a, b) =>
      Number(b.suspended) - Number(a.suspended) ||
      b.reds - a.reds ||
      b.yellows - a.yellows ||
      a.name.localeCompare(b.name),
  )
}
