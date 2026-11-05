import type { Team } from '../types'

export interface GrupoDeTimes {
  /** Letra do grupo ("A", "B"…); `undefined` = times ainda sem grupo. */
  grupo: string | undefined
  times: Team[]
}

const porNome = (a: Team, b: Team) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })

/**
 * Separa os times por grupo, na ordem A, B, C…, cada grupo em ordem alfabética.
 *
 * `letras` são os grupos que a competição tem: aparecem mesmo vazios (o
 * organizador vê onde ainda faltam times). `incluirVazios = false` (durante uma
 * busca) mostra só os que têm time. Time sem grupo — ou com um grupo que a
 * competição não tem mais — vai para o fim, em "sem grupo".
 */
export function agruparTimesPorGrupo(
  times: Team[],
  letras: string[],
  incluirVazios = true,
): GrupoDeTimes[] {
  const validas = new Set(letras)
  const secoes: GrupoDeTimes[] = letras.map((l) => ({
    grupo: l,
    times: times.filter((t) => t.group === l).sort(porNome),
  }))
  const soltos = times.filter((t) => !t.group || !validas.has(t.group)).sort(porNome)
  if (soltos.length) secoes.push({ grupo: undefined, times: soltos })
  return incluirVazios ? secoes : secoes.filter((s) => s.times.length > 0)
}
