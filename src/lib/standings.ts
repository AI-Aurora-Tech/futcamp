import {
  LEGACY_TIEBREAKERS,
  type Championship,
  type Match,
  type MatchEvent,
  type StandingRow,
  type Team,
  type TiebreakerId,
} from '../types'

/** Dados extras usados pelos critérios de desempate configuráveis. */
export interface StandingsOptions {
  /** Eventos do campeonato (necessários para os critérios de cartões). */
  events?: MatchEvent[]
  /** Sobrescreve os critérios do campeonato. */
  tiebreakers?: TiebreakerId[]
}

type ChampionshipRules = Pick<Championship, 'pointsWin' | 'pointsDraw'> &
  Partial<Pick<Championship, 'tiebreakers'>>

/** A partida entra na conta da classificação? (só a primeira fase pontua) */
function countsForStandings(m: Match): boolean {
  if (m.phase !== 'group') return false
  // Considera jogos finalizados e AO VIVO (placar provisório).
  return (
    (m.status === 'finished' || m.status === 'live') &&
    m.homeTeamId != null &&
    m.awayTeamId != null &&
    m.homeScore != null &&
    m.awayScore != null
  )
}

/** Cartões por time (para os critérios "menos cartões"). */
function cardCounts(events: MatchEvent[]): { red: Map<string, number>; yellow: Map<string, number> } {
  const red = new Map<string, number>()
  const yellow = new Map<string, number>()
  for (const e of events) {
    const target = e.type === 'red_card' ? red : e.type === 'yellow_card' ? yellow : null
    if (!target) continue
    target.set(e.teamId, (target.get(e.teamId) ?? 0) + 1)
  }
  return { red, yellow }
}

/**
 * Confronto direto entre dois times: pontos e saldo de gols apenas nos jogos
 * em que se enfrentaram.
 */
function headToHead(
  a: string,
  b: string,
  matches: Match[],
  rules: Pick<Championship, 'pointsWin' | 'pointsDraw'>,
): number {
  let pointsA = 0
  let pointsB = 0
  let diffA = 0
  for (const m of matches) {
    if (!countsForStandings(m)) continue
    const isPair =
      (m.homeTeamId === a && m.awayTeamId === b) || (m.homeTeamId === b && m.awayTeamId === a)
    if (!isPair) continue
    const scoreA = m.homeTeamId === a ? (m.homeScore as number) : (m.awayScore as number)
    const scoreB = m.homeTeamId === a ? (m.awayScore as number) : (m.homeScore as number)
    diffA += scoreA - scoreB
    if (scoreA > scoreB) pointsA += rules.pointsWin
    else if (scoreA < scoreB) pointsB += rules.pointsWin
    else {
      pointsA += rules.pointsDraw
      pointsB += rules.pointsDraw
    }
  }
  if (pointsA !== pointsB) return pointsB - pointsA // maior primeiro
  return -diffA
}

/**
 * Calcula a tabela de classificação a partir das partidas da primeira fase.
 * O primeiro critério é sempre a pontuação; os demais vêm de
 * `championship.tiebreakers` (ou da ordem histórica, se não configurados).
 */
export function computeStandings(
  teams: Team[],
  matches: Match[],
  championship: ChampionshipRules,
  options: StandingsOptions = {},
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
    if (!countsForStandings(m)) continue
    const home = rows.get(m.homeTeamId as string)
    const away = rows.get(m.awayTeamId as string)
    if (!home || !away) continue
    const homeScore = m.homeScore as number
    const awayScore = m.awayScore as number

    home.played++
    away.played++
    home.goalsFor += homeScore
    home.goalsAgainst += awayScore
    away.goalsFor += awayScore
    away.goalsAgainst += homeScore

    if (homeScore > awayScore) {
      home.won++
      away.lost++
      home.points += championship.pointsWin
    } else if (homeScore < awayScore) {
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

  const criteria = options.tiebreakers ?? championship.tiebreakers ?? LEGACY_TIEBREAKERS
  const { red, yellow } = cardCounts(options.events ?? [])
  const count = (map: Map<string, number>, id: string) => map.get(id) ?? 0

  const applyCriterion = (c: TiebreakerId, a: StandingRow, b: StandingRow): number => {
    switch (c) {
      case 'wins':
        return b.won - a.won
      case 'goal_diff':
        return b.goalDiff - a.goalDiff
      case 'goals_for':
        return b.goalsFor - a.goalsFor
      case 'goals_against':
        return a.goalsAgainst - b.goalsAgainst
      case 'head_to_head':
        return headToHead(a.teamId, b.teamId, matches, championship)
      case 'fewest_red':
        return count(red, a.teamId) - count(red, b.teamId)
      case 'fewest_yellow':
        return count(yellow, a.teamId) - count(yellow, b.teamId)
      case 'draw_lots':
        return 0 // resolvido pela ordem alfabética abaixo (sorteio determinístico)
      default:
        return 0
    }
  }

  list.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    for (const c of criteria) {
      const r = applyCriterion(c, a, b)
      if (r !== 0) return r
    }
    return (nameById.get(a.teamId) ?? '').localeCompare(nameById.get(b.teamId) ?? '')
  })

  return list
}

/** Agrupa a classificação por grupo (fase de grupos). */
export function computeStandingsByGroup(
  teams: Team[],
  matches: Match[],
  championship: ChampionshipRules,
  options: StandingsOptions = {},
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
    result[group] = computeStandings(groupTeams, groupMatches, championship, options)
  }
  return result
}
