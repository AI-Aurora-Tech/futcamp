// ---------------------------------------------------------------------------
// Um CPF, um time — dentro do mesmo campeonato.
//
//  • Inscrito por uma equipe, o atleta NÃO pode ser inscrito por outra equipe
//    do mesmo campeonato, em nenhuma categoria.
//  • Pela MESMA equipe ele pode ser inscrito em outra categoria (desde que se
//    enquadre nela — a regra de idade é verificada à parte, em `eligibility`).
//  • O mesmo CPF não se repete na mesma categoria do mesmo time.
// ---------------------------------------------------------------------------
import type { Player } from '../types'

export interface CpfCheck {
  ok: boolean
  reason?: string
  /** Time que já inscreveu o CPF (quando o bloqueio vem de outra equipe). */
  conflictTeamId?: string
}

/** Só dígitos — o CPF pode estar salvo com ou sem máscara. */
const digits = (cpf?: string) => (cpf ?? '').replace(/\D/g, '')

export function checkCpfConflict(params: {
  cpf?: string
  /** Time em que se está inscrevendo. */
  teamId: string
  /** Categoria da inscrição (indefinida = campeonato de categoria única). */
  categoryId?: string
  /** TODOS os atletas já inscritos no campeonato. */
  players: Player[]
  /** Nome do time, para a mensagem. */
  teamName?: (teamId: string) => string | undefined
  /** Ignora este atleta (ao editar o próprio registro). */
  ignorePlayerId?: string
}): CpfCheck {
  const cpf = digits(params.cpf)
  if (!cpf) return { ok: true }

  const same = params.players.filter(
    (p) => p.id !== params.ignorePlayerId && digits(p.cpf) === cpf,
  )
  if (same.length === 0) return { ok: true }

  const other = same.find((p) => p.teamId !== params.teamId)
  if (other) {
    const name = params.teamName?.(other.teamId)
    return {
      ok: false,
      conflictTeamId: other.teamId,
      reason: `Este CPF já está inscrito neste campeonato${name ? ` pelo time ${name}` : ' por outro time'}. Um atleta só pode defender uma equipe no mesmo campeonato.`,
    }
  }

  const sameCategory = same.find((p) => (p.categoryId ?? '') === (params.categoryId ?? ''))
  if (sameCategory) {
    return {
      ok: false,
      reason: `${sameCategory.name} já está inscrito nesta categoria com este CPF.`,
    }
  }

  // Mesmo time, categoria diferente: liberado.
  return { ok: true }
}
