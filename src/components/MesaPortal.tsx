import { useCallback, useEffect, useState } from 'react'
import { getChampionship } from '../services/championships'
import { listTeams } from '../services/teams'
import { listPlayers } from '../services/players'
import {
  listAssignedMatches,
  mesaLogin,
  mesaWriter,
  type MesaContext,
} from '../services/officials'
import type { Championship, Match, Player, Team } from '../types'
import { Button, ChampLogo, EmptyState, Field, Spinner, StatusPill } from './ui'
import { MatchRow } from './MatchesPanel'
import { MatchResultModal } from './MatchResultModal'

const sessKey = (champ: string) => `futcamp:mesa:${champ}`

interface Session extends MesaContext {
  name: string
}

export function MesaPortal({ championshipId, onHome }: { championshipId: string; onHome: () => void }) {
  const [champ, setChamp] = useState<Championship | null>(null)
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [editing, setEditing] = useState<Match | null>(null)

  useEffect(() => {
    getChampionship(championshipId)
      .then(setChamp)
      .finally(() => setLoading(false))
    try {
      const raw = sessionStorage.getItem(sessKey(championshipId))
      if (raw) setSession(JSON.parse(raw) as Session)
    } catch {
      /* ignore */
    }
  }, [championshipId])

  const loadData = useCallback(async () => {
    if (!session) return
    const [t, p, m] = await Promise.all([
      listTeams(championshipId),
      listPlayers(championshipId),
      listAssignedMatches(championshipId, session.officialId),
    ])
    setTeams(t)
    setPlayers(p)
    setMatches(m)
  }, [championshipId, session])

  useEffect(() => {
    void loadData()
  }, [loadData])

  function onLoggedIn(s: Session) {
    try {
      sessionStorage.setItem(sessKey(championshipId), JSON.stringify(s))
    } catch {
      /* ignore */
    }
    setSession(s)
  }

  function logout() {
    try {
      sessionStorage.removeItem(sessKey(championshipId))
    } catch {
      /* ignore */
    }
    setSession(null)
    setMatches([])
  }

  if (loading) return <div className="container pad-lg"><Spinner /></div>
  if (!champ) {
    return (
      <div className="container pad-lg center">
        <div className="empty__icon">🔒</div>
        <h2>Campeonato não encontrado</h2>
        <button className="btn btn--primary" onClick={onHome}>Ir para o início</button>
      </div>
    )
  }

  const writer = session
    ? mesaWriter({ championshipId, officialId: session.officialId, username: session.username, password: session.password })
    : null

  return (
    <div className="reg" style={{ '--accent': champ.primaryColor ?? '#16a34a' } as React.CSSProperties}>
      <header className="reg__hero">
        <div className="container">
          <div className="reg__champ">
            <span className="reg__champ-logo"><ChampLogo logo={champ.logo} /></span>
            <div>
              <p className="reg__eyebrow">Portal do mesário</p>
              <h1>{champ.name}</h1>
            </div>
            {session && (
              <button className="btn btn--ghost btn--sm mesa-logout" onClick={logout}>Sair ({session.name})</button>
            )}
          </div>
        </div>
      </header>

      <div className="container reg__content">
        {!session ? (
          <MesaLogin championshipId={championshipId} onLoggedIn={onLoggedIn} />
        ) : (
          <section className="panel reg__panel">
            <div className="panel__head">
              <div>
                <h2>Meus jogos ({matches.length})</h2>
                <p className="muted">Clique em um jogo para lançar o placar e os eventos em tempo real.</p>
              </div>
            </div>
            {matches.length === 0 ? (
              <EmptyState icon="📅" title="Nenhum jogo atribuído">
                <p>O organizador ainda não atribuiu partidas a você.</p>
              </EmptyState>
            ) : (
              <div className="mesa-matches">
                {matches.map((m) => (
                  <div key={m.id} className="mesa-match">
                    <div className="mesa-match__meta">
                      <StatusPill status={m.status} />
                      {m.scheduledAt && <span className="muted small">{new Date(m.scheduledAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}
                      {m.venue && <span className="muted small">· {m.venue}</span>}
                    </div>
                    <MatchRow match={m} teams={teams} onClick={() => setEditing(m)} />
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {editing && writer && (
        <MatchResultModal
          championship={champ}
          match={editing}
          teams={teams}
          players={players}
          writer={writer}
          readOnlySchedule
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void loadData()
          }}
        />
      )}
    </div>
  )
}

function MesaLogin({
  championshipId,
  onLoggedIn,
}: {
  championshipId: string
  onLoggedIn: (s: Session) => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const res = await mesaLogin(championshipId, username, password)
    setBusy(false)
    if (res.ok && res.official) {
      onLoggedIn({ championshipId, officialId: res.official.id, name: res.official.name, username: username.trim(), password })
    } else {
      setError(res.error ?? 'Não foi possível entrar.')
    }
  }

  return (
    <section className="panel reg__panel reg__gate">
      <h2>Entrar como mesário</h2>
      <p className="muted">Use o usuário e a senha fornecidos pelo organizador.</p>
      <form onSubmit={submit} className="form-grid reg__gate-form">
        <Field label="Usuário">
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        </Field>
        <Field label="Senha">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        {error && <p className="auth-error">{error}</p>}
        <Button type="submit" disabled={busy || !username.trim() || !password}>{busy ? 'Entrando…' : 'Entrar'}</Button>
      </form>
    </section>
  )
}
