// ---------------------------------------------------------------------------
// Tabelaço — modelos de domínio
// Plataforma de gestão de campeonatos esportivos.
// ---------------------------------------------------------------------------

export type Sport = 'futebol' | 'futsal' | 'society' | 'volei' | 'basquete'

/** Formato de disputa do campeonato. */
export type ChampionshipFormat = 'league' | 'groups_knockout' | 'knockout'

export type ChampionshipStatus = 'draft' | 'active' | 'finished'

/** Plano contratado para o campeonato (ver `lib/pricing.ts`). */
export type PlanKey = 'gratis' | 'bronze' | 'prata' | 'ouro' | 'diamante'

/**
 * Situação da cobrança do campeonato:
 *  • `free`    — plano grátis (ou Diamante, acertado fora do app): liberado;
 *  • `pending` — criado, aguardando o pagamento: fica bloqueado;
 *  • `paid`    — pagamento confirmado pelo Asaas: liberado.
 */
export type PaymentStatus = 'free' | 'pending' | 'paid'

/** Público-alvo do campeonato. */
export type Audience = 'infantil' | 'adulto'

/**
 * Categoria do campeonato. Serve para enquadrar e validar os atletas pela regra
 * de ano de nascimento.
 *
 *  • Infantil → `birthYearMode: 'min'`: só entram atletas nascidos em `birthYear`
 *    ou depois (mais novos).
 *  • Adulto/veterano → `birthYearMode: 'max'` (opcional): só entram atletas
 *    nascidos em `birthYear` ou antes; `exceptions` permite N atletas por time
 *    fora dessa regra.
 */
export interface Category {
  id: string
  name: string
  /**
   * Atletas federados (campo/futsal): a permissão é DE CATEGORIA, não do
   * campeonato — o mesmo torneio de base costuma proibir no Sub-11 e liberar
   * dois no Sub-15. `maxFederated` ausente ou nulo = sem limite.
   */
  allowFederated?: boolean
  maxFederated?: number | null
  birthYear?: number
  birthYearMode?: 'min' | 'max'
  /** Nº de atletas por time que podem furar a regra de ano de nascimento. */
  exceptions?: number
  /**
   * Ano-limite da EXCEÇÃO (mesma direção da regra). Ex.: regra "1979 ou mais
   * velho" e exceção "1980 ou mais velho" → exceptionYear = 1980. Atletas fora
   * até deste ano podem entrar como exceção; além disso, nunca.
   */
  exceptionYear?: number
  /** Máximo de atletas por time nesta categoria (0/indefinido = sem limite). */
  maxAthletes?: number
  /** Máximo de membros da comissão técnica por time nesta categoria. */
  maxStaff?: number

  /* --- Regras de jogo (entram no regulamento) --------------------------- */

  /** Duração de CADA tempo, em minutos. */
  periodMinutes?: number
  /** Quantos tempos tem a partida (padrão 2). */
  periods?: number
  /**
   * Substituições: 'rotativa' (livres, o atleta pode voltar) ou 'limitada'
   * (até `maxSubstitutions` por partida). Ausente = não definido, e o
   * regulamento não afirma nada.
   */
  substitutionMode?: SubstitutionMode
  /** Quantas substituições por partida, quando o modo é 'limitada'. */
  maxSubstitutions?: number
  /** O cartão amarelo acumula para suspensão automática? */
  yellowAccumulates?: boolean
  /** Quantos amarelos suspendem, quando acumulam (padrão 3). */
  yellowsForSuspension?: number
  /**
   * Penalidade da expulsão NESTA categoria: seguir com um atleta a menos ou
   * substituir o expulso. Cada categoria é um caso — o que vale no Sub-11
   * raramente vale no adulto.
   */
  sendOffPolicy?: SendOffPolicy
  /**
   * Quantas equipes se classificam nesta categoria. O que o número significa
   * depende do formato, que é o mesmo para todas: nos pontos corridos são os
   * primeiros da tabela; em grupos + mata-mata, quantos avançam POR GRUPO.
   */
  qualifiers?: number
  /** Valor da arbitragem por partida, em centavos. */
  refereeFeeCents?: number
  /** Chave PIX para o pagamento da arbitragem. */
  refereePix?: string
}

/** Como as substituições funcionam na categoria. */
export type SubstitutionMode = 'rotativa' | 'limitada'

export const SUBSTITUTION_LABELS: Record<SubstitutionMode, string> = {
  rotativa: 'Rotativa (livre)',
  limitada: 'Com limite por partida',
}

