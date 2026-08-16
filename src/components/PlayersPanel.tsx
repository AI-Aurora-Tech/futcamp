import { useMemo, useRef, useState } from 'react'
import { createPlayer, deletePlayer, updatePlayer, type NewPlayer } from '../services/players'
import { checkEligibility, checkRosterLimit, formatCpf, isValidCpf } from '../lib/eligibility'
import { validateAthlete } from '../services/validation'
import { fileToDataUrl } from '../lib/image'
import { POSITIONS, type Championship, type Player, type Position, type Team } from '../types'
import { Button, EmptyState, Field, Modal, SearchField, TeamBadge } from './ui'
import { ImportAthletesModal } from './ImportAthletesModal'

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
  const [importing, setImporting] = useState(false)
  const [search, setSearch] = useState('')

  // Busca de times: filtra os "chips" de seleção do elenco.
  const visibleTeams = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return teams
    return teams.filter((t) =>
      [t.name, t.coach, t.group, t.group ? `grupo ${t.group}` : '']
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q)),
    )
  }, [teams, search])

  const teamPlayers = useMemo(
    () => players.filter((p) => p.teamId === selectedTeam).sort((a, b) => (a.number ?? 99) - (b.number ?? 99)),
    [players, selectedTeam],
  )
  const team = teams.find((t) => t.id === selectedTeam)
  const catById = new Map(championship.categories.map((c) => [c.id, c] as const))

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
          <p className="muted">Registre os atletas de cada time (nome, CPF, nascimento e categoria).</p>
        </div>
        <div className="panel__head-actions">
          <Button variant="soft" onClick={() => setImporting(true)} disabled={!selectedTeam}>📊 Importar planilha</Button>
          <Button onClick={() => setAdding(true)} disabled={!selectedTeam}>＋ Adicionar atleta</Button>
        </div>
      </div>

      <SearchField
        value={search}
        onChange={setSearch}
        placeholder="Buscar time por nome, responsável ou grupo…"
        count={visibleTeams.length}
        total={teams.length}
        noun="time"
      />

      {visibleTeams.length === 0 ? (
        <EmptyState icon="🔎" title="Nenhum time encontrado">
          <p>Nenhum time corresponde a “{search}”.</p>
          <Button variant="soft" onClick={() => setSearch('')}>Limpar busca</Button>
        </EmptyState>
      ) : (
        <div className="chip-row">
          {visibleTeams.map((t) => (
            <button
              key={t.id}
              className={`chip ${selectedTeam === t.id ? 'is-active' : ''}`}
              onClick={() => setSelectedTeam(t.id)}
              title={t.name}
            >
              <TeamBadge team={t} size={20} />
              <span className="chip__label">{t.name}</span>
              <span className="chip__count">{players.filter((p) => p.teamId === t.id).length}</span>
            </button>
          ))}
        </div>
      )}

      {teamPlayers.length === 0 ? (
        <EmptyState icon="👤" title={`Sem atletas em ${team?.name ?? 'este time'}`}>
          <p>Adicione os atletas do elenco.</p>
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="roster">
            <thead>
              <tr>
                <th className="col-num">#</th>
                <th>Atleta</th>
                <th>Nasc.</th>
                {championship.categories.length > 1 && <th>Categoria</th>}
                <th>Posição</th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {teamPlayers.map((p) => (
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
                  {championship.categories.length > 1 && <td>{catById.get(p.categoryId ?? '')?.name ?? '—'}</td>}
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
          teamPlayers={teamPlayers}
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

      {importing && (
        <ImportAthletesModal
          categories={championship.categories}
          existing={teamPlayers}
          onAdd={async (i) => {
            await createPlayer({
              championshipId: championship.id,
              teamId: selectedTeam,
              name: i.name,
              cpf: i.cpf,
              birthdate: i.birthdate,
              categoryId: i.categoryId,
              role: i.role,
            })
          }}
          onClose={() => setImporting(false)}
          onDone={onChange}
        />
      )}
    </section>
  )
}

function PlayerForm({
  championship,
  teamId,
  teamPlayers,
  initial,
  onClose,
  onSaved,
}: {
  championship: Championship
  teamId: string
  teamPlayers: Player[]
  initial?: Player
  onClose: () => void
  onSaved: () => void
}) {
  const categories = championship.categories
  const [role, setRole] = useState<'atleta' | 'comissao'>(initial?.role ?? 'atleta')
  const [name, setName] = useState(initial?.name ?? '')
  const [cpf, setCpf] = useState(initial?.cpf ? formatCpf(initial.cpf) : '')
  const [birthdate, setBirthdate] = useState(initial?.birthdate ?? '')
  const [number, setNumber] = useState<string>(initial?.number != null ? String(initial.number) : '')
  const [position, setPosition] = useState<Position>(initial?.position ?? 'ATA')
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? categories[0]?.id ?? '')
  const [photo, setPhoto] = useState<string | undefined>(initial?.photo)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const category = categories.find((c) => c.id === categoryId)

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
    if (cpf && !birthdate && !isValidCpf(cpf)) {
      setError('CPF inválido.')
      return
    }
    const existing = teamPlayers.filter((p) => p.categoryId === categoryId && p.id !== initial?.id)
    if (role === 'atleta') {
      const elig = checkEligibility({ category, birthdate: birthdate || undefined, existingInCategory: existing })
      if (!elig.ok) {
        setError(elig.reason ?? 'Atleta não elegível para esta categoria.')
        return
      }
    }
    const limit = checkRosterLimit({ category, role, existingInCategory: existing })
    if (!limit.ok) {
      setError(limit.reason ?? 'Limite da categoria atingido.')
      return
    }
    setBusy(true)
    try {
      // Validação CPF × data de nascimento quando ambos informados.
      if (cpf && birthdate) {
        const check = await validateAthlete(cpf, birthdate)
        if (!check.ok) {
          setError(check.message)
          return
        }
      }
      const payload: NewPlayer = {
        championshipId: championship.id,
        teamId,
        name: name.trim(),
        cpf: cpf.replace(/\D/g, '') || undefined,
        birthdate: birthdate || undefined,
        photo,
        number: number ? Number(number) : undefined,
        position,
        categoryId: categoryId || undefined,
        role,
      }
      if (initial) await updatePlayer(initial.id, payload)
      else await createPlayer(payload)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={initial ? 'Editar atleta' : 'Adicionar atleta'} onClose={onClose}>
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
            <button type="button" className={`segmented__item ${role === 'atleta' ? 'is-active' : ''}`} onClick={() => setRole('atleta')}>🏃 Atleta</button>
            <button type="button" className={`segmented__item ${role === 'comissao' ? 'is-active' : ''}`} onClick={() => setRole('comissao')}>📋 Comissão</button>
          </div>
        </Field>

        <Field label="Nome completo">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo do atleta" required />
        </Field>

        <div className="form-row">
          <Field label="CPF">
            <input value={cpf} onChange={(e) => setCpf(formatCpf(e.target.value))} placeholder="000.000.000-00" inputMode="numeric" />
          </Field>
          <Field label="Data de nascimento">
            <input type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} />
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

        {error && <p className="auth-error">{error}</p>}

        <div className="form-actions">
          <Button variant="ghost" type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      </form>
    </Modal>
  )
}
