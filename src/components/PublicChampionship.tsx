import { useEffect, useState } from 'react'
import { getChampionship } from '../services/championships'
import { listTeams } from '../services/teams'
import { listPlayers } from '../services/players'
import { listEvents, listMatches } from '../services/matches'
import {
  FORMAT_LABELS,
  SPORT_LABELS,
  type Championship,
  type Match,
  type MatchEvent,
  type Player,
  type Team,
} from '../types'
import { ChampLogo, Spinner, StatusPill } from './ui'
import { Overview } from './Overview'
import { MatchesReadOnly } from './MatchesReadOnly'
import { MatchCalendar } from './MatchCalendar'
import { SponsorsStrip } from './SponsorsStrip'
import { StatsPanel } from './StatsPanel'

type Tab = 'overview' | 'matches' | 'calendar' | 'stats'

export function PublicChampionship({ championshipId, onHome }: { championshipId: string; onHome: () => void }) {
  const [champ, setChamp] = useState<Championship | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [events, setEvents] = useState<MatchEvent[]>([])
  const [tab, setTab] = useState<Tab>('overview')
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let active = true
    Promise.all([
      getChampionship(championshipId),
      listTeams(championshipId),
      listPlayers(championshipId),
      listMatches(championshipId),
      listEvents(championshipId),
    ])
      .then(([c, t, p, m, e]) => {
        if (!active) return
        if (!c) setNotFound(true)
        setChamp(c)
        setTeams(t)
        setPlayers(p)
        setMatches(m)
        setEvents(e)
      })
      .catch(() => active && setNotFound(true))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [championshipId])

  if (loading) return <div className="container pad-lg"><Spinner /></div>
  if (notFound || !champ) {
    return (
      <div className="container pad-lg center">
        <h2>Campeonato não encontrado</h2>
        <p className="muted">O link pode estar incorreto ou o campeonato foi removido.</p>
        <button className="btn btn--primary" onClick={onHome}>Ir para o início</button>
      </div>
    )
  }

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'overview', label: 'Classificação', icon: '📊' },
    { id: 'matches', label: 'Jogos', icon: '📅' },
    { id: 'calendar', label: 'Calendário', icon: '📆' },
    { id: 'stats', label: 'Estatísticas', icon: '🏅' },
  ]

  return (
    <div className="manage public" style={{ '--accent': champ.primaryColor ?? '#16a34a' } as React.CSSProperties}>
      <div className="manage__hero">
        <div className="container manage__hero-inner">
          <button className="back-link" onClick={onHome}>← Tabelaço</button>
          <div className="manage__title">
            <span className="manage__logo"><ChampLogo logo={champ.logo} /></span>
            <div>
              <div className="manage__title-row">
                <h1>{champ.name}</h1>
                <StatusPill status={champ.status} />
              </div>
              <p className="manage__meta">
                {SPORT_LABELS[champ.sport]} · {FORMAT_LABELS[champ.format]}
                {champ.season ? ` · ${champ.season}` : ''}
              </p>
            </div>
          </div>
          {champ.description && <p className="public__desc">{champ.description}</p>}
          <nav className="tabs">
            {tabs.map((t) => (
              <button key={t.id} className={`tab ${tab === t.id ? 'is-active' : ''}`} onClick={() => setTab(t.id)}>
                <span className="tab__icon">{t.icon}</span> {t.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <SponsorsStrip sponsors={champ.sponsors ?? []} />

      <div className="container manage__content">
        {tab === 'overview' && <Overview championship={champ} teams={teams} matches={matches} players={players} events={events} />}
        {tab === 'matches' && <MatchesReadOnly championship={champ} teams={teams} matches={matches} />}
        {tab === 'calendar' && <MatchCalendar championship={champ} teams={teams} matches={matches} />}
        {tab === 'stats' && <StatsPanel events={events} players={players} teams={teams} matches={matches} />}
      </div>

      <footer className="public__footer">
        <span className="logo-word">Tabela<b>ço</b></span> · Gerencie seu campeonato em tabelaço
      </footer>
    </div>
  )
}
