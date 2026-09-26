import type { Player } from '../types'

/**
 * Ordem alfabética do nome do atleta, como se lê em português: sem separar
 * maiúsculas de minúsculas e com "Álvaro" junto de "Alvaro". É a ordem do
 * elenco e da súmula.
 */
export function porNome(a: Pick<Player, 'name'>, b: Pick<Player, 'name'>): number {
  return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })
}
