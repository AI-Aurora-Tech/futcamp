// ---------------------------------------------------------------------------
// FutCamp — modelos de domínio
// Plataforma de gestão de campeonatos esportivos (inspirada no iFut).
// ---------------------------------------------------------------------------

export type Sport = 'futebol' | 'futsal' | 'society' | 'volei' | 'basquete'

/** Formato de disputa do campeonato. */
export type ChampionshipFormat = 'league' | 'groups_knockout' | 'knockout'

export type ChampionshipStatus = 'draft' | 'active' | 'finished'

export interface Championship {
  id: string
  ownerId: string
  name: string
  sport: Sport
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
  /** Turno e returno (todos jogam duas vezes) no formato de pontos corridos. */
  doubleRound: boolean
  /** Número de grupos (formato grupos + mata-mata). */
  numGroups?: number
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
  coach?: string
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
  createdAt: string
}

export type EventType = 'goal' | 'own_goal' | 'assist' | 'yellow_card' | 'red_card'

export const EVENT_LABELS: Record<EventType, string> = {
  goal: 'Gol',
  own_goal: 'Gol contra',
  assist: 'Assistência',
  yellow_card: 'Cartão amarelo',
  red_card: 'Cartão vermelho',
}

export interface MatchEvent {
  id: string
  matchId: string
  championshipId: string
  teamId: string
  playerId?: string
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
