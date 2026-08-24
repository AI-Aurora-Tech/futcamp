// ---------------------------------------------------------------------------
// Atletas federados.
//
// Campeonato de base costuma limitar quantos atletas federados cada time pode
// inscrever. Quem decide é o campeonato (infantil); quem marca é o time, na
// hora de inscrever o atleta.
//
// Estas funções são a versão em TypeScript da regra que o banco aplica na
// migration 0025 — servem para a tela avisar antes, não para autorizar. Quem
// autoriza é o Postgres, dentro da RPC de inscrição.
// ---------------------------------------------------------------------------
import type { Championship, Player } from '../types'

/** O que a regra precisa saber do campeonato. */
export interface RegraFederados {
  audience?: Championship['audience']
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
export function regraVale(c: RegraFederados | null | undefined): boolean {
  return (c?.audience ?? 'adulto') === 'infantil'
}

/** O campeonato aceita atletas federados? */
export function permiteFederados(c: RegraFederados | null | undefined): boolean {
  return regraVale(c) && Boolean(c?.allowFederated)
}

/**
 * Quantos federados cada time pode inscrever.
 * `Infinity` quando permite sem limite; `0` quando não permite.
 */
export function limiteFederados(c: RegraFederados | null | undefined): number {
  if (!permiteFederados(c)) return 0
  const max = c?.maxFederated
  if (max === null || max === undefined) return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor(max))
}

/** Quantos federados o time já tem (o atleta em edição não conta). */
export function contarFederados(players: Player[] | null | undefined, excluirId?: string): number {
  return (players ?? []).filter((p) => p.federated && p.id !== excluirId).length
}

/** Quantas vagas de federado ainda restam. */
export function vagasFederados(
  c: RegraFederados | null | undefined,
  players: Player[] | null | undefined,
  excluirId?: string,
): number {
  return Math.max(0, limiteFederados(c) - contarFederados(players, excluirId))
}

export interface Veredito {
  ok: boolean
  motivo?: string
}

/**
 * Pode marcar este atleta como federado? Espelha a
 * `assert_federated_allowed` do banco.
 */
export function podeMarcarFederado(
  c: RegraFederados | null | undefined,
  players: Player[] | null | undefined,
  excluirId?: string,
): Veredito {
  if (!permiteFederados(c)) {
    return { ok: false, motivo: 'Este campeonato não aceita atletas federados.' }
  }
  const limite = limiteFederados(c)
  if (contarFederados(players, excluirId) >= limite) {
    return {
      ok: false,
      motivo: `Limite de ${limite} atleta(s) federado(s) por time já foi atingido.`,
    }
  }
  return { ok: true }
}

/**
 * A frase que o time lê no portal e que entra no regulamento. Precisa ser
 * clara sozinha: é ela que evita a inscrição feita por engano.
 */
export function textoRegra(c: RegraFederados | null | undefined): string {
  if (!regraVale(c)) return 'Sem restrição de atletas federados.'
  if (!permiteFederados(c)) return 'NÃO é permitida a inscrição de atletas federados (campo ou futsal).'
  const limite = limiteFederados(c)
  if (limite === Number.POSITIVE_INFINITY) {
    return 'É permitida a inscrição de atletas federados (campo ou futsal), sem limite por time.'
  }
  return `É permitida a inscrição de até ${limite} atleta(s) federado(s) (campo ou futsal) por time.`
}