/**
 * O que acontece com a equipe quando um atleta é expulso: joga com um a menos
 * (regra do futebol de campo) ou pode substituir o expulso depois de cumprido
 * o tempo de punição (comum no futsal e em torneios de base).
 */
export type SendOffPolicy = 'menos_um' | 'substitui'

export const SEND_OFF_LABELS: Record<SendOffPolicy, string> = {
  menos_um: 'A equipe segue com um atleta a menos',
  substitui: 'A equipe pode substituir o atleta expulso',
}

/** Árbitro do campeonato (apita as partidas). */
export interface Referee {
  id: string
  name: string
  phone?: string
}

/** Campo / local onde as partidas são disputadas. */
export interface Venue {
  id: string
  name: string
  address?: string
}

/** Patrocinador ou parceiro exibido na página pública. */
export interface Sponsor {
  id: string
  name: string
  /** Emoji ou data URL do logotipo. */
  logo?: string
  /** Link do site do patrocinador (opcional). */
  url?: string
  tier: 'patrocinador' | 'parceiro'
}

/**
 * Critério de desempate da classificação, aplicado APÓS os pontos ganhos
 * (que são sempre o primeiro critério).
 */
export type TiebreakerId =
  | 'wins'
  | 'goal_diff'
  | 'goals_for'
  | 'goals_against'
  | 'head_to_head'
  | 'fewest_red'
  | 'fewest_yellow'
  | 'draw_lots'

export const TIEBREAKER_LABELS: Record<TiebreakerId, string> = {
  wins: 'Mais vitórias',
  goal_diff: 'Melhor saldo de gols',
  goals_for: 'Mais gols marcados (gols pró)',
  goals_against: 'Menos gols sofridos',
  head_to_head: 'Confronto direto',
  fewest_red: 'Menos cartões vermelhos',
  fewest_yellow: 'Menos cartões amarelos',
  draw_lots: 'Sorteio (ordem alfabética)',
}

/** Ordem sugerida de desempate para novos campeonatos. */
export const DEFAULT_TIEBREAKERS: TiebreakerId[] = [
  'wins',
  'goal_diff',
  'goals_for',
  'head_to_head',
  'fewest_red',
  'fewest_yellow',
  'draw_lots',
]

/** Ordem histórica — campeonatos criados antes dos critérios configuráveis. */
export const LEGACY_TIEBREAKERS: TiebreakerId[] = ['goal_diff', 'goals_for', 'wins']

/** Chave de "grupo" usada quando a classificação é geral (pontos corridos). */
export const OVERALL_GROUP = '*'

/**
 * Uma fase de grupos do campeonato. O formato "grupos + mata-mata" pode ter
 * mais de uma: os classificados da 1ª fase são redistribuídos em novos grupos
 * na 2ª fase, e assim por diante até o mata-mata.
 */
export interface GroupStage {
  id: string
  /** Nome exibido (ex.: "Segunda fase"). Vazio = nome automático. */
  name?: string
  /** Quantidade de grupos desta fase. */
  numGroups: number
  /**
   * Classificados POR GRUPO. Permite grupos com tamanhos diferentes:
   * `{ A: 2, B: 1 }` = dois do grupo A e um do grupo B.
   * Grupo sem entrada usa `advancePerGroup`.
   */
  advanceByGroup?: Record<string, number>
  /** Padrão de classificados por grupo desta fase. */
  advancePerGroup?: number
  /** Turno e returno dentro dos grupos desta fase. */
  doubleRound?: boolean
}

/**
 * Vaga do mata-mata: "o Nº `position` do grupo `group`".
 * `group` é a letra do grupo ("A", "B"…) ou `OVERALL_GROUP` na classificação geral.
 */
export interface QualifierSlot {
  group: string
  position: number
}

/** Confronto do chaveamento: quem pega quem na primeira fase do mata-mata. */
export interface BracketPairing {
  id: string
  /** `null` = vaga vazia (bye): o adversário avança direto. */
  home: QualifierSlot | null
  away: QualifierSlot | null
}

