import type { Category, Player } from '../types'

/** Extrai o ano de nascimento de uma data ISO (YYYY-MM-DD). */
export function birthYearOf(birthdate?: string): number | undefined {
  if (!birthdate) return undefined
  const y = Number(String(birthdate).slice(0, 4))
  return Number.isFinite(y) && y > 1900 ? y : undefined
}

/** Um atleta (por ano de nascimento) atende à regra de idade da categoria? */
export function withinAgeRule(category: Category | undefined, birthYear?: number): boolean {
  if (!category || !category.birthYear || !category.birthYearMode) return true
  if (birthYear == null) return false
  return category.birthYearMode === 'min'
    ? birthYear >= category.birthYear
    : birthYear <= category.birthYear
}

export interface EligibilityResult {
  ok: boolean
  isException: boolean
  reason?: string
}

/**
 * Verifica se um atleta pode ser inscrito na categoria, considerando a regra de
 * ano de nascimento e o limite de exceções por time.
 *
 * @param existingInCategory  Demais atletas do MESMO time e categoria (exclua o
 *                            próprio atleta ao editar).
 */
export function checkEligibility(params: {
  category?: Category
  birthdate?: string
  existingInCategory: Player[]
}): EligibilityResult {
  const { category, birthdate, existingInCategory } = params
  if (!category || !category.birthYear || !category.birthYearMode) {
    return { ok: true, isException: false }
  }

  const year = birthYearOf(birthdate)
  if (year == null) {
    return { ok: false, isException: false, reason: 'Informe uma data de nascimento válida.' }
  }

  if (withinAgeRule(category, year)) {
    return { ok: true, isException: false }
  }

  // Fora da regra: só entra como exceção, se houver vaga de exceção no time.
  const limit = category.exceptions ?? 0
  const usedExceptions = existingInCategory.filter(
    (p) => !withinAgeRule(category, birthYearOf(p.birthdate)),
  ).length

  const rule =
    category.birthYearMode === 'min'
      ? `nascidos em ${category.birthYear} ou depois`
      : `nascidos em ${category.birthYear} ou antes`

  if (limit <= 0) {
    return {
      ok: false,
      isException: true,
      reason: `A categoria "${category.name}" aceita apenas atletas ${rule}.`,
    }
  }
  if (usedExceptions >= limit) {
    return {
      ok: false,
      isException: true,
      reason: `Limite de ${limit} exceção(ões) de idade já atingido neste time para "${category.name}".`,
    }
  }
  return { ok: true, isException: true }
}

/** Máscara simples de CPF (000.000.000-00). Retorna só dígitos se incompleto. */
export function formatCpf(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11)
  if (d.length !== 11) return d
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

/** Validação de CPF (dígitos verificadores). */
export function isValidCpf(value: string): boolean {
  const d = value.replace(/\D/g, '')
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const calc = (len: number) => {
    let sum = 0
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i)
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10])
}
