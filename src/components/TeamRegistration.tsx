import { useEffect, useRef, useState } from 'react'
import {
  addRegPlayer,
  loadRegistration,
  removeRegPlayer,
  saveTeamInfo,
  updateRegPlayer,
  type RegistrationData,
} from '../services/registration'
import { fileToDataUrl } from '../lib/image'
import { POSITIONS, type Player, type Position } from '../types'
import { Button, EmptyState, Field, Modal, Spinner, TeamBadge } from './ui'

const LOGO_CHOICES = ['🦁', '🦅', '🐯', '🐺', '🐉', '🦈', '🐂', '🦉', '🐆', '⚡', '🔥', '⭐', '🛡️', '⚽']

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

  const reload = async () => {
    const d = await loadRegistration(teamId, token)
    if (!d) setInvalid(true)
    else setData(d)
  }

  useEffect(() => {
    setLoading(true)
    loadRegistration(teamId, token)
      .then((d) => (d ? setData(d) : setInvalid(true)))
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false))
  }, [teamId, token])

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
            <span className="reg__champ-logo">{data.championshipLogo ?? '🏆'}</span>
            <div>
              <p className="reg__eyebrow">Inscrição de time</p>
              <h1>{data.championshipName}</h1>
            </div>
          </div>
        </div>
      </header>

      <div className="container reg__content">
        <TeamCard teamId={teamId} token={token} data={data} onSaved={reload} />
        <RosterCard teamId={teamId} token={token} players={data.players} onChanged={reload} />
        <p className="reg__foot">
          Suas alterações são salvas para o organizador do campeonato.
        </p>
      </div>
    </div>
  )
}

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
      const url = await fileToDataUrl(file, 256)
      setLogo(url)
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

function RosterCard({
  teamId,
  token,
  players,
  onChanged,
}: {
  teamId: string
  token: string
  players: Player[]
  onChanged: () => Promise<void>
}) {
  const [editing, setEditing] = useState<Player | null>(null)
  const [adding, setAdding] = useState(false)

  async function remove(p: Player) {
    if (!confirm(`Remover ${p.name} do elenco?`)) return
    await removeRegPlayer(teamId, token, p.id)
    await onChanged()
  }

  return (
    <section className="panel reg__panel">
      <div className="panel__head">
        <div>
          <h2>Elenco ({players.length})</h2>
          <p className="muted">Adicione os atletas que vão representar o time.</p>
        </div>
        <Button onClick={() => setAdding(true)}>＋ Adicionar atleta</Button>
      </div>

      {players.length === 0 ? (
        <EmptyState icon="👤" title="Nenhum atleta ainda">
          <p>Comece adicionando os jogadores do elenco.</p>
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="roster">
            <thead>
              <tr>
                <th className="col-num">#</th>
                <th>Atleta</th>
                <th>Posição</th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id}>
                  <td className="col-num">{p.number ?? '—'}</td>
                  <td className="strong">{p.name}</td>
                  <td>{POSITIONS.find((x) => x.id === p.position)?.label ?? '—'}</td>
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
        <PlayerDialog
          teamId={teamId}
          token={token}
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
    </section>
  )
}

function PlayerDialog({
  teamId,
  token,
  initial,
  onClose,
  onSaved,
}: {
  teamId: string
  token: string
  initial?: Player
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [number, setNumber] = useState(initial?.number != null ? String(initial.number) : '')
  const [position, setPosition] = useState<Position>(initial?.position ?? 'ATA')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const payload = { name: name.trim(), number: number ? Number(number) : undefined, position }
    if (initial) await updateRegPlayer(teamId, token, initial.id, payload)
    else await addRegPlayer(teamId, token, payload)
    setBusy(false)
    await onSaved()
  }

  return (
    <Modal title={initial ? 'Editar atleta' : 'Adicionar atleta'} onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        <Field label="Nome do atleta">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" required />
        </Field>
        <div className="form-row">
          <Field label="Número">
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
        <div className="form-actions">
          <Button variant="ghost" type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      </form>
    </Modal>
  )
}
