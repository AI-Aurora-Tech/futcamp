// ---------------------------------------------------------------------------
// Fases de grupos.
//
//  • Um campeonato "grupos + mata-mata" pode ter MAIS DE UMA fase de grupos:
//    os classificados da 1ª fase são redistribuídos em novos grupos na 2ª, e
//    assim por diante — só depois vem o mata-mata.
//  • Cada grupo tem o SEU número de classificados (grupos podem ter tamanhos
//    diferentes): grupo A classificam 2, grupo B classifica 1, etc.
// ---------------------------------------------------------------------------
import type {
  Championship,
  GroupStage,
  Match,
  MatchEvent,
  StandingRow,
  Team,
} from '../types'
import { computeStandings } from './standings'

/** Letras dos grupos de uma fase: 3 grupos → ["A", "B", "C"]. */
export function stageGroupLetters(numGroups: number): string[] {
  return Array.from({ length: Math.max(1, numGroups || 1) }, (_, i) => String.fromCharCode(65 + i))
}

/** Nome exibido da fase (1ª fase, 2ª fase…). */
export function stageName(stage: GroupStage, index: number, total: number): string {
  if (stage.name?.trim()) return stage.name.trim()
  if (total <= 1) return 'Fase de grupos'
  return `${index + 1}ª fase de grupos`
}

/**
 * Fases de grupos do campeonato, sempre como lista. Campeonatos antigos (sem
 * `groupStages`) viram uma única fase montada com os campos legados.
 */
export function groupStagesOf(champ: Championship): GroupStage[] {
  if (champ.groupStages?.length) return champ.groupStages
  if (champ.format === 'groups_knockout') {
    return [
      {
        id: 'stage-1',
        numGroups: champ.numGroups ?? 2,
        advancePerGroup: champ.advancePerGroup,
        advanceByGroup: champ.advanceByGroup,
        doubleRound: champ.doubleRound,
      },
    ]
  }
  if (champ.format === 'league') {
    // Pontos corridos é uma fase de classificação única (grupo geral).
    return [
      {
        id: 'league-1',
        name: 'fase de pontos corridos',
        numGroups: 1,
        advancePerGroup: champ.leagueQualifiers ?? 0,
        doubleRound: champ.doubleRound,
      },
    ]
  }
  return []
}

/** Quantos se classificam neste grupo desta fase. */
export function qualifiersOfGroup(stage: GroupStage, group: string): number {
  const specific = stage.advanceByGroup?.[group]
  if (specific != null && Number.isFinite(specific)) return Math.max(0, specific)
  return Math.max(0, stage.advancePerGroup ?? 2)
}

/** Total de classificados da fase (soma de todos os grupos). */
export function totalQualifiers(stage: GroupStage): number {
  return stageGroupLetters(stage.numGroups).reduce((s, g) => s + qualifiersOfGroup(stage, g), 0)
}

/** Fase de grupos a que a partida pertence (1 = primeira). */
export function matchStage(m: Match): number {
  return m.stage ?? 1
}

/** Partidas de uma fase de grupos específica. */
export function matchesOfStage(matches: Match[], stage: number): Match[] {
  return matches.filter((m) => m.phase === 'group' && matchStage(m) === stage)
}

/** A fase de grupos existe (já tem jogos gerados)? */
export function stageExists(matches: Match[], stage: number): boolean {
  return matchesOfStage(matches, stage).length > 0
}

/** Todos os jogos desta fase de grupos foram encerrados? */
export function stageComplete(matches: Match[], stage: number): boolean {
  const list = matchesOfStage(matches, stage)
  return list.length > 0 && list.every((m) => m.status === 'finished')
}

/**
 * Todas as fases de grupos configuradas já existem e estão encerradas? É a
 * condição para montar o mata-mata.
 */
export function allGroupStagesComplete(champ: Championship, matches: Match[]): boolean {
  const stages = groupStagesOf(champ)
  if (stages.length === 0) {
    const group = matches.filter((m) => m.phase === 'group')
    return group.length > 0 && group.every((m) => m.status === 'finished')
  }
  return stages.every((_, i) => stageExists(matches, i + 1) && stageComplete(matches, i + 1))
}

/**
 * Próxima fase de grupos que o sistema deve criar sozinho: a primeira que
 * ainda não existe, desde que a anterior esteja encerrada. A 1ª fase não entra
 * (ela é gerada pelo organizador em "Gerar tabela de jogos").
 * Devolve `null` quando não há nada a criar.
 */
export function nextGroupStageToCreate(champ: Championship, matches: Match[]): number | null {
  const stages = groupStagesOf(champ)
  for (let i = 1; i < stages.length; i++) {
    const stage = i + 1
    if (stageExists(matches, stage)) continue
    return stageComplete(matches, stage - 1) ? stage : null
  }
  return null
}

