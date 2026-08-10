import { useEffect, useRef, useState } from 'react'
import {
  addRegPlayer,
  createTeamAccount,
  loadRegistration,
  removeRegPlayer,
  saveTeamInfo,
  teamLogin,
  updateRegPlayer,
  type PlayerInput,
  type RegistrationData,
} from '../services/registration'
import { fileToDataUrl } from '../lib/image'
import { formatCpf, withinAgeRule, birthYearOf } from '../lib/eligibility'
import { registrationLockForTeam } from '../lib/matchWindow'
import { validateAthlete } from '../services/validation'
import { POSITIONS, type Category, type Player, type Position } from '../types'
import { Button, ChampLogo, EmptyState, Field, Modal, Spinner, TeamBadge } from './ui'
import { ImportAthletesModal } from './ImportAthletesModal'

const LOGO_CHOICES = ['🦁', '🦅', '🐯', '🐺', '🐉', '🦈', '🐂', '🦉', '🐆', '⚡', '🔥', '⭐', '🛡️', '⚽']

const authKey = (teamId: string) => `futcamp:teamauth:${teamId}`

export function TeamRegistration({
  teamId,
  token,
  onHome,
}: {
  teamId: string
  token: string
  onHome: () => void
}) {
  const [data, setData] = useState<RegistrationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState(false)
  const [authed, setAuthed] = useState(false)

  const reload = async () => {
    const d = await loadRegistration(teamId, token)
    if (!d) setInvalid(true)
    else setData(d)
  }

  useEffect(() => {
    try {
      setAuthed(sessionStorage.getItem(authKey(teamId)) === '1')
    } catch {
      /* ignore */
    }
    setLoading(true)
    loadRegistration(teamId, token)
      .then((d) => (d ? setData(d) : setInvalid(true)))
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false))
  }, [teamId, token])

  function onAuthenticated() {
    try {
      sessionStorage.setItem(authKey(teamId), '1')
    } catch {
      /* ignore */
    }
    setAuthed(true)
    void reload()
  }

  if (loading) return <div className="container pad-lg"><Spinner /></div>
  if (invalid || !data) {
    return (
      <div className="container pad-lg center">
        <div className="empty__icon">🔒</div>
        <h2>Link inválido ou expirado</h2>
        <p className="muted">Peça ao organizador um novo link de inscrição do time.</p>
        <button className="btn btn--primary" onClick={onHome}>Ir para o início</button>
      </div>
    )
  }

  return (
    <div className="reg">
      <header className="reg__hero">
        <div className="container">
          <div className="reg__champ">
            <span className="reg__champ-logo"><ChampLogo logo={data.championshipLogo} /></span>
            <div>
              <p className="reg__eyebrow">Inscrição · {data.team.name}</p>
              <h1>{data.championshipName}</h1>
            </div>
          </div>
        </div>
      </header>

      <div className="container reg__content">
        {!authed ? (
          <AccessGate teamId={teamId} token={token} hasAccount={data.hasAccount} onDone={onAuthenticated} />
        ) : (
          <>
            <TeamCard teamId={teamId} token={token} data={data} onSaved={reload} />
            <RosterCard teamId={teamId} token={token} data={data} onChanged={reload} />
            <p className="reg__foot">Suas alterações são salvas para o organizador do campeonato.</p>
          </>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Acesso do time (criar conta / login)                                        */
/* -------------------------------------------------------------------------- */
function AccessGate({
  teamId,
  token,
  hasAccount,
  onDone,
}: {
  teamId: string
  token: string
  hasAccount: boolean
  onDone: () => void
}) {
  const [mode, setMode] = useState<'login' | 'create'>(hasAccount ? 'login' : 'create')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (mode === 'create' && password !== confirm) {
      setError('As senhas não conferem.')
      return
    }
    setBusy(true)
    const res =
      mode === 'create'
        ? await createTeamAccount(teamId, token, username, password)
        : await teamLogin(teamId, token, username, password)
    setBusy(false)
    if (res.ok) onDone()
    else setError(res.error ?? 'Não foi possível continuar.')
  }

  return (
    <section className="panel reg__panel reg__gate">
      <h2>{mode === 'create' ? 'Criar acesso do time' : 'Entrar'}</h2>
      <p className="muted">
        {mode === 'create'
          ? 'Crie um usuário e senha para o responsável pelo time inscrever os atletas.'
          : 'Entre com o usuário e senha do responsável pelo time.'}
      </p>
      <form onSubmit={submit} className="form-grid reg__gate-form">
        <Field label="Usuário">
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ex.: leoes.fc" autoComplete="username" required />
        </Field>
        <Field label="Senha">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={4} autoComplete={mode === 'create' ? 'new-password' : 'current-password'} required />
        </Field>
        {mode === 'create' && (
          <Field label="Confirmar senha">
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={4} required />
          </Field>
        )}
        {error && <p className="auth-error">{error}</p>}
        <Button type="submit" disabled={busy || !username.trim() || !password}>
          {busy ? 'Aguarde…' : mode === 'create' ? 'Criar acesso e entrar' : 'Entrar'}
        </Button>
      </form>
      <div className="reg__gate-switch">
        {mode === 'create' ? (
          <button className="link-btn" onClick={() => { setMode('login'); setError(null) }}>Já tenho acesso — entrar</button>
        ) : (
          <button className="link-btn" onClick={() => { setMode('create'); setError(null) }}>Ainda não criei — criar acesso</button>
        )}
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Escudo e dados do time                                                      */
/* -------------------------------------------------------------------------- */
function TeamCard({
  teamId,
  token,
  data,
  onSaved,
}: {
  teamId: string
  token: string
  data: RegistrationData
  onSaved: () => Promise<void>
}) {
  const t = data.team
  const [name, setName] = useState(t.name)
  const [shortName, setShortName] = useState(t.shortName ?? '')
  const [coach, setCoach] = useState(t.coach ?? '')
  const [color, setColor] = useState(t.color ?? '#2563eb')
  const [logo, setLogo] = useState(t.logo ?? '🛡️')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setLogo(await fileToDataUrl(file, 256))
    } catch {
      setMsg('Não foi possível carregar a imagem.')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      await saveTeamInfo(teamId, token, { name: name.trim(), shortName: shortName.trim(), coach: coach.trim(), color, logo })
      await onSaved()
      setMsg('Dados do time salvos! ✅')
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Erro ao salvar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel reg__panel">
      <h2>Escudo e dados do time</h2>
      <form onSubmit={save} className="reg__team">
        <div className="reg__badge">
          <TeamBadge team={{ name, shortName, logo, color }} size={96} />
          <div className="reg__logo-actions">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onUpload} />
            <Button variant="soft" type="button" onClick={() => fileRef.current?.click()}>⬆ Enviar imagem</Button>
            {logo?.startsWith('data:') && (
              <button type="button" className="link-btn" onClick={() => setLogo('🛡️')}>remover imagem</button>
            )}
          </div>
          <div className="emoji-picker reg__emoji">
            {LOGO_CHOICES.map((e) => (
              <button type="button" key={e} className={`emoji-picker__item ${logo === e ? 'is-active' : ''}`} onClick={() => setLogo(e)}>
                {e}
              </button>
            ))}
          </div>
        </div>

        <div className="reg__fields">
          <div className="form-row">
            <Field label="Nome do time">
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Sigla" hint="3 letras (ex.: LEO)">
              <input value={shortName} onChange={(e) => setShortName(e.target.value)} maxLength={4} placeholder="LEO" />
            </Field>
          </div>
          <div className="form-row">
            <Field label="Técnico (opcional)">
              <input value={coach} onChange={(e) => setCoach(e.target.value)} placeholder="Nome do técnico" />
            </Field>
            <Field label="Cor">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="color-input" />
            </Field>
          </div>
          <div className="reg__save">
            {msg && <span className="reg__msg">{msg}</span>}
            <Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Salvando…' : 'Salvar dados do time'}</Button>
          </div>
        </div>
      </form>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Elenco / atletas                                                            */
/* -------------------------------------------------------------------------- */
function RosterCard({
  teamId,
  token,
  data,
  onChanged,
}: {
  teamId: string
  token: string
  data: RegistrationData
  onChanged: () => Promise<void>
}) {
  const [editing, setEditing] = useState<Player | null>(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const catById = new Map(data.categories.map((c) => [c.id, c] as const))
  const lock = registrationLockForTeam(data.team.id, data.matches, data.registrationCutoffHours)
  const athletes = data.players.filter((p) => (p.role ?? 'atleta') === 'atleta').length
  const staff = data.players.filter((p) => p.role === 'comissao').length

  async function remove(p: Player) {
    if (!confirm(`Remover ${p.name} do elenco?`)) return
    await removeRegPlayer(teamId, token, p.id)
    await onChanged()
  }

  return (
    <section className="panel reg__panel">
      <div className="panel__head">
        <div>
          <h2>Elenco — {athletes} atleta(s), {staff} comissão</h2>
          <p className="muted">Inscreva os atletas com nome completo, CPF e data de nascimento.</p>
        </div>
        <div className="panel__head-actions">
          <Button variant="soft" onClick={() => setImporting(true)} disabled={lock.locked}>📄 Importar TXT</Button>
          <Button onClick={() => setAdding(true)} disabled={lock.locked}>＋ Inscrever atleta</Button>
        </div>
      </div>

      {lock.locked && (
        <div className="lock-banner">
          🔒 Inscrições <b>encerradas</b> para a próxima partida
          {lock.matchAt ? ` (${new Date(lock.matchAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})` : ''}.
          Reabrem automaticamente após o jogo ser finalizado.
        </div>
      )}

      {data.players.length === 0 ? (
        <EmptyState icon="👤" title="Nenhum atleta inscrito">
          <p>Comece inscrevendo os atletas do elenco.</p>
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="roster">
            <thead>
              <tr>
                <th className="col-num">#</th>
                <th>Atleta</th>
                <th>Nasc.</th>
                {data.categories.length > 1 && <th>Categoria</th>}
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {data.players.map((p) => (
                <tr key={p.id}>
                  <td className="col-num">{p.number ?? '—'}</td>
                  <td>
                    <span className="athlete-cell">
                      <span className="athlete-photo">{p.photo ? <img src={p.photo} alt="" /> : '👤'}</span>
                      <span>
                        <span className="strong">{p.name}</span>
                        {p.cpf && <span className="athlete-cpf">{formatCpf(p.cpf)}</span>}
                      </span>
                    </span>
                  </td>
                  <td>{p.birthdate ? p.birthdate.split('-').reverse().join('/') : '—'}</td>
                  {data.categories.length > 1 && <td>{catById.get(p.categoryId ?? '')?.name ?? '—'}</td>}
                  <td className="col-actions">
                    <button className="icon-btn" title="Editar" onClick={() => setEditing(p)}>✎</button>
                    <button className="icon-btn icon-btn--danger" title="Remover" onClick={() => void remove(p)}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(adding || editing) && (
        <AthleteDialog
          teamId={teamId}
          token={token}
          categories={data.categories}
          initial={editing ?? undefined}
          onClose={() => {
            setAdding(false)
            setEditing(null)
          }}
          onSaved={async () => {
            setAdding(false)
            setEditing(null)
            await onChanged()
          }}
        />
      )}

      {importing && (
        <ImportAthletesModal
          categories={data.categories}
          existing={data.players}
          onAdd={async (i) => {
            await addRegPlayer(teamId, token, {
              name: i.name,
              cpf: i.cpf,
              birthdate: i.birthdate,
              categoryId: i.categoryId,
              role: i.role,
            })
          }}
          onClose={() => setImporting(false)}
          onDone={onChanged}
        />
      )}
    </section>
  )
}

export function AthleteDialog({
  teamId,
  token,
  categories,
  initial,
  onClose,
  onSaved,
}: {
  teamId: string
  token: string
  categories: Category[]
  initial?: Player
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [role, setRole] = useState<'atleta' | 'comissao'>(initial?.role ?? 'atleta')
  const [name, setName] = useState(initial?.name ?? '')
  const [cpf, setCpf] = useState(initial?.cpf ? formatCpf(initial.cpf) : '')
  const [birthdate, setBirthdate] = useState(initial?.birthdate ?? '')
  const [number, setNumber] = useState(initial?.number != null ? String(initial.number) : '')
  const [position, setPosition] = useState<Position>(initial?.position ?? 'ATA')
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? categories[0]?.id ?? '')
  const [photo, setPhoto] = useState<string | undefined>(initial?.photo)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const isAthlete = role === 'atleta'

  const category = categories.find((c) => c.id === categoryId)
  const ruleHint = category?.birthYear
    ? category.birthYearMode === 'min'
      ? `Aceita nascidos em ${category.birthYear} ou depois.`
      : `Aceita nascidos em ${category.birthYear} ou antes${category.exceptions ? ` (até ${category.exceptions} exceção(ões) por time)` : ''}.`
    : null
  const outOfRule = Boolean(category?.birthYear && birthdate && !withinAgeRule(category, birthYearOf(birthdate)))

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setPhoto(await fileToDataUrl(file, 320))
    } catch {
      setError('Não foi possível carregar a foto.')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      // Validação de CPF × data de nascimento (API + fallback local).
      if (isAthlete || (cpf && birthdate)) {
        const check = await validateAthlete(cpf, birthdate)
        if (!check.ok) {
          setError(check.message)
          return
        }
      }
      const payload: PlayerInput = {
        name: name.trim(),
        cpf: cpf.replace(/\D/g, '') || undefined,
        birthdate: birthdate || undefined,
        photo,
        number: number ? Number(number) : undefined,
        position,
        categoryId: categoryId || undefined,
        role,
      }
      if (initial) await updateRegPlayer(teamId, token, initial.id, payload)
      else await addRegPlayer(teamId, token, payload)
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível inscrever o atleta.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={initial ? 'Editar atleta' : 'Inscrever atleta'} onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        <div className="athlete-photo-field">
          <span className="athlete-photo athlete-photo--lg">{photo ? <img src={photo} alt="" /> : '👤'}</span>
          <div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPhoto} />
            <Button variant="soft" type="button" onClick={() => fileRef.current?.click()}>📷 Foto (opcional)</Button>
            {photo && <button type="button" className="link-btn" onClick={() => setPhoto(undefined)}>remover foto</button>}
          </div>
        </div>

        <Field label="Tipo de inscrição">
          <div className="segmented">
            <button type="button" className={`segmented__item ${isAthlete ? 'is-active' : ''}`} onClick={() => setRole('atleta')}>🏃 Atleta</button>
            <button type="button" className={`segmented__item ${!isAthlete ? 'is-active' : ''}`} onClick={() => setRole('comissao')}>📋 Comissão técnica</button>
          </div>
        </Field>

        <Field label="Nome completo">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" required />
        </Field>

        <div className="form-row">
          <Field label={isAthlete ? 'CPF' : 'CPF (opcional)'}>
            <input value={cpf} onChange={(e) => setCpf(formatCpf(e.target.value))} placeholder="000.000.000-00" inputMode="numeric" required={isAthlete} />
          </Field>
          <Field label={isAthlete ? 'Data de nascimento' : 'Data de nascimento (opcional)'}>
            <input type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} required={isAthlete} />
          </Field>
        </div>

        {categories.length > 1 && (
          <Field label="Categoria">
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
        )}
        {isAthlete && ruleHint && (
          <p className={`rule-hint ${outOfRule ? 'rule-hint--warn' : ''}`}>
            {outOfRule ? '⚠️ Fora da faixa: ' : 'ℹ️ '}
            {ruleHint}
          </p>
        )}

        <div className="form-row">
          <Field label="Número (opcional)">
            <input type="number" min={1} max={99} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="10" />
          </Field>
          <Field label="Posição">
            <select value={position} onChange={(e) => setPosition(e.target.value as Position)}>
              {POSITIONS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </Field>
        </div>

        {error && <p className="auth-error">{error}</p>}

        <div className="form-actions">
          <Button variant="ghost" type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Validando…' : 'Salvar'}</Button>
        </div>
      </form>
    </Modal>
  )
}
