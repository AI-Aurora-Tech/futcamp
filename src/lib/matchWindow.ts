import type { Match } from '../types'

export interface RegistrationLock {
  locked: boolean
  /** Motivo: 'time' = prazo antes do jogo; 'manual' = rodada fechada pelo admin. */
  reason?: 'time' | 'manual'
  /** Partida que motiva a trava (a mais próxima dentro da janela). */
  match?: Match
  /** Horário de início dessa partida (ISO), se houver. */
  matchAt?: string
}

/**
 * Determina se as inscrições de um time estão TRAVADAS, por:
 *  • encerramento MANUAL de uma rodada pelo organizador (closedRounds), ou
 *  • proximidade de jogo: `cutoffHours` antes de cada partida não finalizada.
 * Em ambos os casos, ao finalizar a partida/rodada as inscrições reabrem.
 */
export function registrationLockForTeam(
  teamId: string,
  matches: Match[],
  cutoffHours: number,
  closedRounds: number[] = [],
  now: Date = new Date(),
): RegistrationLock {
  const mine = matches.filter(
    (m) => (m.homeTeamId === teamId || m.awayTeamId === teamId) && m.status !== 'finished',
  )

  // 1) Rodada fechada manualmente (partida ainda não finalizada nessa rodada).
  if (closedRounds.length) {
    const closed = new Set(closedRounds)
    const m = mine.find((x) => closed.has(x.round))
    if (m) return { locked: true, reason: 'manual', match: m, matchAt: m.scheduledAt }
  }

  // 2) Prazo por proximidade do jogo.
  if (cutoffHours && cutoffHours > 0) {
    const ms = cutoffHours * 3600_000
    const candidates = mine
      .filter((m) => !!m.scheduledAt)
      .map((m) => ({ m, at: new Date(m.scheduledAt as string) }))
      .filter(({ at }) => !Number.isNaN(at.getTime()))
      .sort((a, b) => a.at.getTime() - b.at.getTime())
    for (const { m, at } of candidates) {
      if (now.getTime() >= at.getTime() - ms) {
        return { locked: true, reason: 'time', match: m, matchAt: m.scheduledAt }
      }
    }
  }

  return { locked: false }
}

/**
 * As inscrições para ESTA partida já encerraram? (base para liberar a súmula)
 * Considera: jogo ao vivo/encerrado, rodada fechada manualmente pelo organizador
 * (closedRounds) ou o prazo por proximidade do jogo.
 */
export function matchRegistrationClosed(
  match: Match,
  cutoffHours: number,
  closedRounds: number[] = [],
  now: Date = new Date(),
): boolean {
  if (match.status === 'live' || match.status === 'finished') return true
  if (closedRounds.includes(match.round)) return true
  if (!cutoffHours || cutoffHours <= 0 || !match.scheduledAt) return false
  const at = new Date(match.scheduledAt)
  if (Number.isNaN(at.getTime())) return false
  return now.getTime() >= at.getTime() - cutoffHours * 3600_000
}
