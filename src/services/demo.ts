// ---------------------------------------------------------------------------
// Armazenamento local do MODO DEMO (sem Supabase).
// Guarda todas as coleções do Tabelaço no localStorage, permitindo usar o app
// por completo sem backend. Os serviços em src/services caem aqui quando o
// Supabase não está configurado.
// ---------------------------------------------------------------------------
import { simpleHash } from '../lib/id'
import type {
  Championship,
  Match,
  MatchEvent,
  Official,
  Player,
  Team,
} from '../types'

const KEY = 'futcamp:data:v1'

interface DemoData {
  championships: Championship[]
  teams: Team[]
  players: Player[]
  matches: Match[]
  events: MatchEvent[]
  officials: Official[]
}

const EMPTY: DemoData = {
  championships: [],
  teams: [],
  players: [],
  matches: [],
  events: [],
  officials: [],
}

function load(): DemoData {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return structuredClone(EMPTY)
    const parsed = JSON.parse(raw) as Partial<DemoData>
    const merged = { ...structuredClone(EMPTY), ...parsed }
    // Garante que toda coleção seja um array (dados antigos/parciais não podem
    // quebrar filtros como d.officials.filter(...)).
    const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
    merged.championships = arr(merged.championships)
    merged.teams = arr(merged.teams)
    merged.players = arr(merged.players)
    merged.matches = arr(merged.matches)
    merged.events = arr(merged.events)
    merged.officials = arr(merged.officials)
    return merged
  } catch {
    return structuredClone(EMPTY)
  }
}

function save(data: DemoData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    /* ignore quota / privacy-mode */
  }
}

/** Executa uma mutação sobre o estado e persiste. */
export function mutate<T>(fn: (data: DemoData) => T): T {
  const data = load()
  const result = fn(data)
  save(data)
  return result
}

/** Leitura somente. */
export function query<T>(fn: (data: DemoData) => T): T {
  return fn(load())
}

/** Semeia dados de exemplo na primeira execução do modo demo. */
export function ensureSeed(ownerId: string): void {
  const data = load()
  if (data.championships.length > 0) return

  const now = new Date().toISOString()
  const champId = 'demo-champ-1'
  const teams: Team[] = [
    { id: 'demo-t1', championshipId: champId, name: 'Leões FC', shortName: 'LEO', logo: '🦁', color: '#f59e0b', coach: 'Carlos Menezes', accessToken: 'demo-token-leoes', createdAt: now },
    { id: 'demo-t2', championshipId: champId, name: 'Águias United', shortName: 'AGU', logo: '🦅', color: '#2563eb', coach: 'Rita Alcântara', accessToken: 'demo-token-aguias', createdAt: now },
    { id: 'demo-t3', championshipId: champId, name: 'Tigres do Vale', shortName: 'TIG', logo: '🐯', color: '#dc2626', coach: 'Paulo Vidal', accessToken: 'demo-token-tigres', createdAt: now },
    { id: 'demo-t4', championshipId: champId, name: 'Fúria Azul', shortName: 'FUR', logo: '🐺', color: '#0ea5e9', coach: 'Marina Souza', accessToken: 'demo-token-furia', createdAt: now },
  ]
  const players: Player[] = [
    { id: 'demo-p1', teamId: 'demo-t1', championshipId: champId, name: 'Gabriel Lima', number: 10, position: 'ATA', categoryId: 'cat-livre', role: 'atleta', createdAt: now },
    { id: 'demo-p2', teamId: 'demo-t1', championshipId: champId, name: 'Diego Rocha', number: 1, position: 'GOL', categoryId: 'cat-livre', role: 'atleta', createdAt: now },
    { id: 'demo-p3', teamId: 'demo-t2', championshipId: champId, name: 'Rafael Torres', number: 9, position: 'ATA', categoryId: 'cat-livre', role: 'atleta', createdAt: now },
    { id: 'demo-p4', teamId: 'demo-t2', championshipId: champId, name: 'Bruno Aguiar', number: 5, position: 'VOL', categoryId: 'cat-livre', role: 'atleta', createdAt: now },
    { id: 'demo-p5', teamId: 'demo-t3', championshipId: champId, name: 'Igor Nunes', number: 7, position: 'MEI', categoryId: 'cat-livre', role: 'atleta', createdAt: now },
    { id: 'demo-p6', teamId: 'demo-t4', championshipId: champId, name: 'Léo Prado', number: 11, position: 'ATA', categoryId: 'cat-livre', role: 'atleta', createdAt: now },
  ]

  data.championships.push({
    id: champId,
    ownerId,
    name: 'Copa Tabelaço 2026',
    sport: 'futebol',
    audience: 'adulto',
    categories: [{ id: 'cat-livre', name: 'Adulto Livre', exceptions: 0, maxAthletes: 25, maxStaff: 5 }],
    registrationCutoffHours: 3,
    closedRounds: [],
    format: 'league',
    season: '2026',
    status: 'active',
    description: 'Campeonato de demonstração — edite ou crie o seu.',
    logo: '🏆',
    primaryColor: '#16a34a',
    pointsWin: 3,
    pointsDraw: 1,
    doubleRound: true,
    referees: [
      { id: 'demo-ref-1', name: 'Ricardo Árbitro', phone: '(11) 90000-0001' },
      { id: 'demo-ref-2', name: 'Fernanda Apito' },
    ],
    venues: [
      { id: 'demo-venue-1', name: 'Estádio Municipal', address: 'Av. Central, 100' },
      { id: 'demo-venue-2', name: 'Arena Vila Nova' },
    ],
    sponsors: [
      { id: 'demo-spon-1', name: 'Loja do Esporte', tier: 'patrocinador', logo: '🏪' },
      { id: 'demo-spon-2', name: 'Rádio Local FM', tier: 'parceiro', logo: '📻' },
    ],
    createdAt: now,
  })
  data.teams.push(...teams)
  data.players.push(...players)
  data.officials.push({
    id: 'demo-mesa-1',
    championshipId: champId,
    name: 'Mesário Demo',
    username: 'mesa1',
    passwordHash: simpleHash('mesa:1234'),
    createdAt: now,
  })
  save(data)
}
