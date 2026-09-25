// ---------------------------------------------------------------------------
// Eliminação de um time (desclassificação).
//
//  • O time NÃO é apagado: os jogos já disputados continuam valendo.
//  • Todo jogo ainda não encerrado dele vira derrota por W.O. — 3 × 0 para o
//    adversário.
//  • Opcionalmente, os jogos que ele ainda deveria disputar na fase de grupos
//    em curso (ou nos pontos corridos) são criados já com o W.O. aplicado, para
//    a classificação dos adversários ficar completa.
// ---------------------------------------------------------------------------
import type { Championship, Match, Team } from '../types'
import { groupStagesOf, matchStage } from './groupStages'
import { KNOCKOUT_ROUND_BASE } from './knockout'

/** Placar do W.O.: gols do vencedor. */
export const WO_GOLS = 3

/** Marca gravada no relato da partida — é o que identifica o W.O. por eliminação. */
export const WO_ELIMINACAO = 'W.O. — equipe eliminada'

export interface PlanoEliminacao {
  /** Jogos existentes (não encerrados) que recebem o W.O. */
  atualizar: { match: Match; patch: Partial<Match> }[]
  /** Jogos que faltavam, já com o W.O. aplicado. */
  criar: Omit<Match, 'id' | 'createdAt'>[]
}

/** Placar do W.O. com o time eliminado de um dos lados. */
function placarWo(match: Pick<Match, 'homeTeamId' | 'awayTeamId'>, eliminadoId: string) {
  const eliminadoEmCasa = match.homeTeamId === eliminadoId
  return {
    homeScore: eliminadoEmCasa ? 0 : WO_GOLS,
    awayScore: eliminadoEmCasa ? WO_GOLS : 0,
  }
}

function relatoWo(nome: string, anterior?: string): string {
  const linha = `${WO_ELIMINACAO}: ${nome} (derrota por ${WO_GOLS} × 0).`
  return anterior?.trim() ? `${anterior.trim()}\n${linha}` : linha
}

/**
 * Monta o que muda ao eliminar `team`.
 *
 * `teams` e `matches` são os DA CATEGORIA (com o grupo da categoria em
 * `team.group`); `championship` é a competição da categoria.
 */
export function planejarEliminacao(
  championship: Championship,
  team: Team,
  teams: Team[],
  matches: Match[],
  categoryId?: string,
): PlanoEliminacao {
  const doTime = (m: Match) => m.homeTeamId === team.id || m.awayTeamId === team.id

  // 1) Jogos já criados e ainda não encerrados — só os com adversário definido
  //    (no mata-mata, a vaga ainda "a definir" não tem contra quem dar o W.O.).
  const atualizar = matches
    .filter((m) => doTime(m) && m.status !== 'finished' && m.homeTeamId && m.awayTeamId)
    .map((m) => {
      const adversario = m.homeTeamId === team.id ? m.awayTeamId! : m.homeTeamId!
      const patch: Partial<Match> = {
        ...placarWo(m, team.id),
        status: 'finished',
        incidents: relatoWo(team.name, m.incidents),
      }
      // No mata-mata, o classificado fica explícito (vale sobre o placar).
      if (m.phase !== 'group') patch.winnerTeamId = adversario
      return { match: m, patch }
    })

  return { atualizar, criar: jogosQueFaltam(championship, team, teams, matches, categoryId) }
}

/**
 * Jogos que o time ainda deveria disputar na fase de classificação em curso
 * (fase de grupos ou pontos corridos) e que não existem na tabela.
 */
