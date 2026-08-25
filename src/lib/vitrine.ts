// ---------------------------------------------------------------------------
// Vitrine pública da tela inicial.
//
// A home mostra os campeonatos **em andamento** e os **encerrados** em dois
// blocos separados, com um teto de itens em cada — a página é a porta de
// entrada do app, não um catálogo.
//
// A busca é a exceção: quem digitou um nome quer achar aquele campeonato, e
// esconder o resultado atrás de um teto seria só frustrante. Por isso, com
// busca ativa, o limite cai.
// ---------------------------------------------------------------------------
import type { Championship } from '../types'

/** Quantos campeonatos de cada tipo a home mostra. */
export const VITRINE_LIMITE = 5

/** Tira acento e caixa, para "Sub-20" achar "sub 20" e "SÃO" achar "sao". */
export function normalizar(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** O campeonato bate com o que foi digitado? Nome ou temporada. */
export function combina(c: Championship, busca: string): boolean {
  const q = normalizar(busca.trim())
  if (!q) return true
  return normalizar(c.name).includes(q) || normalizar(c.season ?? '').includes(q)
}

/** Mais recente primeiro. Encerrado usa a data de encerramento. */
function maisRecente(a: Championship, b: Championship): number {
  const quando = (c: Championship) => c.finishedAt ?? c.createdAt ?? ''
  return quando(b).localeCompare(quando(a))
}

export interface Vitrine {
  ativos: Championship[]
  encerrados: Championship[]
  /** Havia mais do que coube? Só para a home poder dizer isso. */
  maisAtivos: number
  maisEncerrados: number
}

/**
 * Separa a lista pública em dois blocos prontos para a tela.
 *
 * @param limite teto por bloco; ignorado quando há busca.
 */
export function vitrine(
  lista: Championship[] | null | undefined,
  busca = '',
  limite = VITRINE_LIMITE,
): Vitrine {
  const filtrada = (lista ?? []).filter((c) => combina(c, busca))
  const ativos = filtrada.filter((c) => c.status === 'active').sort(maisRecente)
  const encerrados = filtrada.filter((c) => c.status === 'finished').sort(maisRecente)

  // Buscando: mostra tudo que bate. Sem busca: só os mais recentes.
  const teto = busca.trim() ? Number.POSITIVE_INFINITY : Math.max(0, limite)

  return {
    ativos: ativos.slice(0, teto),
    encerrados: encerrados.slice(0, teto),
    maisAtivos: Math.max(0, ativos.length - teto),
    maisEncerrados: Math.max(0, encerrados.length - teto),
  }
}
