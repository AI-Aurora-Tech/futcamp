/**
 * Lê TODAS as linhas de uma consulta do Supabase, em páginas.
 *
 * O Supabase devolve no máximo 1000 linhas por consulta e corta o resto sem
 * avisar. Num campeonato com várias categorias o elenco passa disso fácil, e
 * os atletas do fim da lista (os sem número, em geral inscritos pelo time)
 * sumiam do painel do organizador.
 *
 * A consulta precisa ter uma ordem estável (terminar por `id`), senão uma
 * página pode repetir ou pular linhas.
 */
export async function todasAsLinhas<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  tamanho = 1000,
): Promise<T[]> {
  const todas: T[] = []
  for (let de = 0; ; de += tamanho) {
    const { data, error } = await pagina(de, de + tamanho - 1)
    if (error) throw error
    const linhas = data ?? []
    todas.push(...linhas)
    if (linhas.length < tamanho) return todas
  }
}
