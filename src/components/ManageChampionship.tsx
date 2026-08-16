import { useCallback, useEffect, useState } from 'react'
import {
  deleteChampionship,
  getChampionship,
  updateChampionship,
  type NewChampionship,
} from '../services/championships'
import { listTeams } from '../services/teams'
import { listPlayers } from '../services/players'
import { listEvents, listMatches, syncKnockout } from '../services/matches'
import { listOfficials } from '../services/officials'
import { useAuth } from '../context/AuthContext'
import { disablePush, enablePush, pushAvailable } from '../services/push'
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
import { Button, ChampLogo, PushToggle, Spinner, StatusPill } from './ui'
import { Overview } from './Overview'
import { ChampionTag } from './ChampionBanner'
import { computePodium } from '../lib/champion'
import { TeamsPanel } from './TeamsPanel'
import { PlayersPanel } from './PlayersPanel'
import { MatchesPanel } from './MatchesPanel'
import { StatsPanel } from './StatsPanel'
import { OfficialsPanel } from './OfficialsPanel'
import { RegistriesPanel } from './RegistriesPanel'
import { ChampionshipForm } from './ChampionshipForm'

type Tab = 'overview' | 'teams' | 'players' | 'matches' | 'officials' | 'registries' | 'stats' | 'settings'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Visão geral', icon: '📊' },
  { id: 'teams', label: 'Times', icon: '🛡️' },
  { id: 'players', label: 'Elencos', icon: '👥' },
  { id: 'matches', label: 'Partidas', icon: '📅' },
  { id: 'officials', label: 'Mesários', icon: '🧑‍⚖️' },
  { id: 'registries', label: 'Cadastros', icon: '🏟️' },
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
  const { organizer, isMaster } = useAuth()
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
    // Carrega o campeonato (crítico) e os demais dados de forma resiliente:
    // a falha de uma consulta secundária (ex.: mesários sem a migration 0006)
    // não pode "derrubar" a tela inteira nem esconder o campeonato.
    const empty = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[])
    const fetchAll = () =>
      Promise.all([
        getChampionship(championshipId).catch(() => null),
        empty(listTeams(championshipId)),
        empty(listPlayers(championshipId)),
        empty(listMatches(championshipId)),
        empty(listEvents(championshipId)),
        empty(listOfficials(championshipId)),
      ])

    let [c, t, p, m, e, o] = await fetchAll()

    // Fase de grupos encerrada? Cria o mata-mata com os classificados e leva os
    // vencedores para a fase seguinte. Só recarrega se algo mudou de fato.
    if (c) {
      const changed = await syncKnockout(c, t, m, e).catch(() => false)
      if (changed) [c, t, p, m, e, o] = await fetchAll()
    }

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
    // Trava de segurança: só o administrador master exclui campeonatos.
    if (!isMaster) {
      alert('Somente o administrador master pode excluir campeonatos.')
      return
    }
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
              <ChampionTag podium={computePodium(champ, teams, matches, events)} teams={teams} />
            </div>
            <div className="manage__actions">
              {isMaster && organizer && champ.ownerId !== organizer.id && (
                <span className="master-tag" title="Você está administrando o campeonato de outro organizador">
                  👑 modo master
                </span>
              )}
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
        {tab === 'overview' && <Overview championship={champ} teams={teams} matches={matches} players={players} events={events} />}
        {tab === 'teams' && <TeamsPanel championship={champ} teams={teams} onChange={reload} />}
        {tab === 'players' && <PlayersPanel championship={champ} teams={teams} players={players} onChange={reload} />}
        {tab === 'matches' && <MatchesPanel championship={champ} teams={teams} players={players} matches={matches} events={events} officials={officials} onChange={reload} />}
        {tab === 'officials' && <OfficialsPanel championship={champ} officials={officials} matches={matches} onChange={reload} />}
        {tab === 'registries' && <RegistriesPanel championship={champ} onChange={reload} />}
        {tab === 'stats' && <StatsPanel events={events} players={players} teams={teams} matches={matches} />}
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

            <div className="settings-block">
              <h3>Notificações</h3>
              <p className="muted small">
                Receba um aviso no celular quando um time mexer no elenco ou nos próprios dados —
                inscrição, edição e remoção de atletas. Vale para este dispositivo.
              </p>
              <PushToggle
                title="Avisos de alterações dos times"
                hint="Um aviso por time, agrupando alterações seguidas (uma importação não vira dezenas de avisos)."
                available={pushAvailable()}
                enable={() => enablePush({ championshipId, role: 'organizer' })}
                disable={() => disablePush(championshipId)}
              />
            </div>

            <div className="settings-block danger-zone">
              <h3>Zona de perigo</h3>
              {isMaster ? (
                <>
                  <p className="muted small">
                    A exclusão remove times, jogadores, partidas e estatísticas.
                    Você é o administrador master — use com cuidado.
                  </p>
                  <Button variant="danger" onClick={() => void remove()}>Excluir campeonato</Button>
                </>
              ) : (
                <>
                  <p className="muted small">
                    🔒 A exclusão de campeonatos é exclusiva do <b>administrador master</b> —
                    nem mesmo o dono do campeonato pode excluí-lo. Precisa remover esta
                    competição? Fale com o master ou marque o status como “Encerrado”.
                  </p>
                  <Button variant="danger" disabled>Excluir campeonato</Button>
                </>
              )}
            </div>
          </section>
        )}
      </div>

      {editing && <ChampionshipForm initial={champ} onClose={() => setEditing(false)} onSave={saveEdit} />}
    </div>
  )
}
