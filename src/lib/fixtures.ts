import type { MatchPhase } from '../types'

export interface FixturePairing {
  round: number
  homeTeamId: string | null
  awayTeamId: string | null
  group?: string
}

/**
 * Gera confrontos de pontos corridos usando o método do círculo
 * (round-robin). Cada time enfrenta todos os outros uma vez por turno.
 *
 * @param teamIds  IDs dos times participantes.
 * @param doubleRound  Se verdadeiro, gera turno e returno (mando invertido).
 */
export function generateRoundRobin(
  teamIds: string[],
  doubleRound = false,
): FixturePairing[] {
  const teams = [...teamIds]
  // Bye (folga) quando o número de times é ímpar.
  if (teams.length % 2 !== 0) teams.push('__BYE__')

  const n = teams.length
  const roundsPerLeg = n - 1
  const half = n / 2
  const fixtures: FixturePairing[] = []

  // Rotação: o primeiro time fica fixo, os demais giram.
  const rotation = [...teams]

  for (let r = 0; r < roundsPerLeg; r++) {
    for (let i = 0; i < half; i++) {
      const a = rotation[i]
      const b = rotation[n - 1 - i]
      if (a === '__BYE__' || b === '__BYE__') continue
      // Alterna o mando de campo para equilibrar casa/fora.
      const homeFirst = (r + i) % 2 === 0
      fixtures.push({
        round: r + 1,
        homeTeamId: homeFirst ? a : b,
        awayTeamId: homeFirst ? b : a,
      })
    }
    // Gira mantendo o primeiro elemento fixo.
    rotation.splice(1, 0, rotation.pop() as string)
  }

  if (doubleRound) {
    const returnLeg = fixtures.map((f) => ({
      round: f.round + roundsPerLeg,
      homeTeamId: f.awayTeamId,
      awayTeamId: f.homeTeamId,
    }))
    return [...fixtures, ...returnLeg]
  }

  return fixtures
}

/**
 * Gera os confrontos de pontos corridos por grupo, mantendo a numeração de
 * rodadas independente por grupo.
 */
export function generateGroupFixtures(
  groups: Record<string, string[]>,
  doubleRound = false,
): FixturePairing[] {
  const all: FixturePairing[] = []
  for (const [group, ids] of Object.entries(groups)) {
    if (ids.length < 2) continue
    const rr = generateRoundRobin(ids, doubleRound)
    for (const f of rr) all.push({ ...f, group })
  }
  return all
}

/** Descobre a fase inicial de um mata-mata a partir do número de times. */
export function initialKnockoutPhase(numTeams: number): MatchPhase {
  if (numTeams > 16) return 'round_of_32'
  if (numTeams > 8) return 'round_of_16'
  if (numTeams > 4) return 'quarter'
  if (numTeams > 2) return 'semi'
  return 'final'
}

/** Próxima fase de um mata-mata simples. */
export function nextKnockoutPhase(phase: MatchPhase): MatchPhase | null {
  const order: MatchPhase[] = [
    'round_of_32',
    'round_of_16',
    'quarter',
    'semi',
    'final',
  ]
  const idx = order.indexOf(phase)
  if (idx === -1 || idx === order.length - 1) return null
  return order[idx + 1]
}

/**
 * Monta os confrontos da fase inicial de mata-mata emparelhando o melhor com
 * o pior sempre que a lista já vier ordenada por "seed" (1º vs último, etc.).
 * Preenche com "bye" (adversário nulo) quando o número não é potência de 2.
 */
export function seedKnockoutPairings(seededTeamIds: string[]): FixturePairing[] {
  const phase = initialKnockoutPhase(seededTeamIds.length)
  const slots = nextPowerOfTwo(seededTeamIds.length)
  const padded: (string | null)[] = [...seededTeamIds]
  while (padded.length < slots) padded.push(null)

  const pairings: FixturePairing[] = []
  for (let i = 0; i < slots / 2; i++) {
    pairings.push({
      round: 1,
      homeTeamId: padded[i],
      awayTeamId: padded[slots - 1 - i],
    })
  }
  // A "round" aqui é meramente sequencial; a fase de fato vem de `phase`.
  return pairings.map((p) => ({ ...p, group: phase }))
}

function nextPowerOfTwo(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}
