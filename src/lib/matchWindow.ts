import type { Match } from '../types'

export interface RegistrationLock {
  locked: boolean
  /**
   * Motivo: 'closed' = inscrições do campeonato encerradas pelo organizador;
   * 'time' = prazo antes do jogo.
   */
  reason?: 'closed' | 'time'
  /** Partida que motiva a trava (a mais próxima dentro da janela). */
  match?: Match
  /** Horário de início dessa partida (ISO), se houver. */
  matchAt?: string
}

/**
 * Determina se as inscrições de um time estão TRAVADAS, por:
 *  • encerramento MANUAL das inscrições do campeonato inteiro pelo
 *    organizador (`registrationsClosed`) — só reabre quando ele reabrir; ou
 *  • proximidade de jogo: `cutoffHours` antes de cada partida não finalizada
 *    (reabre sozinho quando a partida é encerrada).
 */
export function registrationLockForTeam(
  teamId: string,
  matches: Match[],
  cutoffHours: number,
  registrationsClosed = false,
  now: Date = new Date(),
): RegistrationLock {
  // 1) Inscrições do campeonato fechadas pelo organizador.
  if (registrationsClosed) return { locked: true, reason: 'closed' }

  // 2) Prazo por proximidade do jogo.
  if (cutoffHours && cutoffHours > 0) {
    const ms = cutoffHours * 3600_000
    const candidates = matches
      .filter((m) => (m.homeTeamId === teamId || m.awayTeamId === teamId) && m.status !== 'finished')
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
 * Considera: jogo ao vivo/encerrado, inscrições do campeonato fechadas pelo
 * organizador ou o prazo por proximidade do jogo.
 */
export function matchRegistrationClosed(
  match: Match,
  cutoffHours: number,
  registrationsClosed = false,
  now: Date = new Date(),
): boolean {
  if (match.status === 'live' || match.status === 'finished') return true
  if (registrationsClosed) return true
  if (!cutoffHours || cutoffHours <= 0 || !match.scheduledAt) return false
  const at = new Date(match.scheduledAt)
  if (Number.isNaN(at.getTime())) return false
  return now.getTime() >= at.getTime() - cutoffHours * 3600_000
}