function jogosQueFaltam(
  championship: Championship,
  team: Team,
  teams: Team[],
  matches: Match[],
  categoryId?: string,
): Omit<Match, 'id' | 'createdAt'>[] {
  if (championship.format === 'knockout') return []
  // Pontos corridos com número fixo de jogos por time: a tabela não é "todos
  // contra todos", então não há como saber quais confrontos faltam.
  if (championship.format === 'league' && championship.leagueMatchesPerTeam) return []

  const deGrupo = matches.filter((m) => m.phase === 'group')
  // Já existe mata-mata: a fase de classificação acabou.
  if (matches.some((m) => m.phase !== 'group')) return []

  const doTime = deGrupo.filter((m) => m.homeTeamId === team.id || m.awayTeamId === team.id)
  const stage = Math.max(1, ...doTime.map(matchStage))
  const daFase = deGrupo.filter((m) => matchStage(m) === stage)

  // Adversários: na 1ª fase, o grupo da inscrição; nas seguintes, o grupo em
  // que o time foi redistribuído (tirado dos próprios jogos da fase).
  let grupo: string | undefined
  let adversarios: string[]
  if (stage === 1) {
    grupo = championship.format === 'groups_knockout' ? team.group || undefined : undefined
    adversarios = teams
      .filter((t) => t.id !== team.id && (!grupo || t.group === grupo))
      .map((t) => t.id)
  } else {
    grupo = doTime.find((m) => matchStage(m) === stage)?.group
    const ids = new Set<string>()
    for (const m of daFase) {
      if (m.group !== grupo) continue
      if (m.homeTeamId) ids.add(m.homeTeamId)
      if (m.awayTeamId) ids.add(m.awayTeamId)
    }
    ids.delete(team.id)
    adversarios = [...ids]
  }

  const cfg = groupStagesOf(championship)[stage - 1]
  const turnoEReturno = stage === 1 ? !!championship.doubleRound : !!cfg?.doubleRound

  // Rodada: cada confronto novo entra na próxima rodada livre dos dois times.
  const jogos = new Map<string, number>()
  for (const m of daFase) {
    for (const id of [m.homeTeamId, m.awayTeamId]) if (id) jogos.set(id, (jogos.get(id) ?? 0) + 1)
  }
  const rodadasDaFase = daFase.map((m) => m.round).filter((r) => r < KNOCKOUT_ROUND_BASE)
  const base = stage === 1 || rodadasDaFase.length === 0 ? 0 : Math.min(...rodadasDaFase) - 1

  const criar: Omit<Match, 'id' | 'createdAt'>[] = []
  for (const adv of adversarios) {
    const entre = daFase.filter(
      (m) =>
        (m.homeTeamId === team.id && m.awayTeamId === adv) ||
        (m.homeTeamId === adv && m.awayTeamId === team.id),
    )
    // Mandos que faltam: o adversário em casa primeiro; no returno, o inverso.
    const mandos: [string, string][] = []
    const temAdvEmCasa = entre.some((m) => m.homeTeamId === adv)
    const temTimeEmCasa = entre.some((m) => m.homeTeamId === team.id)
    if (turnoEReturno) {
      if (!temAdvEmCasa) mandos.push([adv, team.id])
      if (!temTimeEmCasa) mandos.push([team.id, adv])
    } else if (entre.length === 0) {
      mandos.push([adv, team.id])
    }

    for (const [home, away] of mandos) {
      const jh = jogos.get(home) ?? 0
      const ja = jogos.get(away) ?? 0
      jogos.set(home, jh + 1)
      jogos.set(away, ja + 1)
      const match = { homeTeamId: home, awayTeamId: away }
      criar.push({
        championshipId: championship.id,
        categoryId,
        round: base + Math.max(jh, ja) + 1,
        phase: 'group',
        stage,
        group: grupo,
        ...match,
        ...placarWo(match, team.id),
        status: 'finished',
        incidents: relatoWo(team.name),
      })
    }
  }
  return criar
}

/**
 * Times eliminados: quem perdeu algum jogo marcado com o W.O. de eliminação.
 */
export function timesEliminados(matches: Match[]): Set<string> {
  const ids = new Set<string>()
  for (const m of matches) {
    if (!m.incidents?.includes(WO_ELIMINACAO)) continue
    if (m.homeScore === 0 && m.awayScore === WO_GOLS && m.homeTeamId) ids.add(m.homeTeamId)
    if (m.awayScore === 0 && m.homeScore === WO_GOLS && m.awayTeamId) ids.add(m.awayTeamId)
  }
  return ids
}
