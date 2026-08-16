import type { StandingRow, Team } from '../types'
import { TeamBadge } from './ui'

export function StandingsTable({
  rows,
  teams,
  highlightTop = 0,
  championTeamId,
}: {
  rows: StandingRow[]
  teams: Team[]
  /** Destaca as N primeiras posições (zona de classificação). */
  highlightTop?: number
  /** Marca a equipe campeã com o troféu. */
  championTeamId?: string
}) {
  const teamById = new Map(teams.map((t) => [t.id, t] as const))
  if (rows.length === 0) {
    return <p className="muted center pad">Nenhum time cadastrado ainda.</p>
  }
  return (
    <div className="table-wrap">
      <table className="standings">
        <thead>
          <tr>
            <th className="col-pos">#</th>
            <th className="col-team">Time</th>
            <th title="Pontos">P</th>
            <th title="Jogos">J</th>
            <th title="Vitórias">V</th>
            <th title="Empates">E</th>
            <th title="Derrotas">D</th>
            <th title="Gols pró">GP</th>
            <th title="Gols contra">GC</th>
            <th title="Saldo de gols">SG</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const team = teamById.get(r.teamId)
            return (
              <tr
                key={r.teamId}
                className={`${highlightTop && i < highlightTop ? 'is-qualified' : ''} ${r.teamId === championTeamId ? 'is-champion' : ''}`}
              >
                <td className="col-pos">{i + 1}</td>
                <td className="col-team">
                  <span className="team-cell">
                    <TeamBadge team={team} size={24} />
                    <span className="team-cell__name">{team?.name ?? '—'}</span>
                    {r.teamId === championTeamId && <span className="team-cell__trophy" title="Campeão">🏆</span>}
                  </span>
                </td>
                <td className="strong">{r.points}</td>
                <td>{r.played}</td>
                <td>{r.won}</td>
                <td>{r.drawn}</td>
                <td>{r.lost}</td>
                <td>{r.goalsFor}</td>
                <td>{r.goalsAgainst}</td>
                <td>{r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
