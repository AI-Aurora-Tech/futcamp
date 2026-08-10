import { useCallback, useEffect, useState } from 'react'
import {
  deleteChampionship,
  getChampionship,
  updateChampionship,
  type NewChampionship,
} from '../services/championships'
import { listTeams } from '../services/teams'
import { listPlayers } from '../services/players'
import { listEvents, listMatches } from '../services/matches'
import { listOfficials } from '../services/officials'
import {
  FORMAT_LABELS,
  SPORT_LABELS,
  type Championship,
  type Match,
  type MatchEvent,
  type Official,
  type Player,
  type Team,
} from '../types'
import { Button, ChampLogo, Spinner, StatusPill } from './ui'
import { Overview } from './Overview'
import { TeamsPanel } from './TeamsPanel'
import { PlayersPanel } from './PlayersPanel'
import { MatchesPanel } from './MatchesPanel'
import { StatsPanel } from './StatsPanel'
import { OfficialsPanel } from './OfficialsPanel'
import { ChampionshipForm } from './ChampionshipForm'

type Tab = 'overview' | 'teams' | 'players' | 'matches' | 'officials' | 'stats' | 'settings'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Visão geral', icon: '📊' },
  { id: 'teams', label: 'Times', icon: '🛡️' },
  { id: 'players', label: 'Elencos', icon: '👥' },
  { id: 'matches', label: 'Partidas', icon: '📅' },
  { id: 'officials', label: 'Mesários', icon: '🧑‍⚖️' },
  { id: 'stats', label: 'Estatísticas', icon: '🏅' },
  { id: 'settings', label: 'Ajustes', icon: '⚙️' },
]

export function ManageChampionship({
  championshipId,
  onBack,
}: {
  championshipId: string
  onBack: () => void
}) {
  const [champ, setChamp] = useState<Championship | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [events, setEvents] = useState<MatchEvent[]>([])
  const [officials, setOfficials] = useState<Official[]>([])
  const [tab, setTab] = useState<Tab>('overview')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)

  const reload = useCallback(async () => {
    const [c, t, p, m, e, o] = await Promise.all([
      getChampionship(championshipId),
      listTeams(championshipId),
      listPlayers(championshipId),
      listMatches(championshipId),
      listEvents(championshipId),
      listOfficials(championshipId),
    ])
    setChamp(c)
    setTeams(t)
    setPlayers(p)
    setMatches(m)
    setEvents(e)
    setOfficials(o)
  }, [championshipId])

  useEffect(() => {
    setLoading(true)
    reload().finally(() => setLoading(false))
  }, [reload])

  async function saveEdit(data: NewChampionship) {
    await updateChampionship(championshipId, data)
    setEditing(false)
    await reload()
  }

  async function changeStatus(status: Championship['status']) {
    await updateChampionship(championshipId, { status })
    await reload()
  }

  async function remove() {
    if (!champ) return
    if (!confirm(`Excluir o campeonato "${champ.name}"? Esta ação não pode ser desfeita.`)) return
    await deleteChampionship(championshipId)
    onBack()
  }

  function copyPublicLink() {
    const url = `${location.origin}${location.pathname}#/c/${championshipId}`
    navigator.clipboard?.writeText(url).then(
      () => alert('Link público copiado!\n\n' + url),
      () => prompt('Copie o link público:', url),
    )
  }

  if (loading) return <div className="container"><Spinner /></div>
  if (!champ) {
    return (
      <div className="container">
        <p>Campeonato não encontrado.</p>
        <Button onClick={onBack}>Voltar</Button>
      </div>
    )
  }

  return (
    <div className="manage" style={{ '--accent': champ.primaryColor ?? '#16a34a' } as React.CSSProperties}>
      <div className="manage__hero">
        <div className="container manage__hero-inner">
          <button className="back-link" onClick={onBack}>← Meus campeonatos</button>
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
            <div className="manage__actions">
              <Button variant="soft" onClick={copyPublicLink}>🔗 Link público</Button>
            </div>
          </div>
          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t.id} className={`tab ${tab === t.id ? 'is-active' : ''}`} onClick={() => setTab(t.id)}>
                <span className="tab__icon">{t.icon}</span> {t.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="container manage__content">
        {tab === 'overview' && <Overview championship={champ} teams={teams} matches={matches} />}
        {tab === 'teams' && <TeamsPanel championship={champ} teams={teams} onChange={reload} />}
        {tab === 'players' && <PlayersPanel championship={champ} teams={teams} players={players} onChange={reload} />}
        {tab === 'matches' && <MatchesPanel championship={champ} teams={teams} players={players} matches={matches} officials={officials} onChange={reload} />}
        {tab === 'officials' && <OfficialsPanel championship={champ} officials={officials} matches={matches} onChange={reload} />}
        {tab === 'stats' && <StatsPanel events={events} players={players} teams={teams} />}
        {tab === 'settings' && (
          <section className="panel">
            <div className="panel__head">
              <div>
                <h2>Ajustes do campeonato</h2>
                <p className="muted">Edite as informações, mude o status ou exclua o campeonato.</p>
              </div>
              <Button onClick={() => setEditing(true)}>✎ Editar informações</Button>
            </div>

            <div className="settings-block">
              <h3>Status</h3>
              <p className="muted small">Controle a fase atual da competição.</p>
              <div className="status-buttons">
                {(['draft', 'active', 'finished'] as const).map((s) => (
                  <button
                    key={s}
                    className={`status-btn ${champ.status === s ? 'is-active' : ''}`}
                    onClick={() => void changeStatus(s)}
                  >
                    {s === 'draft' ? 'Rascunho' : s === 'active' ? 'Em andamento' : 'Encerrado'}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-block danger-zone">
              <h3>Zona de perigo</h3>
              <p className="muted small">A exclusão remove times, jogadores, partidas e estatísticas.</p>
              <Button variant="danger" onClick={() => void remove()}>Excluir campeonato</Button>
            </div>
          </section>
        )}
      </div>

      {editing && <ChampionshipForm initial={champ} onClose={() => setEditing(false)} onSave={saveEdit} />}
    </div>
  )
}
