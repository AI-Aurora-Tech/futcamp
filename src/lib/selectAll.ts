// ---------------------------------------------------------------------------
// Buscar TODAS as linhas de uma consulta, sem o corte do servidor.
//
// O Supabase (PostgREST) devolve no máximo `max_rows` linhas por pedido — 1000
// por padrão — e corta o resto SEM avisar. Num campeonato grande, isso fazia
// atletas inscritos sumirem das telas.
//
// Aqui a consulta é pedida em páginas (`range`) até vir tudo. O total vem do
// `count: 'exact'` do primeiro pedido; sem ele, para na primeira página vazia.
// Funciona com qualquer valor de `max_rows` configurado no projeto.
//
// Regra: toda lista que pode crescer (atletas, partidas, eventos, clubes...)
// passa por aqui. Nunca use `.select()` direto para listas.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Tamanho de cada página. Se o servidor devolver menos, seguimos pelo que veio. */
const PAGE_SIZE = 1000

interface PageResult {
  data: any[] | null
  error: any
  count?: number | null
}

interface Ranged {
  range(from: number, to: number): PromiseLike<PageResult>
}

/**
 * @param build cria a consulta do zero a cada página (o builder do Supabase só
 *   pode ser executado uma vez). Use `select(cols, { count: 'exact' })` e uma
 *   ordem estável — com `id` como desempate — para as páginas não se
 *   sobreporem.
 */
export async function selectAll<T = any>(build: () => Ranged): Promise<T[]> {
  const out: T[] = []
  let total: number | null = null
  for (;;) {
    const { data, error, count } = await build().range(out.length, out.length + PAGE_SIZE - 1)
    if (error) throw error
    if (total === null && typeof count === 'number') total = count
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length === 0) break
    if (total !== null && out.length >= total) break
  }
  return out
}