export interface Championship {
  id: string
  ownerId: string
  name: string
  sport: Sport
  audience: Audience
  /** Categorias do campeonato (ao menos uma). */
  categories: Category[]
  format: ChampionshipFormat
  season: string
  status: ChampionshipStatus
  description?: string
  /** Emoji ou data URL usado como brasão do campeonato. */
  logo?: string
  primaryColor?: string
  /** Pontuação por vitória (padrão 3). */
  pointsWin: number
  /** Pontuação por empate (padrão 1). */
  pointsDraw: number
  /**
   * Prazo de inscrição: encerra X horas antes de cada partida do time.
   * Reabre automaticamente após a partida ser finalizada. 0 = sem prazo.
   */
  registrationCutoffHours: number
  /** Rodadas com inscrições encerradas manualmente pelo organizador. */
  closedRounds?: number[]
  /** Turno e returno (todos jogam duas vezes) no formato de pontos corridos. */
  doubleRound: boolean
  /** Número de grupos (formato grupos + mata-mata). */
  numGroups?: number
  /** Quantidade de times por grupo (opcional; formato grupos + mata-mata). */
  teamsPerGroup?: number
  /** Nº de classificados por grupo para o mata-mata (formato grupos + mata-mata). */
  advancePerGroup?: number
  /**
   * Classificados por grupo da 1ª fase, quando os grupos têm tamanhos
   * diferentes: `{ A: 2, B: 1 }`. Grupo ausente cai em `advancePerGroup`.
   */
  advanceByGroup?: Record<string, number>
  /**
   * Fases de grupos do campeonato, na ordem. Ausente = uma única fase,
   * descrita por `numGroups` / `advancePerGroup` / `advanceByGroup`.
   */
  groupStages?: GroupStage[]
  /** Nº de classificados no formato de pontos corridos (liga). */
  leagueQualifiers?: number
  /**
   * Critérios de desempate da classificação, na ordem de aplicação (os pontos
   * ganhos são sempre o primeiro critério, por isso não entram na lista).
   */
  tiebreakers?: TiebreakerId[]
  /**
   * Chaveamento da primeira fase do mata-mata: quem pega quem. As fases
   * seguintes saem daí — o vencedor do confronto 1 enfrenta o do 2, e assim
   * por diante até a final.
   */
  bracket?: BracketPairing[]
  /** Criar também a disputa de 3º lugar (perdedores das semifinais). */
  thirdPlace?: boolean
  /**
   * Gerar o mata-mata automaticamente quando TODOS os jogos da primeira fase
   * forem encerrados. Padrão: ligado.
   */
  autoKnockout?: boolean
  /** Árbitros cadastrados no campeonato. */
  referees?: Referee[]
  /** Campos / locais das partidas. */
  venues?: Venue[]
  /** Patrocinadores e parceiros exibidos na página pública. */
  sponsors?: Sponsor[]
  /**
   * Token do link público de CRIAÇÃO de time. O organizador envia o link
   * `#/novo-time/<championshipId>?k=<token>` e o responsável cria o próprio time.
   */
  teamCreateToken?: string
  /** Plano contratado. Pode ser trocado depois, sem perder nada (0032). */
  plan?: PlanKey
  /**
   * Estado anterior do plano, guardado enquanto um upgrade não foi pago.
   * É o que permite desfazer a troca e voltar o campeonato ao que era.
   * Ausente = não há troca pendente.
   */
  planChange?: {
    plan?: PlanKey
    amountCents?: number
    paymentStatus?: PaymentStatus
    paymentRef?: string
    paidAt?: string
  }
  /** Situação da cobrança — `pending` mantém o campeonato bloqueado. */
  paymentStatus?: PaymentStatus
  /** Valor cobrado (centavos): plano + categorias adicionais. */
  amountCents?: number
  /** Identificador do pagamento no Asaas, quando confirmado. */
  paymentRef?: string
  /** Momento da confirmação do pagamento. */
  paidAt?: string
  /**
   * Quantos atletas podem ficar no banco de reservas, devidamente
   * uniformizados. Vale para o campeonato inteiro.
   */
  benchSize?: number
  /**
   * Momento em que o campeonato foi encerrado. Preenchido automaticamente na
   * troca de status — é o que mantém o campeão na vitrine pública pelos dias
   * seguintes (ver `PUBLIC_FINISHED_DAYS`).
   */
  finishedAt?: string
  createdAt: string
}

