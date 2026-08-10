import { useMemo } from 'react'
import { aggregateByPlayer } from '../lib/stats'
import type { EventType, MatchEvent, Player, Team } from '../types'
import { EmptyState, TeamBadge } from './ui'

const RANKINGS: { type: EventType; title: string; icon: string; unit: string }[] = [
  { type: 'goal', title: 'Artilharia', icon: '⚽', unit: 'gols' },
  { type: 'assist', title: 'Assistências', icon: '🅰️', unit: 'assist.' },
  { type: 'yellow_card', title: 'Cartões amarelos', icon: '🟨', unit: 'amarelos' },
  { type: 'red_card', title: 'Cartões vermelhos', icon: '🟥', unit: 'vermelhos' },
]

export function StatsPanel({
  events,
  players,
  teams,
}: {
  events: MatchEvent[]
  players: Player[]
  teams: Team[]
}) {
  const rankings = useMemo(
    () =>
      RANKINGS.map((r) => ({
        ...r,
        rows: aggregateByPlayer(events, r.type, players, teams).slice(0, 10),
      })),
    [events, players, teams],
  )

  const teamById = new Map(teams.map((t) => [t.id, t] as const))
  const hasAny = rankings.some((r) => r.rows.length > 0)

  return (
    <section className="panel">
      <div className="panel__head">
        <div>
          <h2>Estatísticas</h2>
          <p className="muted">Rankings calculados a partir dos eventos das partidas.</p>
        </div>
      </div>

      {!hasAny ? (
        <EmptyState icon="📊" title="Ainda sem estatísticas">
          <p>Registre gols e cartões ao encerrar as partidas para ver os rankings aqui.</p>
        </EmptyState>
      ) : (
        <div className="stats-grid">
          {rankings.map((r) => (
            <div key={r.type} className="stat-card">
              <h3><span>{r.icon}</span> {r.title}</h3>
              {r.rows.length === 0 ? (
                <p className="muted small">Sem registros.</p>
              ) : (
                <ol className="rank-list">
                  {r.rows.map((row, i) => {
                    const team = teamById.get(row.teamId)
                    return (
                      <li key={(row.playerId ?? row.teamId) + r.type}>
                        <span className="rank-list__pos">{i + 1}</span>
                        <TeamBadge team={team} size={22} />
                        <span className="rank-list__name">{row.name}</span>
                        <span className="rank-list__count">{row.count} <small>{r.unit}</small></span>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
