/**
 * Lê TODAS as linhas de uma consulta do Supabase, de 1000 em 1000.
 *
 * O Supabase devolve no máximo `max_rows` (1000) linhas por consulta e corta o
 * resto sem avisar. Num campeonato com várias categorias o elenco passa disso
 * fácil — e os atletas "sumiam" do painel. A consulta precisa de uma ordem
 * estável (com `id` no fim) para as páginas não se sobreporem.
 */
export const TAMANHO_PAGINA = 1000

export async function todasAsPaginas<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const tudo: T[] = []
  for (let de = 0; ; de += TAMANHO_PAGINA) {
    const { data, error } = await pagina(de, de + TAMANHO_PAGINA - 1)
    if (error) throw error
    const linhas = data ?? []
    tudo.push(...linhas)
    if (linhas.length < TAMANHO_PAGINA) return tudo
  }
}
