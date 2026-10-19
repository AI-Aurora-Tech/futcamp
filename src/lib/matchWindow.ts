import type { Match } from '../types'

export interface RegistrationLock {
  locked: boolean
  /**
   * Motivo:
   *  • 'manual' = o organizador encerrou as inscrições (fechou uma rodada);
   *  • 'played' = algum jogo do campeonato já começou ou terminou;
   *  • 'time'   = algum jogo do campeonato entrou no prazo (X horas antes).
   */
  reason?: 'manual' | 'played' | 'time'
  /** Partida que fechou as inscrições (a primeira, quando houver). */
  match?: Match
  /** Horário de início dessa partida (ISO), se houver. */
  matchAt?: string
}

/**
 * As inscrições do CAMPEONATO estão encerradas?
 *
 * Fecham no primeiro destes eventos, para todos os times e em qualquer rodada:
 *  • o organizador encerra uma rodada (closedRounds);
 *  • algum jogo começa ou termina;
 *  • algum jogo entra no prazo de `cutoffHours` antes do início.
 *
 * Uma vez fechadas, NÃO reabrem sozinhas — nem quando o jogo termina, nem na
 * rodada seguinte. Só o organizador desfaz um encerramento manual, e só
 * enquanto nenhum jogo entrou no prazo.
 *
 * `matches` são as partidas do campeonato inteiro, não só as de um time.
 * A mesma regra vale no banco: `registration_closed` (migration 0043).
 */
export function registrationLock(
  matches: Match[],
  cutoffHours: number,
  closedRounds: number[] = [],
  now: Date = new Date(),
): RegistrationLock {
  // 1) Encerramento manual pelo organizador.
  if (closedRounds.length) {
    const closed = new Set(closedRounds)
    const m = matches.find((x) => closed.has(x.round))
    return { locked: true, reason: 'manual', match: m, matchAt: m?.scheduledAt }
  }

  // 2) Algum jogo já começou ou terminou.
  const played = matches.find((m) => m.status === 'live' || m.status === 'finished')
  if (played) return { locked: true, reason: 'played', match: played, matchAt: played.scheduledAt }

  // 3) Algum jogo entrou no prazo (a partir dele, fecha para sempre).
  if (cutoffHours && cutoffHours > 0) {
    const ms = cutoffHours * 3600_000
    const first = matches
      .filter((m) => !!m.scheduledAt)
      .map((m) => ({ m, at: new Date(m.scheduledAt as string) }))
      .filter(({ at }) => !Number.isNaN(at.getTime()))
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .find(({ at }) => now.getTime() >= at.getTime() - ms)
    if (first) return { locked: true, reason: 'time', match: first.m, matchAt: first.m.scheduledAt }
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
