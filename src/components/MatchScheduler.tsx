import { useMemo, useState } from 'react'
import { updateMatch } from '../services/matches'
import { PHASE_LABELS, type Match, type Team } from '../types'
import { Button, TeamBadge } from './ui'

interface Draft {
  scheduledAt: string // valor do input datetime-local (local)
  venue: string
}

/** ISO → valor para <input type="datetime-local"> (horário local). */
function toLocalInput(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function addMinutes(local: string, minutes: number): string {
  const d = new Date(local)
  if (Number.isNaN(d.getTime())) return local
  d.setMinutes(d.getMinutes() + minutes)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function MatchScheduler({
  teams,
  matches,
  isKnockout,
  onClose,
  onSaved,
}: {
  teams: Team[]
  matches: Match[]
  isKnockout: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const ordered = useMemo(
    () =>
      [...matches].sort(
        (a, b) => a.round - b.round || a.createdAt.localeCompare(b.createdAt),
      ),
    [matches],
  )

  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    const d: Record<string, Draft> = {}
    for (const m of ordered) d[m.id] = { scheduledAt: toLocalInput(m.scheduledAt), venue: m.venue ?? '' }
    return d
  })
  const [base, setBase] = useState('')
  const [interval, setInterval] = useState('60')
  const [busy, setBusy] = useState(false)

  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.name ?? 'A definir'

  function set(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  /** Preenche as datas em sequência a partir do 1º jogo + intervalo. */
  function fillSequence() {
    if (!base) return
    const step = Number(interval) || 0
    setDrafts((prev) => {
      const next = { ...prev }
      let cur = base
      ordered.forEach((m, i) => {
        next[m.id] = { ...next[m.id], scheduledAt: i === 0 ? base : (cur = addMinutes(cur, step)) }
      })
      return next
    })
  }

  async function saveAll() {
    setBusy(true)
    try {
      for (const m of ordered) {
        const d = drafts[m.id]
        const iso = d.scheduledAt ? new Date(d.scheduledAt).toISOString() : undefined
        const venue = d.venue.trim() || undefined
        const sameDate = (m.scheduledAt ?? undefined) === iso
        const sameVenue = (m.venue ?? undefined) === venue
        if (sameDate && sameVenue) continue
        await updateMatch(m.id, { scheduledAt: iso, venue })
      }
      onSaved()
    } finally {
      setBusy(false)
    }
  }

  let lastLabel = ''

  return (
    <div className="scheduler">
      <div className="scheduler__bulk">
        <div className="scheduler__bulk-fields">
          <label className="field">
            <span className="field__label">1º jogo (data e hora)</span>
            <input type="datetime-local" value={base} onChange={(e) => setBase(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Intervalo entre jogos (min)</span>
            <input type="number" min={0} step={15} value={interval} onChange={(e) => setInterval(e.target.value)} />
          </label>
          <Button variant="soft" type="button" onClick={fillSequence} disabled={!base}>Preencher em sequência</Button>
        </div>
        <p className="hint">Dica: defina o 1º jogo e o intervalo para preencher todos automaticamente — depois ajuste o que precisar.</p>
      </div>

      <div className="scheduler__list">
        {ordered.map((m) => {
          const label = isKnockout ? PHASE_LABELS[m.phase] : `Rodada ${m.round}`
          const showLabel = label !== lastLabel
          lastLabel = label
          return (
            <div key={m.id}>
              {showLabel && <h4 className="scheduler__round">{label}</h4>}
              <div className="sched-row">
                <span className="sched-row__match">
                  <TeamBadge team={teams.find((t) => t.id === m.homeTeamId)} size={22} />
                  <span className="sched-row__name">{teamName(m.homeTeamId)}</span>
                  <span className="muted">x</span>
                  <span className="sched-row__name">{teamName(m.awayTeamId)}</span>
                  <TeamBadge team={teams.find((t) => t.id === m.awayTeamId)} size={22} />
                </span>
                <input
                  type="datetime-local"
                  value={drafts[m.id]?.scheduledAt ?? ''}
                  onChange={(e) => set(m.id, { scheduledAt: e.target.value })}
                />
                <input
                  className="sched-row__venue"
                  value={drafts[m.id]?.venue ?? ''}
                  onChange={(e) => set(m.id, { venue: e.target.value })}
                  placeholder="Local"
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="form-actions scheduler__actions">
        <Button variant="ghost" type="button" onClick={onClose}>Fechar</Button>
        <Button type="button" onClick={() => void saveAll()} disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar horários'}
        </Button>
      </div>
    </div>
  )
}
