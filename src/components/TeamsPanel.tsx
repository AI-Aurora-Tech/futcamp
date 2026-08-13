import { useRef, useState } from 'react'
import { createTeam, deleteTeam, ensureTeamToken, updateTeam, type NewTeam } from '../services/teams'
import type { Championship, Team } from '../types'
import { fileToDataUrl } from '../lib/image'
import { Button, EmptyState, Field, Modal, TeamBadge } from './ui'

const LOGO_CHOICES = ['🦁', '🦅', '🐯', '🐺', '🐉', '🦈', '🐂', '🦉', '🐆', '⚡', '🔥', '⭐', '🛡️', '⚽']

export function TeamsPanel({
  championship,
  teams,
  onChange,
}: {
  championship: Championship
  teams: Team[]
  onChange: () => void
}) {
  const [editing, setEditing] = useState<Team | null>(null)
  const [adding, setAdding] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const grouped = championship.format === 'groups_knockout'
  const numGroups = Math.max(1, championship.numGroups ?? 2)

  async function drawGroups() {
    if (teams.length < 2) {
      alert('Cadastre ao menos 2 times para sortear os grupos.')
      return
    }
    if (!confirm(`Sortear ${teams.length} time(s) em ${numGroups} grupo(s)? Isso substitui a divisão atual.`)) return
    setDrawing(true)
    try {
      const labels = Array.from({ length: numGroups }, (_, i) => String.fromCharCode(65 + i))
      // Embaralhamento Fisher–Yates.
      const shuffled = [...teams]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }
      // Distribui em rodízio (serpentina) para equilibrar os grupos.
      await Promise.all(
        shuffled.map((t, idx) => updateTeam(t.id, { group: labels[idx % numGroups] })),
      )
      onChange()
    } catch {
      alert('Não foi possível sortear os grupos agora.')
    } finally {
      setDrawing(false)
    }
  }

  async function remove(team: Team) {
    if (!confirm(`Remover o time "${team.name}"? Os jogadores e resultados vinculados também serão afetados.`)) return
    await deleteTeam(team.id)
    onChange()
  }

  async function copyInviteLink(team: Team) {
    try {
      const token = await ensureTeamToken(team.id)
      const url = `${location.origin}${location.pathname}#/t/${team.id}?k=${token}`
      await navigator.clipboard?.writeText(url).catch(() => {})
      window.prompt(
        `Link de inscrição de ${team.name}\n\nEnvie ao representante do time — ele poderá incluir o escudo e os atletas:`,
        url,
      )
    } catch {
      alert('Não foi possível gerar o link agora.')
    }
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <div>
          <h2>Times ({teams.length})</h2>
          <p className="muted">Cadastre os clubes participantes do campeonato.</p>
        </div>
        <div className="panel__head-actions">
          {grouped && (
            <Button variant="ghost" onClick={() => void drawGroups()} disabled={drawing}>
              {drawing ? 'Sorteando…' : '🎲 Sortear grupos'}
            </Button>
          )}
          <Button onClick={() => setAdding(true)}>＋ Adicionar time</Button>
        </div>
      </div>

      {teams.length === 0 ? (
        <EmptyState icon="🛡️" title="Nenhum time cadastrado">
          <p>Adicione os times para depois gerar a tabela de jogos.</p>
        </EmptyState>
      ) : (
        <div className="team-grid">
          {teams.map((t) => (
            <div key={t.id} className="team-item">
              <TeamBadge team={t} size={44} />
              <div className="team-item__info">
                <strong>{t.name}</strong>
                <span className="muted">
                  {t.coach ? `Téc. ${t.coach}` : 'Sem técnico'}
                  {grouped && t.group ? ` · Grupo ${t.group}` : ''}
                </span>
              </div>
              <div className="team-item__actions">
                <button className="icon-btn" title="Copiar link de inscrição" onClick={() => void copyInviteLink(t)}>🔗</button>
                <button className="icon-btn" title="Editar" onClick={() => setEditing(t)}>✎</button>
                <button className="icon-btn icon-btn--danger" title="Remover" onClick={() => void remove(t)}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(adding || editing) && (
        <TeamForm
          championship={championship}
          teams={teams}
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

function TeamForm({
  championship,
  teams,
  initial,
  onClose,
  onSaved,
}: {
  championship: Championship
  teams: Team[]
  initial?: Team
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [shortName, setShortName] = useState(initial?.shortName ?? '')
  const [logo, setLogo] = useState(initial?.logo ?? '🛡️')
  const [color, setColor] = useState(initial?.color ?? '#2563eb')
  const [coach, setCoach] = useState(initial?.coach ?? '')
  const [group, setGroup] = useState(initial?.group ?? 'A')
  const [busy, setBusy] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const grouped = championship.format === 'groups_knockout'
  const target = championship.teamsPerGroup
  const groupOptions = Array.from({ length: championship.numGroups ?? 2 }, (_, i) =>
    String.fromCharCode(65 + i),
  )
  const countIn = (g: string) => teams.filter((t) => t.group === g && t.id !== initial?.id).length

  async function onLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setLogo(await fileToDataUrl(file, 256))
      setLogoError(null)
    } catch {
      setLogoError('Não foi possível carregar a imagem.')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    // Aviso (não bloqueia) se o grupo atingiu a meta de times.
    if (grouped && target && countIn(group) >= target) {
      const okGo = confirm(`O Grupo ${group} já tem ${countIn(group)} time(s) (meta: ${target}). Adicionar mesmo assim?`)
      if (!okGo) return
    }
    setBusy(true)
    const payload: NewTeam = {
      championshipId: championship.id,
      name: name.trim(),
      shortName: shortName.trim() || undefined,
      logo,
      color,
      coach: coach.trim() || undefined,
      group: grouped ? group : undefined,
    }
    if (initial) await updateTeam(initial.id, payload)
    else await createTeam(payload)
    setBusy(false)
    onSaved()
  }

  return (
    <Modal title={initial ? 'Editar time' : 'Adicionar time'} onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        <div className="team-form__preview">
          <TeamBadge team={{ name, shortName, logo, color }} size={56} />
          <span>{name || 'Prévia do escudo'}</span>
        </div>
        <div className="form-row">
          <Field label="Nome do time">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Leões FC" required />
          </Field>
          <Field label="Sigla" hint="3 letras (ex.: LEO)">
            <input value={shortName} onChange={(e) => setShortName(e.target.value)} maxLength={4} placeholder="LEO" />
          </Field>
        </div>
        <Field label="Escudo do time" hint="Envie a imagem do brasão (PNG/JPG/SVG) ou escolha um emoji.">
          <div className="team-logo-actions">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onLogoUpload} />
            <Button variant="soft" type="button" onClick={() => fileRef.current?.click()}>⬆ Enviar imagem</Button>
            {logo?.startsWith('data:') && (
              <button type="button" className="link-btn" onClick={() => setLogo('🛡️')}>remover imagem</button>
            )}
          </div>
          <div className="emoji-picker">
            {LOGO_CHOICES.map((e) => (
              <button type="button" key={e} className={`emoji-picker__item ${logo === e ? 'is-active' : ''}`} onClick={() => setLogo(e)}>
                {e}
              </button>
            ))}
          </div>
          {logoError && <p className="hint" style={{ color: 'var(--danger)' }}>{logoError}</p>}
        </Field>
        <div className="form-row">
          <Field label="Cor">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="color-input" />
          </Field>
          <Field label="Técnico (opcional)">
            <input value={coach} onChange={(e) => setCoach(e.target.value)} placeholder="Nome do técnico" />
          </Field>
        </div>
        {grouped && (
          <Field label="Grupo" hint={target ? `Meta: ${target} time(s) por grupo` : undefined}>
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              {groupOptions.map((g) => (
                <option key={g} value={g}>
                  Grupo {g}{target ? ` (${countIn(g)}/${target})` : ` (${countIn(g)})`}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="form-actions">
          <Button variant="ghost" type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      </form>
    </Modal>
  )
}
