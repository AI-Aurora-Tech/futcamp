import { useMemo } from 'react'
import { aggregateByPlayer } from '../lib/stats'
import { computeDiscipline } from '../lib/discipline'
import type { Category, EventType, Match, MatchEvent, Player, Team } from '../types'
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
  matches = [],
  categories = [],
}: {
  events: MatchEvent[]
  players: Player[]
  teams: Team[]
  matches?: Match[]
  /** Categorias do campeonato — definem quantos amarelos suspendem. */
  categories?: Category[]
}) {
  const rankings = useMemo(
    () =>
      RANKINGS.map((r) => ({
        ...r,
        rows: aggregateByPlayer(events, r.type, players, teams).slice(0, 10),
      })),
    [events, players, teams],
  )
  const discipline = useMemo(
    () => computeDiscipline(matches, events, players, teams, categories),
    [matches, events, players, teams, categories],
  )
  const suspended = discipline.filter((d) => d.suspended)

  const teamById = new Map(teams.map((t) => [t.id, t] as const))
  const hasAny = rankings.some((r) => r.rows.length > 0)
  const hasDiscipline = discipline.length > 0

  return (
    <section className="panel">
      <div className="panel__head">
        <div>
          <h2>Estatísticas</h2>
          <p className="muted">Rankings calculados a partir dos eventos das partidas.</p>
        </div>
      </div>

      {suspended.length > 0 && (
        <div className="suspend-banner">
          <h3>🚫 Suspensões automáticas ({suspended.length})</h3>
          <ul className="suspend-list">
            {suspended.map((d) => (
              <li key={(d.playerId ?? d.teamId) + ':susp'}>
                <TeamBadge team={teamById.get(d.teamId)} size={22} />
                <span className="suspend-list__name">{d.name}</span>
                <span className="muted small">{d.team}</span>
                <span className="suspend-list__reason">{d.reasons.join(' · ')}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">
            Suspensão por 3 amarelos na fase de grupos/pontos corridos ou cartão vermelho.
            Alerta automático — não controla suspensão já cumprida.
          </p>
        </div>
      )}

      {!hasAny && !hasDiscipline ? (
        <EmptyState icon="📊" title="Ainda sem estatísticas">
          <p>Registre gols e cartões ao encerrar as partidas para ver os rankings aqui.</p>
        </EmptyState>
      ) : (
        <>
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

          {hasDiscipline && (
            <div className="stat-card discipline-card">
              <h3><span>📋</span> Situação disciplinar</h3>
              <div className="table-wrap">
                <table className="discipline-table">
                  <thead>
                    <tr>
                      <th>Jogador</th>
                      <th>Time</th>
                      <th title="Amarelos na fase de grupos / pontos corridos">🟨</th>
                      <th title="Cartões vermelhos">🟥</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {discipline.map((d) => (
                      <tr key={(d.playerId ?? d.teamId) + ':disc'} className={d.suspended ? 'is-suspended' : ''}>
                        <td>{d.name}</td>
                        <td className="muted small">{d.team}</td>
                        <td>{d.yellows || '—'}</td>
                        <td>{d.reds || '—'}</td>
                        <td>
                          {d.suspended
                            ? <span className="tag tag--danger">Suspenso</span>
                            : <span className="muted small">Regular</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
