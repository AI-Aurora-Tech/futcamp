// ---------------------------------------------------------------------------
// Tabelaço — modelos de domínio
// Plataforma de gestão de campeonatos esportivos.
// ---------------------------------------------------------------------------

export type Sport = 'futebol' | 'futsal' | 'society' | 'volei' | 'basquete'

/** Formato de disputa do campeonato. */
export type ChampionshipFormat = 'league' | 'groups_knockout' | 'knockout'

export type ChampionshipStatus = 'draft' | 'active' | 'finished'

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
  createdAt: string
}

export interface Team {
  id: string
  championshipId: string
  name: string
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

export type Position = 'GOL' | 'ZAG' | 'LAT' | 'VOL' | 'MEI' | 'ATA' | 'TEC'

export const POSITIONS: { id: Position; label: string }[] = [
  { id: 'GOL', label: 'Goleiro' },
  { id: 'ZAG', label: 'Zagueiro' },
  { id: 'LAT', label: 'Lateral' },
  { id: 'VOL', label: 'Volante' },
  { id: 'MEI', label: 'Meia' },
  { id: 'ATA', label: 'Atacante' },
  { id: 'TEC', label: 'Técnico' },
]

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
  createdAt: string
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
  /** Relato de incidentes (atrasos, segurança, conduta de torcidas). */
  incidents?: string
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
