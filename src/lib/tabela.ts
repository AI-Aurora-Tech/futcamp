// ---------------------------------------------------------------------------
// "Gerar tabela" com jogos já criados.
//
// Em vez de apagar tudo e sortear de novo, completa a tabela da fase de
// classificação (pontos corridos ou 1ª fase de grupos) seguindo as regras do
// campeonato:
//  • jogos encerrados ou em andamento ficam como estão;
//  • jogos ainda não realizados continuam, se o confronto ainda vale pelas
//    regras (mesmo grupo, turno/returno) — preservando data, local e árbitro;
//  • jogos não realizados que deixaram de valer (time trocou de grupo, saiu da
//    categoria, confronto repetido) são removidos;
//  • os confrontos que faltam são criados, cada um na primeira rodada em que
//    nenhum dos dois times já joga.
// ---------------------------------------------------------------------------
import type { Championship, Match, Team } from '../types'
import { generateRoundRobin } from './fixtures'
import { matchStage } from './groupStages'

export type NovoJogo = Omit<Match, 'id' | 'createdAt'>

export interface PlanoTabela {
  /** Jogos já realizados (encerrados ou em andamento), mantidos. */
  realizados: number
  /** Jogos não realizados que continuam valendo, mantidos. */
  mantidos: number
  /** Jogos não realizados que deixaram de valer pelas regras. */
  remover: Match[]
  /** Confrontos que faltam. */
  criar: NovoJogo[]
}

const par = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/**
 * Planeja a tabela da fase de classificação. `teams` e `matches` são os DA
 * CATEGORIA (com o grupo da categoria em `team.group`).
 */
export function planejarTabela(
  championship: Championship,
  teams: Team[],
  matches: Match[],
  categoryId?: string,
): PlanoTabela {
  const isGroups = championship.format === 'groups_knockout'
  const turnoEReturno = !!championship.doubleRound
  const porTime = championship.format === 'league' ? championship.leagueMatchesPerTeam : undefined
  const limite = porTime && porTime > 0 ? porTime : Infinity

  // Só a fase de classificação inicial entra na conta: fases de grupos
  // seguintes e mata-mata nascem sozinhos, com os classificados.
  const daFase = matches.filter((m) => m.phase === 'group' && matchStage(m) === 1)
  const realizado = (m: Match) => m.status !== 'scheduled'

  // Grupos pelas regras: grupo da inscrição (ou um grupo geral).
  const grupos: Record<string, string[]> = {}
  for (const t of teams) {
    const g = isGroups ? t.group || 'A' : ''
    ;(grupos[g] ??= []).push(t.id)
  }
  const grupoDe = new Map<string, string>()
  for (const [g, ids] of Object.entries(grupos)) for (const id of ids) grupoDe.set(id, g)

  const vale = (m: Match) =>
    !!m.homeTeamId &&
    !!m.awayTeamId &&
    grupoDe.has(m.homeTeamId) &&
    grupoDe.get(m.homeTeamId) === grupoDe.get(m.awayTeamId)

  // Quantos jogos cada confronto pode ter: 1 (turno) ou 2 (turno e returno,
  // um com cada mando).
  const porPar = turnoEReturno ? 2 : 1
  const jogosDoPar = new Map<string, Match[]>()
  const jogosDoTime = new Map<string, number>()
  const conta = (id: string) => jogosDoTime.set(id, (jogosDoTime.get(id) ?? 0) + 1)

  // Realizados primeiro: nunca saem da tabela.
  const ordem = [...daFase].sort((a, b) => Number(realizado(b)) - Number(realizado(a)))
  const remover: Match[] = []
  let realizados = 0
  let mantidos = 0
  for (const m of ordem) {
    if (realizado(m)) {
      realizados++
      if (m.homeTeamId && m.awayTeamId) {
        const k = par(m.homeTeamId, m.awayTeamId)
        jogosDoPar.set(k, [...(jogosDoPar.get(k) ?? []), m])
        conta(m.homeTeamId)
        conta(m.awayTeamId)
      }
      continue
    }
    if (!vale(m)) {
      remover.push(m)
      continue
    }
    const k = par(m.homeTeamId!, m.awayTeamId!)
    const ja = jogosDoPar.get(k) ?? []
    const mandoRepetido = turnoEReturno && ja.some((x) => x.homeTeamId === m.homeTeamId)
    if (
      ja.length >= porPar ||
      mandoRepetido ||
      (jogosDoTime.get(m.homeTeamId!) ?? 0) >= limite ||
      (jogosDoTime.get(m.awayTeamId!) ?? 0) >= limite
    ) {
      remover.push(m)
      continue
    }
    jogosDoPar.set(k, [...ja, m])
    conta(m.homeTeamId!)
    conta(m.awayTeamId!)
    mantidos++
  }

  // Rodadas ocupadas por time, para encaixar os jogos novos sem choque.
  const removidos = new Set(remover.map((m) => m.id))
  const ocupadas = new Map<string, Set<number>>()
  for (const m of daFase) {
    if (removidos.has(m.id)) continue
    for (const id of [m.homeTeamId, m.awayTeamId]) {
      if (!id) continue
      if (!ocupadas.has(id)) ocupadas.set(id, new Set())
      ocupadas.get(id)!.add(m.round)
    }
  }
  const livre = (a: string, b: string) => {
    let r = 1
    while (ocupadas.get(a)?.has(r) || ocupadas.get(b)?.has(r)) r++
    return r
  }

  // Confrontos que faltam, na ordem do todos-contra-todos de cada grupo.
  const criar: NovoJogo[] = []
  for (const [g, ids] of Object.entries(grupos)) {
    if (ids.length < 2) continue
    const ideal = [...generateRoundRobin(ids, turnoEReturno)].sort((a, b) => a.round - b.round)
    for (const f of ideal) {
      const home = f.homeTeamId!
      const away = f.awayTeamId!
      const k = par(home, away)
      const ja = jogosDoPar.get(k) ?? []
      if (ja.length >= porPar) continue
      if ((jogosDoTime.get(home) ?? 0) >= limite || (jogosDoTime.get(away) ?? 0) >= limite) continue
      // No returno, o mando que falta; no turno único, o do sorteio.
      let [h, a] = [home, away]
      if (turnoEReturno && ja.some((x) => x.homeTeamId === home)) [h, a] = [away, home]
      if (turnoEReturno && ja.some((x) => x.homeTeamId === h)) continue

      const round = livre(h, a)
      for (const id of [h, a]) {
        if (!ocupadas.has(id)) ocupadas.set(id, new Set())
        ocupadas.get(id)!.add(round)
        conta(id)
      }
      const novo: NovoJogo = {
        championshipId: championship.id,
        categoryId,
        round,
        phase: 'group',
        stage: isGroups ? 1 : undefined,
        group: isGroups ? g : undefined,
        homeTeamId: h,
        awayTeamId: a,
        homeScore: null,
        awayScore: null,
        status: 'scheduled',
      }
      jogosDoPar.set(k, [...ja, novo as Match])
      criar.push(novo)
    }
  }

  return { realizados, mantidos, remover, criar }
}
