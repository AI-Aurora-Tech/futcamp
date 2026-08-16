// ---------------------------------------------------------------------------
// Campeão do campeonato.
//
//  • Com mata-mata: quem venceu a FINAL. O perdedor é o vice e, havendo
//    disputa de 3º lugar, o vencedor dela fecha o pódio.
//  • Pontos corridos (sem mata-mata): o líder da tabela quando TODOS os jogos
//    terminam — 2º e 3º completam o pódio.
//
// O título sai do resultado, não do status do campeonato: assim que a decisão
// acontece, o campeão aparece.
// ---------------------------------------------------------------------------
import type { Championship, Match, MatchEvent, Team } from '../types'
import { computeStandings } from './standings'
import { loserOf, winnerOf } from './knockout'

export interface Podium {
  championId?: string
  runnerUpId?: string
  thirdId?: string
  /** Como o título foi decidido — muda o texto exibido. */
  decidedBy: 'final' | 'league' | null
}

const EMPTY: Podium = { decidedBy: null }

export function computePodium(
  champ: Pick<Championship, 'format' | 'pointsWin' | 'pointsDraw' | 'tiebreakers'>,
  teams: Team[],
  matches: Match[],
  events: MatchEvent[] = [],
): Podium {
  // 1. Mata-mata: a final decide.
  const final = matches.find((m) => m.phase === 'final')
  if (final) {
    if (final.status !== 'finished') return EMPTY
    const championId = winnerOf(final) ?? undefined
    if (!championId) return EMPTY
    const third = matches.find((m) => m.phase === 'third_place' && m.status === 'finished')
    return {
      championId,
      runnerUpId: loserOf(final) ?? undefined,
      thirdId: third ? (winnerOf(third) ?? undefined) : undefined,
      decidedBy: 'final',
    }
  }

  // 2. Pontos corridos: campeão é o líder, com a competição toda encerrada.
  if (champ.format !== 'league') return EMPTY
  const played = matches.filter((m) => m.phase === 'group')
  if (played.length === 0 || played.some((m) => m.status !== 'finished')) return EMPTY

  const table = computeStandings(teams, matches, champ, { events })
  if (table.length === 0) return EMPTY
  return {
    championId: table[0]?.teamId,
    runnerUpId: table[1]?.teamId,
    thirdId: table[2]?.teamId,
    decidedBy: 'league',
  }
}
