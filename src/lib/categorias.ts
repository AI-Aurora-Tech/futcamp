// ---------------------------------------------------------------------------
// A categoria como competição.
//
// Cada categoria de um campeonato tem tabela, classificação, mata-mata,
// campeão e situação próprios — o Sub-11 pode estar encerrado com o Sub-17
// ainda na semifinal. O clube, porém, é um só: o Leões FC tem uma diretoria e
// disputa o Sub-11 e o Sub-15.
//
// Estas funções são o filtro que separa uma competição da outra. Todas
// toleram o dado ANTIGO — partida sem categoria, clube sem inscrição — porque
// campeonato convertido, cache de navegador e modo demo podem chegar assim, e
// uma tela em branco é pior do que uma tela sem separação.
// ---------------------------------------------------------------------------
import type { Category, Championship, ChampionshipStatus, Match, Team } from '../types'

/** A primeira categoria — é dela que o campeonato parte, e é o padrão. */
export function categoriaPadrao(
  champ: Pick<Championship, 'categories'> | null | undefined,
): string | undefined {
  return champ?.categories?.[0]?.id
}

/** O campeonato tem mais de uma competição dentro dele? */
export function temVariasCategorias(
  champ: Pick<Championship, 'categories'> | null | undefined,
): boolean {
  return (champ?.categories?.length ?? 0) > 1
}

/** A categoria pelo id. */
export function categoriaPorId(
  champ: Pick<Championship, 'categories'> | null | undefined,
  categoryId: string | undefined,
): Category | undefined {
  if (!categoryId) return undefined
  return champ?.categories?.find((c) => c.id === categoryId)
}

/**
 * A situação DESTA categoria: rascunho, em andamento ou encerrada.
 * Sem situação própria, herda a do campeonato.
 */
export function statusDaCategoria(
  champ: Pick<Championship, 'categories' | 'status'> | null | undefined,
  categoryId: string | undefined,
): ChampionshipStatus {
  return categoriaPorId(champ, categoryId)?.status ?? champ?.status ?? 'draft'
}

/**
 * Situação EFETIVA do campeonato, olhando as categorias.
 *
 * Com várias categorias, cada uma tem a sua situação — e o campeonato como um
 * todo não pode continuar "rascunho" quando as categorias já estão em
 * andamento. A regra: encerrado só quando TODAS terminaram; em andamento se
 * alguma está em andamento (ou já encerrou, mas nem todas); senão, rascunho.
 */
export function statusEfetivo(
  champ: Pick<Championship, 'categories' | 'status'> | null | undefined,
): ChampionshipStatus {
  const cats = champ?.categories ?? []
  if (cats.length === 0) return champ?.status ?? 'draft'
  const sts = cats.map((c) => statusDaCategoria(champ, c.id))
  if (sts.every((s) => s === 'finished')) return 'finished'
  if (sts.some((s) => s === 'active' || s === 'finished')) return 'active'
  return champ?.status ?? 'draft'
}

/** Quando esta categoria foi encerrada (ou o campeonato, como reserva). */
export function encerradaEm(
  champ: Pick<Championship, 'categories' | 'finishedAt'> | null | undefined,
  categoryId: string | undefined,
): string | undefined {
  return categoriaPorId(champ, categoryId)?.finishedAt ?? champ?.finishedAt
}

/**
 * As partidas de uma categoria.
 *
 * Partida sem categoria pertence à primeira — é o que a migration 0033 grava,
 * e o que vale para qualquer dado que tenha escapado dela.
 */
export function partidasDaCategoria(
  matches: Match[] | null | undefined,
  categoryId: string | undefined,
  padrao?: string,
): Match[] {
  const lista = matches ?? []
  if (!categoryId) return lista
  return lista.filter((m) => (m.categoryId ?? padrao) === categoryId)
}

/**
 * Os clubes inscritos numa categoria.
 *
 * Clube sem nenhuma inscrição vale para TODAS: é o campeonato que ainda não
 * foi organizado por categoria, e escondê-lo deixaria a aba vazia sem
 * explicação.
 */
export function timesDaCategoria(
  teams: Team[] | null | undefined,
  categoryId: string | undefined,
): Team[] {
  const lista = teams ?? []
  if (!categoryId) return lista
  return lista.filter((t) => !t.categoryIds?.length || t.categoryIds.includes(categoryId))
}

/** O grupo do clube NESTA categoria (com o grupo antigo como reserva). */
export function grupoDoTime(team: Team | null | undefined, categoryId?: string): string | undefined {
  if (!team) return undefined
  if (categoryId && team.groupByCategory?.[categoryId]) return team.groupByCategory[categoryId]
  return team.group || undefined
}

/**
 * O clube visto de dentro de uma categoria: o grupo daquela categoria passa a
 * ser o `group` do time.
 *
 * Serve para entregar às contas de classificação e chaveamento — elas leem
 * `team.group` e não precisam saber que o grupo virou coisa da inscrição.
 */
export function timeNaCategoria(team: Team, categoryId?: string): Team {
  const g = grupoDoTime(team, categoryId)
  return g === team.group ? team : { ...team, group: g }
}

/** Todos os clubes de uma categoria, já com o grupo dela. */
export function elencoDeTimes(
  teams: Team[] | null | undefined,
  categoryId: string | undefined,
): Team[] {
  return timesDaCategoria(teams, categoryId).map((t) => timeNaCategoria(t, categoryId))
}

