// ---------------------------------------------------------------------------
// Consulta sem o teto de 1000 linhas do Supabase.
//
// O PostgREST devolve no máximo 1000 linhas por requisição (`max-rows`) e
// corta o resto em silêncio — sem erro. Num campeonato grande, a lista de
// atletas (ordenada por número, sem número por último) perdia justamente os
// recém-cadastrados: gravados no banco, ausentes no painel.
//
// Busca em páginas com `.range()` até vir uma página incompleta. A consulta
// precisa de uma ordenação estável (termine em uma coluna única, como `id`),
// senão linhas podem se repetir ou sumir entre uma página e outra.
// ---------------------------------------------------------------------------

const PAGE = 1000

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function fetchAllRows<T = any>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw error
    const chunk = data ?? []
    rows.push(...chunk)
    if (chunk.length < PAGE) return rows
  }
}
