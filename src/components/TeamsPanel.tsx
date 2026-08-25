import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createTeam,
  deleteTeam,
  ensureChampTeamToken,
  ensureTeamToken,
  listTeamManagers,
  resetTeamManagerPassword,
  updateTeam,
  type NewTeam,
  type TeamManager,
} from '../services/teams'
import type { Championship, Team } from '../types'
import { fileToDataUrl } from '../lib/image'
import { Button, EmptyState, Field, Modal, SearchField, Spinner, TeamBadge } from './ui'

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
  const [managing, setManaging] = useState<Team | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [search, setSearch] = useState('')
  const grouped = championship.format === 'groups_knockout'
  const numGroups = Math.max(1, championship.numGroups ?? 2)

  // Busca por nome do time, responsável ou grupo ("grupo b" / "b").
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return teams
    return teams.filter((t) =>
      [t.name, t.coach, t.phone, t.group, t.group ? `grupo ${t.group}` : '']
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q)),
    )
  }, [teams, search])

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

  async function copyCreateTeamLink() {
    try {
      const token = await ensureChampTeamToken(championship.id)
      const url = `${location.origin}${location.pathname}#/novo-time/${championship.id}?k=${token}`
      await navigator.clipboard?.writeText(url).catch(() => {})
      window.prompt(
        'Link para CRIAÇÃO de time\n\nEnvie ao responsável — ele cria o próprio time, define o escudo, os gestores e inscreve os atletas:',
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
          <Button variant="soft" onClick={() => void copyCreateTeamLink()}>🔗 Link para criar time</Button>
          <Button onClick={() => setAdding(true)}>＋ Adicionar time</Button>
        </div>
      </div>

      {teams.length > 0 && (
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Buscar time por nome, responsável ou grupo…"
          count={visible.length}
          total={teams.length}
          noun="time"
        />
      )}

      {teams.length === 0 ? (
        <EmptyState icon="🛡️" title="Nenhum time cadastrado">
          <p>Adicione os times para depois gerar a tabela de jogos.</p>
        </EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState icon="🔎" title="Nenhum time encontrado">
          <p>Nenhum time corresponde a “{search}”.</p>
          <Button variant="soft" onClick={() => setSearch('')}>Limpar busca</Button>
        </EmptyState>
      ) : (
        <div className="team-grid">
          {visible.map((t) => (
            <div key={t.id} className="team-item">
              <span className="team-item__badge"><TeamBadge team={t} size={44} /></span>
              <div className="team-item__info">
                <strong title={t.name}>{t.name}</strong>
                <span className="team-item__meta">
                  {t.coach ? `Resp. ${t.coach}` : 'Sem responsável'}
                  {t.phone ? ` · ${t.phone}` : ''}
                </span>
                {grouped && t.group && <span className="team-item__group">Grupo {t.group}</span>}
              </div>
              <div className="team-item__actions">
                <button className="icon-btn" title="Copiar link de inscrição" onClick={() => void copyInviteLink(t)}>🔗</button>
                <button className="icon-btn" title="Gestores e senhas" onClick={() => setManaging(t)}>🔑</button>
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

      {managing && (
        <ManagersModal team={managing} onClose={() => setManaging(null)} />
      )}
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Gestores do time (senhas) — visão do administrador                          */
/* -------------------------------------------------------------------------- */
function ManagersModal({ team, onClose }: { team: Team; onClose: () => void }) {
  const [managers, setManagers] = useState<TeamManager[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      setManagers(await listTeamManagers(team.id))
    } catch {
      setError('Não foi possível carregar os gestores.')
      setManagers([])
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team.id])

  async function reset(m: TeamManager) {
    if (!confirm(`Zerar a senha de "${m.username}"?\n\nEle perde o acesso pela página inicial e criará uma nova senha no próximo acesso pelo link de inscrição.`)) return
    setBusy(m.username)
    setError(null)
    try {
      await resetTeamManagerPassword(team.id, m.username)
      await load()
    } catch {
      setError('Não foi possível zerar a senha agora.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal title={`Gestores — ${team.name}`} onClose={onClose}>
      <p className="muted">
        Zere a senha de um gestor que a esqueceu. Ele entrará pelo <b>link de inscrição</b> com o
        mesmo e-mail e criará uma nova senha — a redefinição não passa pela página inicial, para
        que ninguém entre no time só sabendo o endereço de e-mail do gestor.
      </p>
      {managers === null ? (
        <div className="pad-lg center"><Spinner /></div>
      ) : managers.length === 0 ? (
        <EmptyState icon="👤" title="Nenhum gestor cadastrado">
          <p>Este time ainda não tem acesso criado. Envie o link de inscrição para o responsável criar a conta com o e-mail dele.</p>
        </EmptyState>
      ) : (
        <ul className="manager-list">
          {managers.map((m) => (
            <li key={m.username} className="manager-list__item" style={{ justifyContent: 'space-between' }}>
              <span>👤 {m.username} {m.reset && <span className="muted small">· senha zerada</span>}</span>
              <Button variant="soft" type="button" disabled={busy === m.username || m.reset} onClick={() => void reset(m)}>
                {busy === m.username ? 'Zerando…' : m.reset ? 'Aguardando nova senha' : '🔑 Zerar senha'}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="auth-error">{error}</p>}
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onClose}>Fechar</Button>
      </div>
    </Modal>
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
  const [logo, setLogo] = useState(initial?.logo ?? '')
  const [color, setColor] = useState(initial?.color ?? '#2563eb')
  const [coach, setCoach] = useState(initial?.coach ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
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
      logo,
      color,
      coach: coach.trim() || undefined,
      phone: phone.trim() || undefined,
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
          <TeamBadge team={{ name, logo, color }} size={56} />
          <span>{name || 'Prévia do escudo'}</span>
        </div>
        <Field label="Nome do time">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Leões FC" required />
        </Field>
        <Field label="Escudo do time" hint="Envie a imagem do brasão (PNG/JPG/SVG). Sem imagem, usamos as iniciais do nome e a cor.">
          <div className="team-logo-actions">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onLogoUpload} />
            <Button variant="soft" type="button" onClick={() => fileRef.current?.click()}>⬆ Enviar escudo</Button>
            {logo?.startsWith('data:') && (
              <button type="button" className="link-btn" onClick={() => setLogo('')}>remover imagem</button>
            )}
          </div>
          {logoError && <p className="hint" style={{ color: 'var(--danger)' }}>{logoError}</p>}
        </Field>
        <div className="form-row">
          <Field label="Responsável">
            <input value={coach} onChange={(e) => setCoach(e.target.value)} placeholder="Nome do responsável" />
          </Field>
          <Field label="Telefone">
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 00000-0000" />
          </Field>
        </div>
        <Field label="Cor">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="color-input" />
        </Field>
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
