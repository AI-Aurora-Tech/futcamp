// ---------------------------------------------------------------------------
// Mata-mata: chaveamento configurável e avanço automático.
//
//  • O organizador define, na criação do campeonato, QUEM PEGA QUEM na primeira
//    fase eliminatória (ex.: 1º do grupo A × 2º do grupo B).
//  • As fases seguintes saem desse chaveamento: o vencedor do confronto `p`
//    joga na posição `p / 2` da fase seguinte (mandante se `p` é par).
//  • Quando todos os jogos da primeira fase terminam, o sistema resolve as
//    vagas pela classificação (com os critérios de desempate do campeonato) e
//    cria toda a árvore até a final.
// ---------------------------------------------------------------------------
import {
  OVERALL_GROUP,
  type BracketPairing,
  type Championship,
  type Match,
  type MatchEvent,
  type MatchPhase,
  type MatchStatus,
  type QualifierSlot,
  type Team,
} from '../types'
import { uid } from './id'
import { computeStandings } from './standings'
import {
  groupStagesOf,
  qualifiersOfGroup,
  stageGroupLetters,
  standingsOfStage,
} from './groupStages'

/** Fases eliminatórias, da primeira à final (a disputa de 3º fica fora). */
export const KNOCKOUT_ORDER: MatchPhase[] = [
  'round_of_32',
  'round_of_16',
  'quarter',
  'semi',
  'final',
]

/**
 * Rodada-base das fases eliminatórias. Mantém os jogos de mata-mata fora da
 * numeração das rodadas da primeira fase (e, portanto, do fechamento manual de
 * inscrições por rodada).
 */
export const KNOCKOUT_ROUND_BASE = 100

/** Letras dos grupos: 2 grupos → ["A", "B"]. */
export function groupLetters(numGroups: number): string[] {
  return Array.from({ length: Math.max(1, numGroups || 1) }, (_, i) => String.fromCharCode(65 + i))
}

/** Fase inicial de um mata-mata com `pairs` confrontos. */
export function phaseForPairs(pairs: number): MatchPhase {
  if (pairs >= 16) return 'round_of_32'
  if (pairs >= 8) return 'round_of_16'
  if (pairs >= 4) return 'quarter'
  if (pairs >= 2) return 'semi'
  return 'final'
}

