import { useMemo, useState } from 'react'
import { updateMatch } from '../services/matches'
import { flushPush } from '../services/push'
import { flushWhatsapp } from '../services/whatsapp'
import { PHASE_LABELS, type Match, type MatchPhase, type Team, type Venue } from '../types'
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

interface Group {
  key: string
  title: string
  matches: Match[]
}

export function MatchScheduler({
  teams,
  matches,
  isKnockout,
  venues = [],
  onClose,
  onSaved,
}: {
  teams: Team[]
  matches: Match[]
  isKnockout: boolean
  venues?: Venue[]
  onClose: () => void
  onSaved: () => void
}) {
  const groups: Group[] = useMemo(() => {
    if (isKnockout) {
      const byPhase = new Map<MatchPhase, Match[]>()
      for (const m of matches) (byPhase.get(m.phase) ?? byPhase.set(m.phase, []).get(m.phase)!)!.push(m)
      const order: MatchPhase[] = ['round_of_32', 'round_of_16', 'quarter', 'semi', 'final', 'third_place']
      return order.filter((p) => byPhase.has(p)).map((p) => ({ key: p, title: PHASE_LABELS[p], matches: byPhase.get(p)! }))
    }
    const byRound = new Map<number, Match[]>()
    for (const m of matches) (byRound.get(m.round) ?? byRound.set(m.round, []).get(m.round)!)!.push(m)
    return [...byRound.keys()].sort((a, b) => a - b).map((r) => ({ key: `r${r}`, title: `Rodada ${r}`, matches: byRound.get(r)! }))
  }, [matches, isKnockout])

  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    const d: Record<string, Draft> = {}
    for (const m of matches) d[m.id] = { scheduledAt: toLocalInput(m.scheduledAt), venue: m.venue ?? '' }
    return d
  })
  // Atalho por rodada: data/hora do 1º jogo + intervalo (min) preenchem o resto.
  const [base, setBase] = useState<Record<string, string>>({})
  const [gap, setGap] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  /** Rascunho do jogo (ou o que está salvo nele, se ainda não há rascunho). */
  const draftOf = (m: Match): Draft =>
    drafts[m.id] ?? { scheduledAt: toLocalInput(m.scheduledAt), venue: m.venue ?? '' }

  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.name ?? 'A definir'

  function set(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => {
      const m = matches.find((x) => x.id === id)
      const atual = prev[id] ?? (m ? draftOf(m) : { scheduledAt: '', venue: '' })
      return { ...prev, [id]: { ...atual, ...patch } }
    })
  }

  /** Preenche a rodada em sequência a partir do 1º jogo + intervalo. */
  function fillGroup(g: Group) {
    const start = base[g.key]
    if (!start) return
    const step = Number(gap[g.key] ?? '60') || 0
    setDrafts((prev) => {
      const next = { ...prev }
      let cur = start
      g.matches.forEach((m, i) => {
        cur = i === 0 ? start : addMinutes(cur, step)
        next[m.id] = { ...(prev[m.id] ?? draftOf(m)), scheduledAt: cur }
      })
      return next
    })
  }

  async function saveAll() {
    setBusy(true)
    try {
      let mudou = false
      for (const m of matches) {
        const d = draftOf(m)
        const iso = d.scheduledAt ? new Date(d.scheduledAt).toISOString() : undefined
        const venue = d.venue.trim() || undefined
        if ((m.scheduledAt ?? undefined) === iso && (m.venue ?? undefined) === venue) continue
        await updateMatch(m.id, { scheduledAt: iso, venue })
        mudou = true
      }
      // Marcar o jogo enfileira o aviso no banco; esta chamada é o que faz
      // ele sair agora, e não só no próximo agendamento.
      if (mudou && matches[0]) {
        void flushPush(matches[0].championshipId)
        // Mesmo caminho para o WhatsApp: marcar/remarcar enfileira o aviso no
        // banco (gatilho), e esta chamada é o que faz a entrega começar agora.
        void flushWhatsapp(matches[0].championshipId)
      }
      onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="scheduler">
      <p className="hint">
        Defina a data, a hora e o local de cada jogo. Atalho: informe a data/hora do 1º jogo da
        rodada e o intervalo (min) e clique em “Preencher rodada”. O local usa os campos cadastrados
        neste campeonato.
      </p>

      {groups.map((g) => (
        <div key={g.key} className="sched-group">
          <div className="sched-group__head">
            <h4 className="scheduler__round">{g.title}</h4>
            <div className="sched-group__fill">
              <input
                type="datetime-local"
                value={base[g.key] ?? ''}
                onChange={(e) => setBase((p) => ({ ...p, [g.key]: e.target.value }))}
                title="Data e hora do 1º jogo"
                aria-label={`Data e hora do 1º jogo — ${g.title}`}
              />
              <input
                type="number"
                min={0}
                step={5}
                value={gap[g.key] ?? '60'}
                onChange={(e) => setGap((p) => ({ ...p, [g.key]: e.target.value }))}
                title="Intervalo entre os jogos (min)"
                aria-label="Intervalo entre os jogos (min)"
                className="sched-group__gap"
              />
              <Button variant="soft" type="button" onClick={() => fillGroup(g)} disabled={!base[g.key]}>
                Preencher rodada
              </Button>
            </div>
          </div>
          <div className="scheduler__list">
            {g.matches.map((m) => (
              <div key={m.id} className="sched-row">
                <span className="sched-row__match">
                  <TeamBadge team={teams.find((t) => t.id === m.homeTeamId)} size={22} />
                  <span className="sched-row__name">{teamName(m.homeTeamId)}</span>
                  <span className="muted">x</span>
                  <span className="sched-row__name">{teamName(m.awayTeamId)}</span>
                  <TeamBadge team={teams.find((t) => t.id === m.awayTeamId)} size={22} />
                </span>
                <input
                  type="datetime-local"
                  value={draftOf(m).scheduledAt}
                  onChange={(e) => set(m.id, { scheduledAt: e.target.value })}
                />
                <select
                  className="sched-row__venue"
                  value={draftOf(m).venue}
                  onChange={(e) => set(m.id, { venue: e.target.value })}
                >
                  <option value="">— local —</option>
                  {venues.map((v) => (
                    <option key={v.id} value={v.name}>{v.name}{v.address ? ` — ${v.address}` : ''}</option>
                  ))}
                  {draftOf(m).venue && !venues.some((v) => v.name === draftOf(m).venue) && (
                    <option value={draftOf(m).venue}>{draftOf(m).venue}</option>
                  )}
                </select>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="form-actions scheduler__actions">
        <Button variant="ghost" type="button" onClick={onClose}>Fechar</Button>
        <Button type="button" onClick={() => void saveAll()} disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar horários'}
        </Button>
      </div>
    </div>
  )
}