export interface Team {
  id: string
  championshipId: string
  name: string
  /**
   * @deprecated A sigla saiu do cadastro do time. O campo continua no modelo
   * apenas para não perder o valor dos times antigos; onde ela ainda aparece
   * (escudo sem imagem, súmula), o nome do time é o padrão.
   */
  shortName?: string
  /** Emoji ou data URL usado como escudo. */
  logo?: string
  /** Grupo (ex.: "A", "B") no formato de grupos. */
  group?: string
  color?: string
  /** Nome do responsável pelo time (antes rotulado como "técnico"). */
  coach?: string
  /** Telefone do responsável pelo time. */
  phone?: string
  /** Token do link de inscrição (o responsável cria o acesso do time). */
  accessToken?: string
  /** Usuário do 1º responsável pelo time (definido via link de inscrição). */
  username?: string
  /** Hash da senha do 1º responsável (modo demo). */
  passwordHash?: string
  /** Usuário do 2º gestor do time (opcional — até 2 gestores). */
  username2?: string
  /** Hash da senha do 2º gestor (modo demo). */
  passwordHash2?: string
  createdAt: string
}

/** Posições em campo. Só valem para quem entra como ATLETA. */
export type AthletePosition = 'GOL' | 'ZAG' | 'LAT' | 'VOL' | 'MEI' | 'ATA'

/** Funções da comissão técnica. Quem é comissão não tem posição em campo. */
export type StaffFunction = 'TEC' | 'AUX' | 'MAS' | 'PRE' | 'MED' | 'MKT'

/**
 * O que vai gravado na coluna `position`. As duas listas dividem o mesmo
 * campo — o que separa uma da outra é o `role` do inscrito. Os códigos são
 * estáveis: 'TEC' continua sendo técnico, então quem já estava cadastrado
 * não perde a função.
 */
export type Position = AthletePosition | StaffFunction

export const POSITIONS: { id: AthletePosition; label: string }[] = [
  { id: 'GOL', label: 'Goleiro' },
  { id: 'ZAG', label: 'Zagueiro' },
  { id: 'LAT', label: 'Lateral' },
  { id: 'VOL', label: 'Volante' },
  { id: 'MEI', label: 'Meia' },
  { id: 'ATA', label: 'Atacante' },
]

export const STAFF_FUNCTIONS: { id: StaffFunction; label: string }[] = [
  { id: 'TEC', label: 'Técnico' },
  { id: 'AUX', label: 'Auxiliar técnico' },
  { id: 'MAS', label: 'Massagista' },
  { id: 'PRE', label: 'Preparador físico' },
  { id: 'MED', label: 'Médico' },
  { id: 'MKT', label: 'Marketing' },
]

/** Posição padrão de cada papel, para abrir o formulário já preenchido. */
export const POSICAO_PADRAO: Record<'atleta' | 'comissao', Position> = {
  atleta: 'ATA',
  comissao: 'TEC',
}

/** As opções que o papel aceita: posições para atleta, funções para comissão. */
export function opcoesDePosicao(
  role: 'atleta' | 'comissao' | undefined,
): { id: Position; label: string }[] {
  return role === 'comissao' ? STAFF_FUNCTIONS : POSITIONS
}

/**
 * O rótulo de um código, venha ele de qual lista vier. Procurar nas duas é de
 * propósito: quem trocou de atleta para comissão (ou o contrário) pode ter
 * ficado com o código da outra lista gravado.
 */
export function labelDaPosicao(id: Position | undefined): string {
  if (!id) return ''
  const achou = [...POSITIONS, ...STAFF_FUNCTIONS].find((x) => x.id === id)
  return achou?.label ?? id
}

/** O código pertence à lista do papel? */
export function posicaoValePara(
  role: 'atleta' | 'comissao' | undefined,
  id: Position | undefined,
): boolean {
  return opcoesDePosicao(role).some((x) => x.id === id)
}

export interface Player {
  id: string
  teamId: string
  championshipId: string
  name: string
  number?: number
  position?: Position
  birthdate?: string
  photo?: string
  /** CPF do atleta (obrigatório na inscrição). */
  cpf?: string
  /** Categoria em que o atleta está inscrito. */
  categoryId?: string
  /** Atleta (jogador) ou membro da comissão técnica. */
  role?: 'atleta' | 'comissao'
  /** Atleta federado (campeonatos infantis, quando o regulamento permite). */
  federated?: boolean
  /** Em qual modalidade é federado. */
  federatedIn?: 'campo' | 'futsal' | 'ambos'
  createdAt: string
}

/** Atleta presente (escalado) nesta partida, com o número da camisa do jogo. */
export interface LineupEntry {
  playerId: string
  /** Número da camisa nesta partida (pode diferir do número de inscrição). */
  number?: number
}

