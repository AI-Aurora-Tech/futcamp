/**
 * Ordem dos jogadores em TODO o sistema: alfabética pelo nome.
 *
 * Vale para o elenco no painel, no portal do time, no portal do mesário, na
 * página pública, na tela de lançar gols e cartões e na súmula. Ignora
 * maiúsculas e acentos ("Álvaro" fica junto de "Alvaro") e trata números
 * dentro do nome na ordem natural ("Jogador 2" antes de "Jogador 10").
 */
const colacao = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true })

export function porNome(a: { name?: string; id?: string }, b: { name?: string; id?: string }): number {
  return colacao.compare((a.name ?? '').trim(), (b.name ?? '').trim()) || (a.id ?? '').localeCompare(b.id ?? '')
}

/** Cópia da lista em ordem alfabética (não mexe na original). */
export function ordenarPorNome<T extends { name?: string; id?: string }>(lista: T[]): T[] {
  return [...lista].sort(porNome)
}
