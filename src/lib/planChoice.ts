// ---------------------------------------------------------------------------
// Plano escolhido na página pública de planos.
//
// A página de planos não exige login: a escolha fica guardada na sessão do
// navegador até o organizador entrar. No painel, o formulário de criação abre
// já com esse plano marcado — e a escolha é descartada em seguida.
// ---------------------------------------------------------------------------
import type { PlanKey } from '../types'

const KEY = 'futcamp:plano'

const VALID: PlanKey[] = ['gratis', 'bronze', 'prata', 'ouro', 'diamante']

/** Guarda o plano escolhido na vitrine. */
export function rememberPlan(plan: PlanKey): void {
  try {
    sessionStorage.setItem(KEY, plan)
  } catch {
    /* navegador sem sessionStorage: segue sem lembrar */
  }
}

/** Lê o plano escolhido (sem apagar). */
export function pendingPlan(): PlanKey | null {
  try {
    const v = sessionStorage.getItem(KEY) as PlanKey | null
    return v && VALID.includes(v) ? v : null
  } catch {
    return null
  }
}

/** Esquece a escolha — chamado quando o formulário já foi aberto com ela. */
export function forgetPlan(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignora */
  }
}