function nextPowerOfTwo(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

const slot = (group: string, position: number): QualifierSlot => ({ group, position })

function pairing(home: QualifierSlot | null, away: QualifierSlot | null): BracketPairing {
  return { id: uid('br'), home, away }
}

/** Texto curto de uma vaga: "1º do grupo A" / "3º colocado". */
export function slotLabel(s: QualifierSlot | null): string {
  if (!s) return 'Vaga livre (bye)'
  return s.group === OVERALL_GROUP ? `${s.position}º colocado` : `${s.position}º do grupo ${s.group}`
}

/**
 * Emparelha vagas pelo "seed": 1º × último, 2º × penúltimo… Depois troca os
 * visitantes entre confrontos para evitar, quando possível, que dois times do
 * MESMO grupo se enfrentem logo na estreia do mata-mata.
 */
function seedPairings(slots: QualifierSlot[]): BracketPairing[] {
  const size = nextPowerOfTwo(slots.length)
  const padded: (QualifierSlot | null)[] = [...slots]
  while (padded.length < size) padded.push(null)
  const out: BracketPairing[] = []
  for (let i = 0; i < size / 2; i++) out.push(pairing(padded[i], padded[size - 1 - i]))

  const sameGroup = (p: BracketPairing) => !!p.home && !!p.away && p.home.group === p.away.group
  for (let i = 0; i < out.length; i++) {
    if (!sameGroup(out[i])) continue
    for (let j = 0; j < out.length; j++) {
      if (i === j) continue
      const a = { ...out[i], away: out[j].away }
      const b = { ...out[j], away: out[i].away }
      if (!sameGroup(a) && !sameGroup(b)) {
        out[i] = a
        out[j] = b
        break
      }
    }
  }
  return out
}

/**
 * Sugere o chaveamento a partir do formato do campeonato — usando a ÚLTIMA
 * fase de grupos e o número de vagas de cada grupo (que pode variar de grupo
 * para grupo). É apenas um ponto de partida: o organizador edita confronto a
 * confronto.
 */
export function suggestBracket(
  champ: Pick<
    Championship,
    | 'format'
    | 'numGroups'
    | 'advancePerGroup'
    | 'advanceByGroup'
    | 'groupStages'
    | 'leagueQualifiers'
  >,
): BracketPairing[] {
  if (champ.format === 'groups_knockout') {
    const stages = groupStagesOf(champ as Championship)
    const last = stages[stages.length - 1]
    if (!last) return []
    const groups = stageGroupLetters(last.numGroups)
    const vagas = (g: string) => qualifiersOfGroup(last, g)
    const uniform = groups.every((g) => vagas(g) === vagas(groups[0])) ? vagas(groups[0]) : null

    // Cruzamento clássico: 2 classificados por grupo e grupos aos pares —
    // 1ºA × 2ºB, 1ºC × 2ºD, 1ºB × 2ºA, 1ºD × 2ºC…
    if (uniform === 2 && groups.length % 2 === 0) {
      const partner = (i: number) => (i % 2 === 0 ? i + 1 : i - 1)
      const all = groups.map((g, i) => pairing(slot(g, 1), slot(groups[partner(i)], 2)))
      const evens = all.filter((_, i) => i % 2 === 0)
      const odds = all.filter((_, i) => i % 2 !== 0)
      return [...evens, ...odds]
    }

    // Geral (inclui grupos com números de vagas diferentes): ordena as vagas
    // por colocação — todos os 1ºs, depois os 2ºs… — e emparelha o melhor com
    // o pior.
    const maxPos = Math.max(0, ...groups.map(vagas))
    const slots: QualifierSlot[] = []
    for (let pos = 1; pos <= maxPos; pos++) {
      for (const g of groups) if (vagas(g) >= pos) slots.push(slot(g, pos))
    }
    return seedPairings(slots)
  }

  // Pontos corridos: classificação geral (1º × último classificado…).
  const qualifiers = Math.max(0, champ.leagueQualifiers ?? 0)
  if (qualifiers < 2) return []
  return seedPairings(
    Array.from({ length: qualifiers }, (_, i) => slot(OVERALL_GROUP, i + 1)),
  )
}

/** Confronto do mata-mata pronto para virar partida. */
export interface PlannedMatch {
  phase: MatchPhase
  bracketPos: number
  round: number
  homeTeamId: string | null
  awayTeamId: string | null
  status: MatchStatus
}

/**
 * Monta a árvore completa do mata-mata: a primeira fase com os times já
 * definidos e as fases seguintes (até a final) ainda "a definir".
 */
export function planKnockout(
  pairs: { home: string | null; away: string | null }[],
  thirdPlace = false,
): PlannedMatch[] {
  const size = nextPowerOfTwo(Math.max(pairs.length, 1))
  const padded = [...pairs]
  while (padded.length < size) padded.push({ home: null, away: null })

  const first = phaseForPairs(size)
  const startIdx = KNOCKOUT_ORDER.indexOf(first)
  const out: PlannedMatch[] = []

  let count = size
  for (let i = startIdx; i < KNOCKOUT_ORDER.length && count >= 1; i++) {
    const phase = KNOCKOUT_ORDER[i]
    for (let pos = 0; pos < count; pos++) {
      const p = i === startIdx ? padded[pos] : { home: null, away: null }
      out.push({
        phase,
        bracketPos: pos,
        round: KNOCKOUT_ROUND_BASE + i,
        homeTeamId: p.home,
        awayTeamId: p.away,
        status: 'scheduled',
      })
    }
    count = count / 2
  }

  if (thirdPlace && out.some((m) => m.phase === 'semi')) {
    out.push({
      phase: 'third_place',
      bracketPos: 0,
      round: KNOCKOUT_ROUND_BASE + KNOCKOUT_ORDER.length,
      homeTeamId: null,
      awayTeamId: null,
      status: 'scheduled',
    })
  }

  return out
}

/**
 * Resolve as vagas do chaveamento em IDs de times, usando a classificação da
 * primeira fase e os critérios de desempate do campeonato.
 */
export function resolveBracketTeams(
  champ: Championship,
  teams: Team[],
  matches: Match[],
  events: MatchEvent[] = [],
): { home: string | null; away: string | null }[] {
  const bracket = champ.bracket?.length ? champ.bracket : suggestBracket(champ)
  // As vagas do mata-mata vêm sempre da ÚLTIMA fase de grupos.
  const byGroup =
    champ.format === 'groups_knockout'
      ? standingsOfStage(champ, teams, matches, groupStagesOf(champ).length, events)
      : null
  const overall = byGroup ? null : computeStandings(teams, matches, champ, { events })

  const teamFor = (s: QualifierSlot | null): string | null => {
    if (!s) return null
    const rows = s.group === OVERALL_GROUP || !byGroup ? overall : byGroup[s.group]
    const row = rows?.[s.position - 1]
    return row?.teamId ?? null
  }

  return bracket.map((p) => ({ home: teamFor(p.home), away: teamFor(p.away) }))
}

/** A partida foi decidida nos pênaltis? */
export function decidedOnPenalties(m: Match): boolean {
  return (
    m.penaltyHome != null &&
    m.penaltyAway != null &&
    m.penaltyHome !== m.penaltyAway
  )
}

/**
 * Vencedor do confronto, nesta ordem: classificado definido à mão (W.O.),
 * disputa por pênaltis, placar do jogo e, por fim, bye.
 */
export function winnerOf(m: Match): string | null {
  if (m.winnerTeamId) return m.winnerTeamId
  if (m.homeTeamId && !m.awayTeamId) return m.homeTeamId // bye
  if (m.awayTeamId && !m.homeTeamId) return m.awayTeamId
  if (m.status !== 'finished') return null
  if (decidedOnPenalties(m)) {
    return (m.penaltyHome as number) > (m.penaltyAway as number) ? m.homeTeamId : m.awayTeamId
  }
  if (m.homeScore == null || m.awayScore == null) return null
  if (m.homeScore > m.awayScore) return m.homeTeamId
  if (m.homeScore < m.awayScore) return m.awayTeamId
  return null // empate sem classificado definido
}

/** Perdedor do confronto (para a disputa de 3º lugar). */
export function loserOf(m: Match): string | null {
  const w = winnerOf(m)
  if (!w || !m.homeTeamId || !m.awayTeamId) return null
  return w === m.homeTeamId ? m.awayTeamId : m.homeTeamId
}

/** Confronto de mata-mata terminado, mas ainda sem classificado definido. */
export function isUnresolvedTie(m: Match): boolean {
  return (
    m.phase !== 'group' &&
    m.status === 'finished' &&
    !!m.homeTeamId &&
    !!m.awayTeamId &&
    winnerOf(m) == null
  )
}

/** Um "bye" (confronto com um time só) conta como decidido. */
function isBye(m: Match): boolean {
  return !!m.homeTeamId !== !!m.awayTeamId
}

/**
 * Calcula as atualizações pendentes do chaveamento: leva os vencedores (e os
 * perdedores das semis, quando há disputa de 3º) para a fase seguinte.
 */
export function pendingAdvances(matches: Match[]): { id: string; patch: Partial<Match> }[] {
  const knockout = matches.filter((m) => m.phase !== 'group')
  if (knockout.length === 0) return []

  const phases = KNOCKOUT_ORDER.filter((p) => knockout.some((m) => m.phase === p))
  const patches: { id: string; patch: Partial<Match> }[] = []
  const at = (phase: MatchPhase, pos: number) =>
    knockout.find((m) => m.phase === phase && (m.bracketPos ?? 0) === pos)

  const assign = (target: Match | undefined, side: 'homeTeamId' | 'awayTeamId', teamId: string) => {
    if (!target || target.status !== 'scheduled' || target[side] === teamId) return
    const existing = patches.find((p) => p.id === target.id)
    if (existing) existing.patch[side] = teamId
    else {
      patches.push({
        id: target.id,
        patch: side === 'homeTeamId' ? { homeTeamId: teamId } : { awayTeamId: teamId },
      })
    }
  }

  for (let i = 0; i < phases.length - 1; i++) {
    const phase = phases[i]
    const next = phases[i + 1]
    for (const m of knockout.filter((x) => x.phase === phase)) {
      if (m.status !== 'finished' && !isBye(m)) continue
      const w = winnerOf(m)
      if (!w) continue
      const pos = m.bracketPos ?? 0
      assign(at(next, Math.floor(pos / 2)), pos % 2 === 0 ? 'homeTeamId' : 'awayTeamId', w)
    }
  }

  // Disputa de 3º lugar: perdedores das semifinais.
  const third = knockout.find((m) => m.phase === 'third_place')
  if (third && third.status === 'scheduled') {
    for (const pos of [0, 1]) {
      const semi = at('semi', pos)
      if (!semi || semi.status !== 'finished') continue
      const l = loserOf(semi)
      if (l) assign(third, pos === 0 ? 'homeTeamId' : 'awayTeamId', l)
    }
  }

  return patches
}

/** Todos os jogos da primeira fase já foram encerrados? */
export function groupPhaseComplete(matches: Match[]): boolean {
  const group = matches.filter((m) => m.phase === 'group')
  return group.length > 0 && group.every((m) => m.status === 'finished')
}

/** Quantos jogos da primeira fase ainda faltam encerrar. */
export function groupPhaseRemaining(matches: Match[]): number {
  return matches.filter((m) => m.phase === 'group' && m.status !== 'finished').length
}

/**
 * O campeonato prevê uma fase eliminatória depois da primeira fase?
 *
 * No formato "grupos + mata-mata" o mata-mata é da própria natureza do formato.
 * Em pontos corridos ele só existe se o organizador tiver montado o
 * chaveamento — assim um campeonato de liga antigo, que apenas destacava os
 * classificados na tabela, não ganha uma fase eliminatória de surpresa.
 */
export function hasKnockoutStage(champ: Championship): boolean {
  if (champ.format === 'groups_knockout') return true
  if (champ.format === 'league') return (champ.bracket?.length ?? 0) > 0
  return false
}
