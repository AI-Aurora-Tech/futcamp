import { useCallback, useEffect, useState } from 'react'
import { getChampionship } from '../services/championships'
import { listTeams } from '../services/teams'
import { listPlayers } from '../services/players'
import { listEvents, listMatches, requestKnockoutSync } from '../services/matches'
import {
  listAssignedMatches,
  mesaLogin,
  mesaWriter,
  setOfficialPassword,
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

  /**
   * Depois que o mesário salva um jogo: se aquele era o último da primeira
   * fase, o mata-mata é criado na hora (e os vencedores avançam) — sem
   * depender do administrador abrir o campeonato.
   */
  const afterSave = useCallback(async () => {
    try {
      if (champ) {
        const [all, evs] = await Promise.all([listMatches(championshipId), listEvents(championshipId)])
        await requestKnockoutSync(champ, await listTeams(championshipId), all, evs)
      }
    } catch {
      /* sem permissão de escrita: o administrador conclui ao abrir o campeonato */
    }
    await loadData()
  }, [champ, championshipId, loadData])

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
            void afterSave()
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
  // Recuperação de senha: quando o administrador zera a senha, o mesário
  // entra com o e-mail e cria uma nova senha.
  const [resetting, setResetting] = useState(false)
  const [newPass, setNewPass] = useState('')
  const [confirm, setConfirm] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const res = await mesaLogin(championshipId, username, password)
    setBusy(false)
    if (res.ok && res.official) {
      onLoggedIn({ championshipId, officialId: res.official.id, name: res.official.name, username: username.trim(), password })
    } else if (res.needsPassword) {
      setResetting(true)
    } else {
      setError(res.error ?? 'Não foi possível entrar.')
    }
  }

  async function submitNewPassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (newPass !== confirm) {
      setError('As senhas não conferem.')
      return
    }
    setBusy(true)
    const res = await setOfficialPassword(championshipId, username, newPass)
    if (!res.ok) {
      setBusy(false)
      setError(res.error ?? 'Não foi possível redefinir a senha.')
      return
    }
    // Já entra com a senha recém-criada.
    const login = await mesaLogin(championshipId, username, newPass)
    setBusy(false)
    if (login.ok && login.official) {
      onLoggedIn({ championshipId, officialId: login.official.id, name: login.official.name, username: username.trim(), password: newPass })
    } else {
      setResetting(false)
      setPassword('')
      setError('Senha criada! Entre novamente com a nova senha.')
    }
  }

  if (resetting) {
    return (
      <section className="panel reg__panel reg__gate">
        <h2>Criar nova senha</h2>
        <p className="muted">
          O administrador zerou a senha de <b>{username.trim()}</b>. Defina uma nova senha para acessar o portal.
        </p>
        <form onSubmit={submitNewPassword} className="form-grid reg__gate-form">
          <Field label="Nova senha">
            <input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} minLength={4} autoComplete="new-password" required />
          </Field>
          <Field label="Confirmar nova senha">
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={4} autoComplete="new-password" required />
          </Field>
          {error && <p className="auth-error">{error}</p>}
          <Button type="submit" disabled={busy || !newPass || !confirm}>{busy ? 'Salvando…' : 'Criar senha e entrar'}</Button>
        </form>
        <div className="reg__gate-switch">
          <button className="link-btn" onClick={() => { setResetting(false); setError(null); setNewPass(''); setConfirm('') }}>Voltar</button>
        </div>
      </section>
    )
  }

  return (
    <section className="panel reg__panel reg__gate">
      <h2>Entrar como mesário</h2>
      <p className="muted">Use o e-mail e a senha fornecidos pelo organizador.</p>
      <form onSubmit={submit} className="form-grid reg__gate-form">
        <Field label="E-mail">
          <input type="email" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="mesa@exemplo.com" required />
        </Field>
        <Field label="Senha">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        {error && <p className="auth-error">{error}</p>}
        <Button type="submit" disabled={busy || !username.trim()}>{busy ? 'Entrando…' : 'Entrar'}</Button>
      </form>
      <p className="hint">Sua senha foi zerada pelo organizador? Informe o e-mail e clique em Entrar para criar uma nova senha.</p>
    </section>
  )
}
