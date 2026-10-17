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
import { ChampionTag } from './ChampionBanner'
import { computePodium } from '../lib/champion'
import { MatchesReadOnly } from './MatchesReadOnly'
import { MatchCalendar } from './MatchCalendar'
import { SponsorsStrip } from './SponsorsStrip'
import { StatsPanel } from './StatsPanel'
import {
  atletaDaCategoria,
  categoriaInicial,
  categoriaPadrao,
  competicaoDaCategoria,
  elencoDeTimes,
  partidasDaCategoria,
  statusDaCategoria,
  statusEfetivo,
  temVariasCategorias,
} from '../lib/categorias'

type Tab = 'overview' | 'matches' | 'calendar' | 'stats'

export function PublicChampionship({
  championshipId,
  initialCategory,
  onHome,
}: {
  championshipId: string
  /** Categoria a abrir de início (deep link `#/c/<id>?cat=<categoria>`). */
  initialCategory?: string
  onHome: () => void
}) {
  const [champ, setChamp] = useState<Championship | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [events, setEvents] = useState<MatchEvent[]>([])
  const [tab, setTab] = useState<Tab>('overview')
  /** Categoria escolhida nas abas (cada categoria é uma competição à parte). */
  const [catId, setCatId] = useState<string | undefined>(initialCategory)
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

  // Cada categoria é uma competição à parte (tabela, jogos, campeão próprios).
  // A aba escolhe qual delas está na tela — como no painel do organizador.
  const varias = temVariasCategorias(champ)
  const padraoCat = categoriaPadrao(champ)
  const catAtual = varias ? catId ?? categoriaInicial(champ) : padraoCat
  const comp = competicaoDaCategoria(champ, catAtual)
  const timesCat = elencoDeTimes(teams, varias ? catAtual : undefined)
  const partidasCat = partidasDaCategoria(matches, varias ? catAtual : undefined, padraoCat)
  const atletasCat = players.filter((p) => atletaDaCategoria(p.categoryId, varias ? catAtual : undefined, padraoCat))
  const idsCat = new Set(partidasCat.map((m) => m.id))
  const eventosCat = events.filter((e) => idsCat.has(e.matchId))

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
                <StatusPill status={varias ? statusDaCategoria(champ, catAtual) : statusEfetivo(champ)} />
              </div>
              <p className="manage__meta">
                {SPORT_LABELS[champ.sport]} · {FORMAT_LABELS[comp.format]}
                {champ.season ? ` · ${champ.season}` : ''}
              </p>
              <ChampionTag podium={computePodium(comp, timesCat, partidasCat, eventosCat)} teams={timesCat} />
            </div>
          </div>
          {champ.description && <p className="public__desc">{champ.description}</p>}

          {varias && (
            <nav className="cat-tabs" aria-label="Categorias">
              {champ.categories.map((c) => {
                const st = statusDaCategoria(champ, c.id)
                return (
                  <button
                    key={c.id}
                    className={`cat-tab ${catAtual === c.id ? 'is-active' : ''} cat-tab--${st}`}
                    onClick={() => setCatId(c.id)}
                  >
                    {c.name}
                    {st === 'finished' && <span className="cat-tab__mark" title="Categoria encerrada">🏁</span>}
                  </button>
                )
              })}
            </nav>
          )}

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
        {tab === 'overview' && <Overview championship={comp} teams={timesCat} matches={partidasCat} players={atletasCat} events={eventosCat} />}
        {tab === 'matches' && <MatchesReadOnly championship={comp} teams={timesCat} matches={partidasCat} />}
        {tab === 'calendar' && <MatchCalendar championship={comp} teams={timesCat} matches={partidasCat} />}
        {tab === 'stats' && <StatsPanel events={eventosCat} players={atletasCat} teams={timesCat} matches={partidasCat} categories={champ.categories} />}
      </div>

      <footer className="public__footer">
        <span className="logo-word">Tabela<b>ço</b></span> · Gerencie seu campeonato em tabelaço
      </footer>
    </div>
  )
}