/** O atleta joga nesta categoria? Atleta sem categoria conta para a primeira. */
export function atletaDaCategoria(
  playerCategoryId: string | undefined,
  categoryId: string | undefined,
  padrao?: string,
): boolean {
  if (!categoryId) return true
  return (playerCategoryId || padrao) === categoryId
}

/**
 * O campeonato VISTO DE DENTRO de uma categoria.
 *
 * Devolve o mesmo campeonato com os números daquela categoria no lugar dos do
 * campeonato: grupos, times por grupo, classificados por grupo, chaveamento,
 * turno e returno, disputa de 3º lugar e situação.
 *
 * A forma de disputa não entra na conta — ela é do campeonato e vale para
 * todas as categorias. O que muda de uma para outra são os números.
 *
 * A vantagem de devolver um `Championship` inteiro é que nada mais precisa
 * mudar: `computeStandings`, `planKnockout`, `suggestBracket` e `groupStagesOf`
 * continuam recebendo o que sempre receberam, só que já filtrado pela
 * categoria. Campo que a categoria não define herda o do campeonato — é o que
 * mantém rodando tudo o que foi criado antes da separação.
 */
export function competicaoDaCategoria(
  champ: Championship,
  categoryId: string | undefined,
): Championship {
  const cat = categoriaPorId(champ, categoryId)
  if (!cat) return champ

  const ou = <T,>(daCategoria: T | undefined, doCampeonato: T): T =>
    daCategoria === undefined ? doCampeonato : daCategoria

  // Forma de disputa da categoria (ou a do campeonato). Quando a categoria tem
  // um formato PRÓPRIO e diferente do campeonato, os ajustes específicos de
  // formato (grupos, chaveamento, classificados…) NÃO herdam os do campeonato —
  // eles pertencem a outro formato e misturá-los quebraria a montagem. Ficam
  // valendo só os que a própria categoria definiu.
  const format = cat.format ?? champ.format
  const herdaEstrutura = !cat.format || cat.format === champ.format
  const est = <T,>(daCategoria: T | undefined, doCampeonato: T): T =>
    herdaEstrutura ? ou(daCategoria, doCampeonato) : (daCategoria as T)

  return {
    ...champ,
    format,
    status: cat.status ?? champ.status,
    finishedAt: cat.finishedAt ?? champ.finishedAt,
    // Regras de classificação próprias (herdam quando ausentes).
    pointsWin: ou(cat.pointsWin, champ.pointsWin),
    pointsDraw: ou(cat.pointsDraw, champ.pointsDraw),
    tiebreakers: ou(cat.tiebreakers, champ.tiebreakers),
    // Estrutura específica do formato.
    numGroups: est(cat.numGroups, champ.numGroups),
    teamsPerGroup: est(cat.teamsPerGroup, champ.teamsPerGroup),
    advancePerGroup: est(cat.advancePerGroup, champ.advancePerGroup),
    advanceByGroup: est(cat.advanceByGroup, champ.advanceByGroup),
    groupStages: est(cat.groupStages, champ.groupStages),
    leagueQualifiers: est(cat.leagueQualifiers ?? cat.qualifiers, champ.leagueQualifiers),
    bracket: est(cat.bracket, champ.bracket),
    generalStanding: est(cat.generalStanding, champ.generalStanding),
    leagueEntries: est(cat.leagueEntries, champ.leagueEntries),
    leagueMatchesPerTeam: est(cat.leagueMatchesPerTeam, champ.leagueMatchesPerTeam),
    thirdPlace: ou(cat.thirdPlace, champ.thirdPlace),
    doubleRound: ou(cat.doubleRound, champ.doubleRound),
    autoKnockout: ou(cat.autoKnockout, champ.autoKnockout),
  }
}

/** A categoria define alguma coisa da estrutura, ou herda tudo? */
export function estruturaPropria(cat: Category | null | undefined): boolean {
  if (!cat) return false
  return (
    cat.numGroups !== undefined ||
    cat.teamsPerGroup !== undefined ||
    cat.advancePerGroup !== undefined ||
    cat.advanceByGroup !== undefined ||
    cat.groupStages !== undefined ||
    cat.leagueQualifiers !== undefined ||
    cat.bracket !== undefined ||
    cat.thirdPlace !== undefined ||
    cat.doubleRound !== undefined ||
    cat.generalStanding !== undefined ||
    cat.leagueEntries !== undefined ||
    cat.leagueMatchesPerTeam !== undefined ||
    cat.format !== undefined ||
    cat.pointsWin !== undefined ||
    cat.pointsDraw !== undefined ||
    cat.tiebreakers !== undefined
  )
}

/**
 * A categoria a mostrar quando a tela abre.
 *
 * Prefere a que está em andamento — é onde o organizador tem trabalho. Sem
 * nenhuma em andamento, a primeira.
 */
export function categoriaInicial(
  champ: Pick<Championship, 'categories' | 'status'> | null | undefined,
): string | undefined {
  const cats = champ?.categories ?? []
  const ativa = cats.find((c) => statusDaCategoria(champ, c.id) === 'active')
  return (ativa ?? cats[0])?.id
}
