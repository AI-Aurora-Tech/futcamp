import { useState } from 'react'
import { createOfficial, deleteOfficial, resetOfficialPassword } from '../services/officials'
import type { Championship, Match, Official } from '../types'
import { Button, EmptyState, Field, Modal } from './ui'

export function OfficialsPanel({
  championship,
  officials,
  matches,
  onChange,
}: {
  championship: Championship
  officials: Official[]
  matches: Match[]
  onChange: () => void
}) {
  const [adding, setAdding] = useState(false)
  const assignedCount = (id: string) => matches.filter((m) => m.officialId === id).length

  function copyPortalLink() {
    const url = `${location.origin}/mesa/${championship.id}`
    navigator.clipboard?.writeText(url).then(
      () => alert('Link do portal do mesário copiado!\n\n' + url),
      () => prompt('Copie o link do portal do mesário:', url),
    )
  }

  async function remove(o: Official) {
    if (!confirm(`Remover o mesário "${o.name}"? Os jogos atribuídos a ele ficarão sem mesário.`)) return
    await deleteOfficial(o.id)
    onChange()
  }

  async function resetPassword(o: Official) {
    if (!confirm(`Zerar a senha de "${o.name}"?\n\nNo próximo acesso ao portal, ele entrará com o e-mail (${o.username}) e criará uma nova senha.`)) return
    try {
      await resetOfficialPassword(o.id)
      alert('Senha zerada. Avise o mesário para entrar no portal e criar uma nova senha.')
    } catch {
      alert('Não foi possível zerar a senha agora.')
    }
    onChange()
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <div>
          <h2>Mesários ({officials.length})</h2>
          <p className="muted">Cada mesário faz login no portal e lança os dados dos jogos atribuídos a ele.</p>
        </div>
        <div className="panel__head-actions">
          <Button variant="soft" onClick={copyPortalLink}>🔗 Link do portal</Button>
          <Button onClick={() => setAdding(true)}>＋ Novo mesário</Button>
        </div>
      </div>

      {officials.length === 0 ? (
        <EmptyState icon="🧑‍⚖️" title="Nenhum mesário cadastrado">
          <p>Crie um mesário e, na aba Partidas, atribua os jogos que ele poderá preencher.</p>
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="roster">
            <thead>
              <tr>
                <th>Mesário</th>
                <th>E-mail (usuário)</th>
                <th>Jogos atribuídos</th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {officials.map((o) => (
                <tr key={o.id}>
                  <td className="strong">{o.name}</td>
                  <td>{o.username}</td>
                  <td>{assignedCount(o.id)}</td>
                  <td className="col-actions">
                    <button className="icon-btn" title="Zerar senha" onClick={() => void resetPassword(o)}>🔑</button>
                    <button className="icon-btn icon-btn--danger" title="Remover" onClick={() => void remove(o)}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="hint">
        Portal do mesário: <code>/mesa/{championship.id}</code> — cada um entra com o próprio e-mail e senha.
        Use 🔑 para <b>zerar a senha</b>: o mesário criará uma nova ao entrar com o e-mail.
      </p>

      {adding && (
        <OfficialForm
          championshipId={championship.id}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            onChange()
          }}
        />
      )}
    </section>
  )
}

function OfficialForm({
  championshipId,
  onClose,
  onSaved,
}: {
  championshipId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const res = await createOfficial(championshipId, name, username, password)
    setBusy(false)
    if (res.ok) onSaved()
    else setError(res.error ?? 'Não foi possível criar o mesário.')
  }

  return (
    <Modal title="Novo mesário" onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        <Field label="Nome do mesário">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome" required />
        </Field>
        <Field label="E-mail (usuário)" hint="O mesário usa o e-mail para entrar no portal.">
          <input type="email" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="mesa@exemplo.com" autoComplete="off" required />
        </Field>
        <Field label="Senha">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={4} required />
        </Field>
        {error && <p className="auth-error">{error}</p>}
        <div className="form-actions">
          <Button variant="ghost" type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy || !name.trim() || !username.trim() || !password}>
            {busy ? 'Salvando…' : 'Criar mesário'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
