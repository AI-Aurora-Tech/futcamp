// ---------------------------------------------------------------------------
// Fases da tela de Partidas.
//
// A lista de jogos vem em "seções" (rodadas ou grupos da fase de grupos, e uma
// por fase do mata-mata). Aqui elas são reunidas em FASES do campeonato: cada
// fase de grupos (a 1ª, a 2ª…) e cada fase do mata-mata.
//
// À medida que as fases terminam, a tela reduz as encerradas e destaca a fase
// em disputa. Este arquivo só decide QUEM é quem; o desenho fica na tela.
// ---------------------------------------------------------------------------
import type { Match, MatchPhase } from '../types'
import { matchStage } from './groupStages'
import { KNOCKOUT_ORDER } from './knockout'

/** O mínimo que a tela guarda de cada seção. */
export interface SecaoDePartidas {
  key: string
  title: string
  matches: Match[]
  /** Seção de mata-mata (uma por fase). */
  isKnockout: boolean
}

export type EstadoDaFase = 'encerrada' | 'atual' | 'futura'

export interface Fase<S extends SecaoDePartidas = SecaoDePartidas> {
  key: string
  titulo: string
  sections: S[]
  /** Fase de mata-mata (as de grupos juntam rodadas ou grupos). */
  isKnockout: boolean
  estado: EstadoDaFase
  /** Jogos da fase e quantos já foram encerrados. */
  total: number
  encerrados: number
}

/**
 * Reúne as seções (já na ordem da tela) em fases e diz o estado de cada uma:
 *  • encerrada — todos os jogos encerrados;
 *  • atual     — a primeira fase que ainda não terminou (é UMA só);
 *  • futura    — as que vêm depois dela.
 *
 * Com todas encerradas, nenhuma é "atual" (o campeonato acabou).
 *
 * `tituloDaEtapa` dá o nome da fase de grupos de número `etapa` (1-based).
 */
export function agruparFases<S extends SecaoDePartidas>(
  secoes: S[],
  tituloDaEtapa: (etapa: number) => string,
): Fase<S>[] {
  const fases: Fase<S>[] = []
  for (const sec of secoes) {
    const etapa = sec.isKnockout || !sec.matches[0] ? 0 : matchStage(sec.matches[0])
    const key = sec.isKnockout ? sec.key : `etapa-${etapa}`
    const ultima = fases[fases.length - 1]
    if (!sec.isKnockout && ultima && ultima.key === key) {
      ultima.sections.push(sec)
      continue
    }
    fases.push({
      key,
      titulo: sec.isKnockout ? sec.title : tituloDaEtapa(etapa),
      sections: [sec],
      isKnockout: sec.isKnockout,
      estado: 'futura',
      total: 0,
      encerrados: 0,
    })
  }

  for (const f of fases) {
    const jogos = f.sections.flatMap((s) => s.matches)
    f.total = jogos.length
    f.encerrados = jogos.filter((m) => m.status === 'finished').length
  }
  const terminou = (f: Fase<S>) => f.total > 0 && f.encerrados === f.total
  const idxAtual = fases.findIndex((f) => !terminou(f))
  fases.forEach((f, i) => {
    f.estado = terminou(f) ? 'encerrada' : i === idxAtual ? 'atual' : 'futura'
  })
  return fases
}

/** Fases do mata-mata em ordem, com a disputa de 3º lugar por último. */
const ORDEM_DO_MATA_MATA: MatchPhase[] = [...KNOCKOUT_ORDER, 'third_place']

/**
 * As fases do campeonato montadas direto dos jogos: cada fase de grupos (pelo
 * número da fase) e cada fase do mata-mata. É a versão para telas que não
 * listam rodada por rodada (a Visão geral); na aba Partidas as seções já vêm
 * prontas e vão direto para `agruparFases`.
 */
export function fasesDoCampeonato(
  matches: Match[],
  tituloDaEtapa: (etapa: number) => string,
): Fase[] {
  const secoes: SecaoDePartidas[] = []

  const etapas = [...new Set(matches.filter((m) => m.phase === 'group').map(matchStage))].sort((a, b) => a - b)
  for (const etapa of etapas) {
    secoes.push({
      key: `etapa-${etapa}`,
      title: tituloDaEtapa(etapa),
      isKnockout: false,
      matches: matches.filter((m) => m.phase === 'group' && matchStage(m) === etapa),
    })
  }
  for (const phase of ORDEM_DO_MATA_MATA) {
    const jogos = matches.filter((m) => m.phase === phase)
    if (jogos.length) secoes.push({ key: phase, title: phase, isKnockout: true, matches: jogos })
  }
  return agruparFases(secoes, tituloDaEtapa)
}

/** Estado de cada fase do mata-mata, pelo nome da fase (para destacar a coluna do chaveamento). */
export function estadosDoMataMata(fases: Fase[]): Partial<Record<MatchPhase, EstadoDaFase>> {
  const out: Partial<Record<MatchPhase, EstadoDaFase>> = {}
  for (const f of fases) if (f.isKnockout) out[f.key as MatchPhase] = f.estado
  return out
}
