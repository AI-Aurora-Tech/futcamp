import type { Match } from '../types'

export interface RegistrationLock {
  locked: boolean
  /** Partida que motiva a trava (a mais próxima dentro da janela). */
  match?: Match
  /** Horário de início dessa partida (ISO), se houver. */
  matchAt?: string
}

/**
 * Determina se as inscrições de um time estão TRAVADAS por proximidade de jogo.
 *
 * Regra: encerra `cutoffHours` antes de cada partida do time que ainda não foi
 * finalizada. Assim que a partida é finalizada, ela deixa de travar (as
 * inscrições reabrem — até a próxima partida entrar na janela).
 */
export function registrationLockForTeam(
  teamId: string,
  matches: Match[],
  cutoffHours: number,
  now: Date = new Date(),
): RegistrationLock {
  if (!cutoffHours || cutoffHours <= 0) return { locked: false }

  const ms = cutoffHours * 3600_000
  const candidates = matches
    .filter(
      (m) =>
        (m.homeTeamId === teamId || m.awayTeamId === teamId) &&
        m.status !== 'finished' &&
        !!m.scheduledAt,
    )
    .map((m) => ({ m, at: new Date(m.scheduledAt as string) }))
    .filter(({ at }) => !Number.isNaN(at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime())

  for (const { m, at } of candidates) {
    const lockStart = at.getTime() - ms
    // Trava a partir de X horas antes; jogo ao vivo continua travado.
    if (now.getTime() >= lockStart) {
      return { locked: true, match: m, matchAt: m.scheduledAt }
    }
  }
  return { locked: false }
}

/** As inscrições para ESTA partida já encerraram? (base para gerar a súmula) */
export function matchRegistrationClosed(
  match: Match,
  cutoffHours: number,
  now: Date = new Date(),
): boolean {
  if (match.status === 'live' || match.status === 'finished') return true
  if (!cutoffHours || cutoffHours <= 0 || !match.scheduledAt) return false
  const at = new Date(match.scheduledAt)
  if (Number.isNaN(at.getTime())) return false
  return now.getTime() >= at.getTime() - cutoffHours * 3600_000
}
