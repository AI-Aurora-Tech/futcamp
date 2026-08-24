import { useMemo } from 'react'
import type { Championship, Match, Team } from '../types'
import { EmptyState, TeamBadge } from './ui'

/** Agrupa as partidas por dia (agenda) para o calendário de jogos. */
export function MatchCalendar({
  championship,
  teams,
  matches,
}: {
  championship: Championship
  teams: Team[]
  matches: Match[]
}) {
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t] as const)), [teams])
  const refName = (id?: string) =>
    (championship.referees ?? []).find((r) => r.id === id)?.name
  const venueLabel = (name?: string) => {
    if (!name) return undefined
    const v = (championship.venues ?? []).find((x) => x.name === name)
    return v?.address ? `${name} — ${v.address}` : name
  }

  const { days, undated } = useMemo(() => {
    const scheduled = matches.filter((m) => m.scheduledAt)
    const undated = matches.filter((m) => !m.scheduledAt)
    const byDay = new Map<string, Match[]>()
    for (const m of scheduled) {
      const key = (m.scheduledAt ?? '').slice(0, 10) // YYYY-MM-DD
      ;(byDay.get(key) ?? byDay.set(key, []).get(key)!)!.push(m)
    }
    const days = [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, list]) => ({
        key,
        list: list.sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '')),
      }))
    return { days, undated }
  }, [matches])

  if (matches.length === 0) {
    return (
      <section className="panel">
        <EmptyState icon="📆" title="Nenhum jogo no calendário">
          <p>Os jogos aparecem aqui assim que forem gerados e agendados.</p>
        </EmptyState>
      </section>
    )
  }

  const fmtDay = (key: string) => {
    const d = new Date(`${key}T12:00:00`)
    if (Number.isNaN(d.getTime())) return key
    return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
  }
  const fmtTime = (iso?: string) => {
    if (!iso) return ''
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }

  const row = (m: Match) => {
    const home = teamById.get(m.homeTeamId ?? '')
    const away = teamById.get(m.awayTeamId ?? '')
    const live = m.status === 'live'
    const finished = m.status === 'finished'
    const played = m.homeScore != null && m.awayScore != null
    const ref = refName(m.refereeId)
    return (
      <li key={m.id} className={`cal-match ${live ? 'is-live' : ''}`}>
        <span className="cal-match__time">{fmtTime(m.scheduledAt) || '—'}</span>
        <span className="cal-match__teams">
          <span className="cal-match__team">
            <TeamBadge team={home} size={22} />
            <span>{home?.name ?? 'A definir'}</span>
          </span>
          <span className="cal-match__score">
            {live && <span className="live-dot live-dot--sm">ao vivo</span>}
            {(finished || live) && played ? `${m.homeScore} × ${m.awayScore}` : 'vs'}
          </span>
          <span className="cal-match__team cal-match__team--away">
            <TeamBadge team={away} size={22} />
            <span>{away?.name ?? 'A definir'}</span>
          </span>
        </span>
        <span className="cal-match__meta">
          {m.venue && <span>📍 {venueLabel(m.venue)}</span>}
          {ref && <span>🧑‍⚖️ {ref}</span>}
        </span>
      </li>
    )
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <div>
          <h2>Calendário de jogos</h2>
          <p className="muted">Agenda das partidas por data.</p>
        </div>
      </div>
      <div className="calendar">
        {days.map((d) => (
          <div key={d.key} className="cal-day">
            <h3 className="cal-day__title">{fmtDay(d.key)}</h3>
            <ul className="cal-list">{d.list.map(row)}</ul>
          </div>
        ))}
        {undated.length > 0 && (
          <div className="cal-day">
            <h3 className="cal-day__title">Data a definir</h3>
            <ul className="cal-list">{undated.map(row)}</ul>
          </div>
        )}
      </div>
    </section>
  )
}
