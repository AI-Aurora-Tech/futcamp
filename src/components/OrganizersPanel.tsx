import { useEffect, useState } from 'react'
import { addCoOrganizer, listCoOrganizers, removeCoOrganizer } from '../services/coorganizers'
import { useAuth } from '../context/AuthContext'
import type { Championship, CoOrganizer } from '../types'
import { Button, EmptyState, Field, Modal } from './ui'

/**
 * Organizadores do campeonato. Quem organiza convida outras pessoas pelo
 * e-mail; elas entram com a própria conta e administram este mesmo campeonato.
 * Plano, pagamento e exclusão continuam com o dono.
 */
export function OrganizersPanel({ championship }: { championship: Championship }) {
  const { organizer, isMaster } = useAuth()
  const [list, setList] = useState<CoOrganizer[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)

  const isOwner = !!organizer && organizer.id === championship.ownerId
  const myMail = organizer?.email.trim().toLowerCase()

  async function reload() {
    setList(await listCoOrganizers(championship.id).catch(() => []))
    setLoading(false)
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [championship.id])

  async function remove(o: CoOrganizer) {
    const self = o.email === myMail
    const msg = self
      ? 'Sair da organização deste campeonato? Você perde o acesso a ele.'
      : `Remover ${o.name || o.email} da organização? A pessoa perde o acesso ao campeonato.`
    if (!confirm(msg)) return
    try {
      await removeCoOrganizer(o.id)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Não foi possível remover agora.')
    }
    if (self && !isOwner && !isMaster) {
      // Sem acesso, a tela do campeonato não faz mais sentido: volta ao painel.
      location.hash = '#/'
      return
    }
    void reload()
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <div>
          <h2>Organizadores ({list.length + 1})</h2>
          <p className="muted">
            Quem organiza o campeonato com você. Cada um entra com a própria conta e administra times, elencos,
            partidas e mesários.
          </p>
        </div>
        <div className="panel__head-actions">
          <Button onClick={() => setAdding(true)}>＋ Novo organizador</Button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="roster">
          <thead>
            <tr>
              <th>Organizador</th>
              <th>E-mail</th>
              <th>Papel</th>
              <th className="col-actions"></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="strong">{isOwner ? organizer?.name : 'Dono do campeonato'}</td>
              <td>{isOwner ? organizer?.email : '—'}</td>
              <td>Dono</td>
              <td className="col-actions"></td>
            </tr>
            {list.map((o) => {
              const self = o.email === myMail
              const podeRemover = isOwner || isMaster || self
              return (
                <tr key={o.id}>
                  <td className="strong">{o.name || '—'}{self ? ' (você)' : ''}</td>
                  <td>{o.email}</td>
                  <td>Organizador</td>
                  <td className="col-actions">
                    {podeRemover && (
                      <button
                        className="icon-btn icon-btn--danger"
                        title={self ? 'Sair da organização' : 'Remover'}
                        onClick={() => void remove(o)}
                      >
                        {self ? '🚪' : '🗑'}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!loading && list.length === 0 && (
        <EmptyState icon="🧑‍💼" title="Você é o único organizador">
          <p>Convide alguém pelo e-mail para ajudar a administrar este campeonato.</p>
        </EmptyState>
      )}

      <p className="hint">
        No <b>primeiro acesso</b>, a pessoa abre a tela de login principal, digita <b>só o e-mail do convite</b>,
        deixa a senha em branco e clica em Entrar: o sistema pede para ela criar a senha e já a leva ao painel,
        onde o campeonato aparece. Quem já tem conta entra com a senha de sempre. Plano, pagamento e exclusão
        do campeonato continuam com o dono.
      </p>

      {adding && (
        <InviteForm
          championshipId={championship.id}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            void reload()
          }}
        />
      )}
    </section>
  )
}

function InviteForm({
  championshipId,
  onClose,
  onSaved,
}: {
  championshipId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const res = await addCoOrganizer(championshipId, email, name)
    setBusy(false)
    if (res.ok) onSaved()
    else setError(res.error ?? 'Não foi possível convidar.')
  }

  return (
    <Modal title="Novo organizador" onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        <Field label="Nome">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (opcional)" />
        </Field>
        <Field label="E-mail" hint="A pessoa entra com este e-mail e cria a senha no primeiro acesso.">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="organizador@exemplo.com"
            autoComplete="off"
            required
          />
        </Field>
        {error && <p className="auth-error">{error}</p>}
        <div className="form-actions">
          <Button variant="ghost" type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy || !email.trim()}>
            {busy ? 'Convidando…' : 'Adicionar organizador'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
