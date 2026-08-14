import { useMemo } from 'react'
import { computeStandings, computeStandingsByGroup } from '../lib/standings'
import { aggregateByPlayer } from '../lib/stats'
import type { Championship, Match, MatchEvent, Player, Team } from '../types'
import { StandingsTable } from './StandingsTable'
import { MatchRow } from './MatchesPanel'
import { TeamBadge, EmptyState } from './ui'

export function Overview({
  championship,
  teams,
  matches,
  players = [],
  events = [],
}: {
  championship: Championship
  teams: Team[]
  matches: Match[]
  players?: Player[]
  events?: MatchEvent[]
}) {
  const isGroups = championship.format === 'groups_knockout'
  const isKnockout = championship.format === 'knockout'

  const topScorer = useMemo(() => aggregateByPlayer(events, 'goal', players, teams)[0], [events, players, teams])

  const standings = useMemo(
    () => (isGroups ? null : computeStandings(teams, matches, championship)),
    [teams, matches, championship, isGroups],
  )
  const groupStandings = useMemo(
    () => (isGroups ? computeStandingsByGroup(teams, matches, championship) : null),
    [teams, matches, championship, isGroups],
  )

  const finished = matches.filter((m) => m.status === 'finished')
  const recent = finished.slice(-5).reverse()
  const upcoming = matches.filter((m) => m.status !== 'finished' && m.homeTeamId && m.awayTeamId).slice(0, 5)

  const goals = finished.reduce((s, m) => s + (m.homeScore ?? 0) + (m.awayScore ?? 0), 0)

  return (
    <div className="overview">
      <div className="stat-row">
        <StatTile label="Times" value={teams.length} icon="🛡️" />
        <StatTile label="Partidas" value={matches.length} icon="📅" />
        <StatTile label="Jogos realizados" value={finished.length} icon="✅" />
        <StatTile label="Gols marcados" value={goals} icon="⚽" />
      </div>

      <div className="overview__cols">
        <div className="overview__main">
          <h2 className="section-title">Classificação</h2>
          {isKnockout ? (
            <EmptyState icon="🏆" title="Formato mata-mata">
              <p>Neste formato não há tabela de pontos. Acompanhe o chaveamento na aba Partidas.</p>
            </EmptyState>
          ) : isGroups && groupStandings ? (
            Object.keys(groupStandings).sort().map((g) => (
              <div key={g} className="group-block">
                <h3 className="group-block__title">Grupo {g}</h3>
                <StandingsTable rows={groupStandings[g]} teams={teams} highlightTop={2} />
              </div>
            ))
          ) : (
            <StandingsTable rows={standings ?? []} teams={teams} />
          )}
        </div>

        <aside className="overview__side">
          {topScorer && (
            <div className="top-scorer">
              <span className="top-scorer__badge">⚽ Artilheiro</span>
              <div className="top-scorer__body">
                <span className="top-scorer__logo"><TeamBadge team={teams.find((t) => t.id === topScorer.teamId)} size={44} /></span>
                <div className="top-scorer__info">
                  <strong className="top-scorer__name">{topScorer.name}</strong>
                  <span className="top-scorer__team">{teams.find((t) => t.id === topScorer.teamId)?.name ?? ''}</span>
                </div>
                <span className="top-scorer__goals">{topScorer.count}<small>{topScorer.count === 1 ? 'gol' : 'gols'}</small></span>
              </div>
            </div>
          )}
          <div className="side-card">
            <h3>Últimos resultados</h3>
            {recent.length === 0 ? (
              <p className="muted small">Nenhum jogo encerrado.</p>
            ) : (
              <div className="mini-matches">
                {recent.map((m) => <MatchRow key={m.id} match={m} teams={teams} />)}
              </div>
            )}
          </div>
          <div className="side-card">
            <h3>Próximos jogos</h3>
            {upcoming.length === 0 ? (
              <p className="muted small">Sem jogos agendados.</p>
            ) : (
              <div className="mini-matches">
                {upcoming.map((m) => <MatchRow key={m.id} match={m} teams={teams} showSchedule venues={championship.venues} />)}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

function StatTile({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-tile__icon">{icon}</span>
      <span className="stat-tile__value">{value}</span>
      <span className="stat-tile__label">{label}</span>
    </div>
  )
}
