// ---------------------------------------------------------------------------
// Atletas federados.
//
// A permissão é **de categoria**, não do campeonato: o mesmo torneio de base
// costuma proibir federados no Sub-11 e liberar dois no Sub-15. Quem define o
// que é exceção, na prática, é a faixa etária.
//
// Estas funções são a versão em TypeScript da regra que o banco aplica na
// migration 0026 — servem para a tela avisar antes, não para autorizar. Quem
// autoriza é o Postgres, dentro da RPC de inscrição.
// ---------------------------------------------------------------------------
import type { Category, Championship, Player } from '../types'

/** O que a regra precisa saber da categoria. */
export interface RegraFederados {
  id?: string
  name?: string
  allowFederated?: boolean
  maxFederated?: number | null
}

export type ModalidadeFederado = 'campo' | 'futsal' | 'ambos'

export const MODALIDADE_LABELS: Record<ModalidadeFederado, string> = {
  campo: 'Campo',
  futsal: 'Futsal',
  ambos: 'Campo e futsal',
}

/**
 * A regra de federados vale para este campeonato?
 *
 * Só faz sentido no infantil — no adulto, "federado" não é exceção a limitar.
 */
export function regraVale(
  c: { audience?: Championship['audience'] } | null | undefined,
): boolean {
  return (c?.audience ?? 'adulto') === 'infantil'
}

/** A categoria aceita atletas federados? */
export function permiteFederados(cat: RegraFederados | null | undefined): boolean {
  return Boolean(cat?.allowFederated)
}

/**
 * Quantos federados cada time pode inscrever nesta categoria.
 * `Infinity` quando permite sem limite; `0` quando não permite.
 */
export function limiteFederados(cat: RegraFederados | null | undefined): number {
  if (!permiteFederados(cat)) return 0
  const max = cat?.maxFederated
  if (max === null || max === undefined) return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor(max))
}

/**
 * Quantos federados o time já tem na categoria.
 *
 * `categoriaId` indefinido conta o elenco inteiro — só faz sentido para um
 * resumo; a regra sempre olha uma categoria de cada vez.
 */
export function contarFederados(
  players: Player[] | null | undefined,
  categoriaId?: string,
  excluirId?: string,
): number {
  return (players ?? []).filter(
    (p) =>
      p.federated &&
      p.id !== excluirId &&
      (categoriaId === undefined || p.categoryId === categoriaId),
  ).length
}

/** Quantas vagas de federado ainda restam na categoria. */
export function vagasFederados(
  cat: RegraFederados | null | undefined,
  players: Player[] | null | undefined,
  excluirId?: string,
): number {
  return Math.max(0, limiteFederados(cat) - contarFederados(players, cat?.id, excluirId))
}

export interface Veredito {
  ok: boolean
  motivo?: string
}

/**
 * Pode marcar este atleta como federado nesta categoria? Espelha a
 * `assert_federated_allowed` do banco.
 */
export function podeMarcarFederado(
  cat: RegraFederados | null | undefined,
  players: Player[] | null | undefined,
  excluirId?: string,
): Veredito {
  const nome = cat?.name ?? 'esta categoria'
  if (!permiteFederados(cat)) {
    return { ok: false, motivo: `A categoria ${nome} não aceita atletas federados.` }
  }
  const limite = limiteFederados(cat)
  if (contarFederados(players, cat?.id, excluirId) >= limite) {
    return {
      ok: false,
      motivo: `Limite de ${limite} atleta(s) federado(s) por time na categoria ${nome} já foi atingido.`,
    }
  }
  return { ok: true }
}

/**
 * A frase que o time lê no portal e que entra no regulamento, para UMA
 * categoria. Precisa ser clara sozinha: é ela que evita a inscrição feita por
 * engano.
 */
export function textoRegra(cat: RegraFederados | null | undefined): string {
  if (!permiteFederados(cat)) return 'não aceita atletas federados (campo ou futsal).'
  const limite = limiteFederados(cat)
  if (limite === Number.POSITIVE_INFINITY) {
    return 'aceita atletas federados (campo ou futsal), sem limite por time.'
  }
  return `aceita até ${limite} atleta(s) federado(s) (campo ou futsal) por time.`
}

/** Uma linha por categoria, para o aviso do portal e para o regulamento. */
export function resumoPorCategoria(
  champ: { audience?: Championship['audience'] } | null | undefined,
  categorias: Category[] | null | undefined,
): string[] {
  if (!regraVale(champ)) return []
  return (categorias ?? []).map((cat) => `${cat.name}: ${textoRegra(cat)}`)
}

/** Alguma categoria aceita federados? */
export function algumaPermite(
  champ: { audience?: Championship['audience'] } | null | undefined,
  categorias: Category[] | null | undefined,
): boolean {
  return regraVale(champ) && (categorias ?? []).some(permiteFederados)
}
