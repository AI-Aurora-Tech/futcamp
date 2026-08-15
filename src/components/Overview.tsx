import { useMemo } from 'react'
import { computeStandings } from '../lib/standings'
import {
  groupStagesOf,
  matchStage,
  qualifiersOfGroup,
  stageExists,
  stageName,
  standingsOfStage,
} from '../lib/groupStages'
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
  const leagueQualifiers = championship.leagueQualifiers ?? 0
  const stages = useMemo(() => (isGroups ? groupStagesOf(championship) : []), [isGroups, championship])

  const topScorer = useMemo(() => aggregateByPlayer(events, 'goal', players, teams)[0], [events, players, teams])

  const standings = useMemo(
    () => (isGroups ? null : computeStandings(teams, matches, championship, { events })),
    [teams, matches, championship, isGroups, events],
  )
  /** Uma tabela por fase de grupos (só as que já têm jogos criados). */
  const stageTables = useMemo(() => {
    if (!isGroups) return []
    const played = new Set(matches.filter((m) => m.phase === 'group').map(matchStage))
    return stages
      .map((cfg, i) => ({ cfg, stage: i + 1 }))
      .filter(({ stage }) => stage === 1 || played.has(stage) || stageExists(matches, stage))
      .map(({ cfg, stage }) => ({
        cfg,
        stage,
        table: standingsOfStage(championship, teams, matches, stage, events),
      }))
  }, [isGroups, stages, championship, teams, matches, events])

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
          ) : isGroups ? (
            <>
              {stageTables.map(({ cfg, stage, table }) => (
                <div key={cfg.id ?? stage} className="stage-block">
                  {stages.length > 1 && (
                    <h3 className="stage-block__title">{stageName(cfg, stage - 1, stages.length)}</h3>
                  )}
                  <p className="qualify-note">
                    🟢 Classificados {stage === stages.length ? 'para o mata-mata' : 'para a fase seguinte'}:{' '}
                    {Object.keys(table)
                      .sort()
                      .map((g) => `${qualifiersOfGroup(cfg, g)} do grupo ${g}`)
                      .join(' · ')}
                  </p>
                  {Object.keys(table).sort().map((g) => (
                    <div key={g} className="group-block">
                      <h4 className="group-block__title">Grupo {g}</h4>
                      <StandingsTable rows={table[g]} teams={teams} highlightTop={qualifiersOfGroup(cfg, g)} />
                    </div>
                  ))}
                </div>
              ))}
            </>
          ) : (
            <>
              {leagueQualifiers > 0 && (
                <p className="qualify-note">🟢 Os {leagueQualifiers} primeiros colocados se classificam.</p>
              )}
              <StandingsTable rows={standings ?? []} teams={teams} highlightTop={leagueQualifiers} />
            </>
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