/**
 * Composição dos grupos de uma fase.
 *  • 1ª fase: vem do campo `group` dos times (definido no cadastro/sorteio).
 *  • demais fases: vem das próprias partidas, já que um time pode estar no
 *    grupo A na 1ª fase e no grupo C na 2ª.
 */
export function groupsOfStage(
  teams: Team[],
  matches: Match[],
  stage: number,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (stage <= 1) {
    for (const t of teams) {
      const g = t.group || 'A'
      ;(out[g] ??= []).push(t.id)
    }
    return out
  }
  for (const m of matchesOfStage(matches, stage)) {
    const g = m.group || 'A'
    const list = (out[g] ??= [])
    for (const id of [m.homeTeamId, m.awayTeamId]) {
      if (id && !list.includes(id)) list.push(id)
    }
  }
  return out
}

/** Classificação de uma fase de grupos, grupo a grupo. */
export function standingsOfStage(
  champ: Championship,
  teams: Team[],
  matches: Match[],
  stage: number,
  events: MatchEvent[] = [],
): Record<string, StandingRow[]> {
  const composition = groupsOfStage(teams, matches, stage)
  const stageMatches = matchesOfStage(matches, stage)
  const byId = new Map(teams.map((t) => [t.id, t] as const))
  const result: Record<string, StandingRow[]> = {}

  for (const [group, ids] of Object.entries(composition)) {
    const groupTeams = ids.map((id) => byId.get(id)).filter((t): t is Team => !!t)
    const idSet = new Set(ids)
    const groupMatches = stageMatches.filter(
      (m) =>
        (m.group ? m.group === group : true) &&
        m.homeTeamId != null &&
        m.awayTeamId != null &&
        idSet.has(m.homeTeamId) &&
        idSet.has(m.awayTeamId),
    )
    result[group] = computeStandings(groupTeams, groupMatches, champ, { events })
  }
  return result
}

/** Time classificado de uma fase, com a origem (grupo e colocação). */
export interface QualifiedTeam {
  teamId: string
  group: string
  position: number
}

/**
 * Classificados de uma fase, respeitando o número de vagas de CADA grupo.
 * A ordem é por colocação e depois por grupo (todos os 1ºs, depois os 2ºs…),
 * que é a ordem natural de "seed" para a fase seguinte.
 */
export function qualifiersOfStage(
  champ: Championship,
  teams: Team[],
  matches: Match[],
  stage: number,
  events: MatchEvent[] = [],
): QualifiedTeam[] {
  const stages = groupStagesOf(champ)
  const cfg = stages[stage - 1]
  if (!cfg) return []
  const table = standingsOfStage(champ, teams, matches, stage, events)

  const out: QualifiedTeam[] = []
  for (const group of Object.keys(table).sort()) {
    const vagas = qualifiersOfGroup(cfg, group)
    table[group].slice(0, vagas).forEach((row, i) => {
      out.push({ teamId: row.teamId, group, position: i + 1 })
    })
  }
  return out.sort((a, b) => a.position - b.position || a.group.localeCompare(b.group))
}

/**
 * Distribui os classificados nos grupos da fase seguinte em "serpentina"
 * (1º do A no grupo 1, 1º do B no grupo 2, 2º do C no grupo 2, …), evitando —
 * quando possível — juntar de novo times que vieram do mesmo grupo.
 */
export function distributeIntoGroups(
  qualified: QualifiedTeam[],
  numGroups: number,
): Record<string, string[]> {
  const letters = stageGroupLetters(numGroups)
  const buckets: QualifiedTeam[][] = letters.map(() => [])
  const capacity = Math.ceil(qualified.length / letters.length)

  qualified.forEach((q, i) => {
    // Serpentina: a cada volta, a ordem dos grupos inverte.
    const lap = Math.floor(i / letters.length)
    const posInLap = i % letters.length
    const preferred = lap % 2 === 0 ? posInLap : letters.length - 1 - posInLap

    // Ordem de tentativa: o grupo preferido e, na sequência, os demais.
    const order = [preferred, ...letters.map((_, idx) => idx).filter((idx) => idx !== preferred)]
    const target =
      order.find((idx) => buckets[idx].length < capacity && !buckets[idx].some((x) => x.group === q.group)) ??
      order.find((idx) => buckets[idx].length < capacity) ??
      preferred
    buckets[target].push(q)
  })

  const out: Record<string, string[]> = {}
  letters.forEach((letter, i) => {
    out[letter] = buckets[i].map((q) => q.teamId)
  })
  return out
}