export type MatchStatus = 'scheduled' | 'live' | 'finished'

export type MatchPhase =
  | 'group'
  | 'round_of_32'
  | 'round_of_16'
  | 'quarter'
  | 'semi'
  | 'final'
  | 'third_place'

export const PHASE_LABELS: Record<MatchPhase, string> = {
  group: 'Fase de grupos',
  round_of_32: '32-avos de final',
  round_of_16: 'Oitavas de final',
  quarter: 'Quartas de final',
  semi: 'Semifinal',
  final: 'Final',
  third_place: 'Disputa de 3º lugar',
}

export interface Match {
  id: string
  championshipId: string
  /** Rodada (usado em pontos corridos e fase de grupos). */
  round: number
  phase: MatchPhase
  /** Grupo do confronto (fase de grupos). */
  group?: string
  /**
   * Qual fase de grupos (1 = primeira). Só se aplica a `phase === 'group'`.
   * Ausente = 1, para as partidas criadas antes das fases múltiplas.
   */
  stage?: number
  homeTeamId: string | null
  awayTeamId: string | null
  homeScore: number | null
  awayScore: number | null
  status: MatchStatus
  scheduledAt?: string
  venue?: string
  /** Árbitro escalado (id em Championship.referees). */
  refereeId?: string
  /** Mesário responsável por lançar os dados desta partida. */
  officialId?: string
  /**
   * Posição do confronto dentro da fase do mata-mata (0, 1, 2…). É o que liga
   * as fases: o vencedor da posição `p` vai para a posição `p / 2` da fase
   * seguinte — mandante quando `p` é par, visitante quando é ímpar.
   */
  bracketPos?: number
  /**
   * Classificado definido manualmente (W.O. ou decisão do organizador) quando o
   * confronto de mata-mata termina empatado. Tem prioridade sobre tudo.
   */
  winnerTeamId?: string
  /** Disputa por pênaltis (mata-mata): gols do mandante nas cobranças. */
  penaltyHome?: number | null
  /** Disputa por pênaltis (mata-mata): gols do visitante nas cobranças. */
  penaltyAway?: number | null
  /** Relato de incidentes (atrasos, segurança, conduta de torcidas). */
  incidents?: string
  /**
   * Atletas presentes (escalação da partida). Só quem está aqui pode receber
   * gols/cartões/eventos. Vazio/indefinido = presença ainda não registrada.
   */
  lineup?: LineupEntry[]
  createdAt: string
}

/** Mesário: lança dados das partidas em tempo real (login próprio). */
export interface Official {
  id: string
  championshipId: string
  name: string
  username: string
  /** Hash da senha (modo demo). */
  passwordHash?: string
  createdAt: string
}

export type EventType =
  | 'goal'
  | 'own_goal'
  | 'assist'
  | 'yellow_card'
  | 'red_card'
  | 'substitution'

export const EVENT_LABELS: Record<EventType, string> = {
  goal: 'Gol',
  own_goal: 'Gol contra',
  assist: 'Assistência',
  yellow_card: 'Cartão amarelo',
  red_card: 'Cartão vermelho',
  substitution: 'Substituição',
}

export interface MatchEvent {
  id: string
  matchId: string
  championshipId: string
  teamId: string
  /** Autor do gol/cartão; na substituição é quem SAIU. */
  playerId?: string
  /** Substituição: quem ENTROU. */
  playerInId?: string
  /** Detalhe (ex.: motivo do cartão vermelho / expulsão). */
  detail?: string
  type: EventType
  minute?: number
  createdAt: string
}

/** Linha calculada da tabela de classificação (não persistida). */
export interface StandingRow {
  teamId: string
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDiff: number
  points: number
}

/** Agregado de artilharia / cartões (não persistido). */
export interface PlayerStat {
  playerId?: string
  teamId: string
  name: string
  count: number
}

export const SPORT_LABELS: Record<Sport, string> = {
  futebol: 'Futebol de campo',
  futsal: 'Futsal',
  society: 'Society',
  volei: 'Vôlei',
  basquete: 'Basquete',
}

export const FORMAT_LABELS: Record<ChampionshipFormat, string> = {
  league: 'Pontos corridos',
  groups_knockout: 'Grupos + mata-mata',
  knockout: 'Mata-mata',
}

export const AUDIENCE_LABELS: Record<Audience, string> = {
  infantil: 'Infantil',
  adulto: 'Adulto',
}
