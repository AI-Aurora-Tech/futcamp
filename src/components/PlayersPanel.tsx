import { useMemo, useState } from 'react'
import { createPlayer, deletePlayer, updatePlayer, type NewPlayer } from '../services/players'
import { POSITIONS, type Championship, type Player, type Position, type Team } from '../types'
import { Button, EmptyState, Field, Modal, TeamBadge } from './ui'

export function PlayersPanel({
  championship,
  teams,
  players,
  onChange,
}: {
  championship: Championship
  teams: Team[]
  players: Player[]
  onChange: () => void
}) {
  const [selectedTeam, setSelectedTeam] = useState<string>(teams[0]?.id ?? '')
  const [editing, setEditing] = useState<Player | null>(null)
  const [adding, setAdding] = useState(false)

  const teamPlayers = useMemo(
    () => players.filter((p) => p.teamId === selectedTeam).sort((a, b) => (a.number ?? 99) - (b.number ?? 99)),
    [players, selectedTeam],
  )
  const team = teams.find((t) => t.id === selectedTeam)

  async function remove(p: Player) {
    if (!confirm(`Remover ${p.name} do elenco?`)) return
    await deletePlayer(p.id)
    onChange()
  }

  if (teams.length === 0) {
    return (
      <section className="panel">
        <EmptyState icon="👥" title="Cadastre times primeiro">
          <p>Você precisa de ao menos um time para adicionar jogadores.</p>
        </EmptyState>
      </section>
    )
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <div>
          <h2>Elencos</h2>
          <p className="muted">Registre os jogadores de cada time.</p>
        </div>
        <Button onClick={() => setAdding(true)} disabled={!selectedTeam}>＋ Adicionar jogador</Button>
      </div>

      <div className="chip-row">
        {teams.map((t) => (
          <button
            key={t.id}
            className={`chip ${selectedTeam === t.id ? 'is-active' : ''}`}
            onClick={() => setSelectedTeam(t.id)}
          >
            <TeamBadge team={t} size={20} /> {t.shortName || t.name}
          </button>
        ))}
      </div>

      {teamPlayers.length === 0 ? (
        <EmptyState icon="👤" title={`Sem jogadores em ${team?.name ?? 'este time'}`}>
          <p>Adicione os atletas do elenco.</p>
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="roster">
            <thead>
              <tr>
                <th className="col-num">#</th>
                <th>Jogador</th>
                <th>Posição</th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {teamPlayers.map((p) => (
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
        <PlayerForm
          championship={championship}
          teamId={selectedTeam}
          initial={editing ?? undefined}
          onClose={() => {
            setAdding(false)
            setEditing(null)
          }}
          onSaved={() => {
            setAdding(false)
            setEditing(null)
            onChange()
          }}
        />
      )}
    </section>
  )
}

function PlayerForm({
  championship,
  teamId,
  initial,
  onClose,
  onSaved,
}: {
  championship: Championship
  teamId: string
  initial?: Player
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [number, setNumber] = useState<string>(initial?.number != null ? String(initial.number) : '')
  const [position, setPosition] = useState<Position>(initial?.position ?? 'ATA')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const payload: NewPlayer = {
      championshipId: championship.id,
      teamId,
      name: name.trim(),
      number: number ? Number(number) : undefined,
      position,
    }
    if (initial) await updatePlayer(initial.id, payload)
    else await createPlayer(payload)
    setBusy(false)
    onSaved()
  }

  return (
    <Modal title={initial ? 'Editar jogador' : 'Adicionar jogador'} onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        <Field label="Nome do jogador">
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
