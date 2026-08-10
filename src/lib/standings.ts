import type { Championship, Match, StandingRow, Team } from '../types'

/**
 * Calcula a tabela de classificação a partir das partidas finalizadas.
 * Critérios de desempate (na ordem): pontos, saldo de gols, gols pró,
 * vitórias e, por fim, nome do time (ordem alfabética estável).
 */
export function computeStandings(
  teams: Team[],
  matches: Match[],
  championship: Pick<Championship, 'pointsWin' | 'pointsDraw'>,
): StandingRow[] {
  const rows = new Map<string, StandingRow>()
  for (const t of teams) {
    rows.set(t.id, {
      teamId: t.id,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDiff: 0,
      points: 0,
    })
  }

  for (const m of matches) {
    if (
      m.status !== 'finished' ||
      m.homeTeamId == null ||
      m.awayTeamId == null ||
      m.homeScore == null ||
      m.awayScore == null
    ) {
      continue
    }
    const home = rows.get(m.homeTeamId)
    const away = rows.get(m.awayTeamId)
    if (!home || !away) continue

    home.played++
    away.played++
    home.goalsFor += m.homeScore
    home.goalsAgainst += m.awayScore
    away.goalsFor += m.awayScore
    away.goalsAgainst += m.homeScore

    if (m.homeScore > m.awayScore) {
      home.won++
      away.lost++
      home.points += championship.pointsWin
    } else if (m.homeScore < m.awayScore) {
      away.won++
      home.lost++
      away.points += championship.pointsWin
    } else {
      home.drawn++
      away.drawn++
      home.points += championship.pointsDraw
      away.points += championship.pointsDraw
    }
  }

  const nameById = new Map(teams.map((t) => [t.id, t.name] as const))
  const list = [...rows.values()]
  for (const r of list) r.goalDiff = r.goalsFor - r.goalsAgainst

  list.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor
    if (b.won !== a.won) return b.won - a.won
    return (nameById.get(a.teamId) ?? '').localeCompare(nameById.get(b.teamId) ?? '')
  })

  return list
}

/** Agrupa a classificação por grupo (fase de grupos). */
export function computeStandingsByGroup(
  teams: Team[],
  matches: Match[],
  championship: Pick<Championship, 'pointsWin' | 'pointsDraw'>,
): Record<string, StandingRow[]> {
  const groups = new Map<string, Team[]>()
  for (const t of teams) {
    const g = t.group || '—'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(t)
  }

  const result: Record<string, StandingRow[]> = {}
  for (const [group, groupTeams] of groups) {
    const ids = new Set(groupTeams.map((t) => t.id))
    const groupMatches = matches.filter(
      (m) =>
        (m.group ? m.group === group : true) &&
        m.homeTeamId != null &&
        m.awayTeamId != null &&
        ids.has(m.homeTeamId) &&
        ids.has(m.awayTeamId),
    )
    result[group] = computeStandings(groupTeams, groupMatches, championship)
  }
  return result
}
