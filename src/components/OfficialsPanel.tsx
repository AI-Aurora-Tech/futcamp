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
          <p className="muted">Cada mesário entra pela tela de login principal e lança os dados dos jogos atribuídos a ele.</p>
        </div>
        <div className="panel__head-actions">
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
                <th>E-mail</th>
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
        Cadastre só o <b>nome e o e-mail</b>. No <b>primeiro acesso</b>, o mesário abre a tela de login principal,
        digita <b>só o e-mail</b> e cria a senha. Se o e-mail já é de mesário em outro campeonato, ele usa a
        senha de sempre e este campeonato é adicionado. Use 🔑 para <b>zerar a senha</b>.
      </p>

      {adding && (
        <OfficialForm
          championshipId={championship.id}
          onClose={() => setAdding(false)}
          onSaved={(jaTinhaSenha) => {
            setAdding(false)
            onChange()
            alert(
              jaTinhaSenha
                ? 'Mesário adicionado. Ele já tem acesso com a senha de sempre — o campeonato aparece ao entrar.'
                : 'Mesário adicionado. No primeiro acesso, ele entra pela tela principal só com o e-mail e cria a senha.',
            )
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
  onSaved: (jaTinhaSenha: boolean) => void
}) {
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const res = await createOfficial(championshipId, name, username)
    setBusy(false)
    if (res.ok) onSaved(!!res.jaTinhaSenha)
    else setError(res.error ?? 'Não foi possível criar o mesário.')
  }

  return (
    <Modal title="Novo mesário" onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        <Field label="Nome do mesário">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome" required />
        </Field>
        <Field label="E-mail" hint="No primeiro acesso, a pessoa entra só com o e-mail e cria a senha. Se já é mesário em outro campeonato, usa a senha que já tem.">
          <input type="email" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="mesa@exemplo.com" autoComplete="off" required />
        </Field>
        {error && <p className="auth-error">{error}</p>}
        <div className="form-actions">
          <Button variant="ghost" type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy || !name.trim() || !username.trim()}>
            {busy ? 'Salvando…' : 'Adicionar mesário'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
