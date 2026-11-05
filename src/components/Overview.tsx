import { useMemo, useState } from 'react'
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
import { computePodium } from '../lib/champion'
import { ChampionBanner } from './ChampionBanner'
import type { Championship, Match, MatchEvent, Player, Team } from '../types'
import { StandingsTable } from './StandingsTable'
import { MatchRow } from './MatchesPanel'
import { BracketView } from './BracketView'
import { estadosDoMataMata, fasesDoCampeonato, type Fase } from '../lib/fasesPartidas'
import { TeamBadge, EmptyState } from './ui'

export function Overview({
  championship,
  teams,
  matches,
  players = [],
  events = [],
  publico = false,
}: {
  championship: Championship
  teams: Team[]
  matches: Match[]
  players?: Player[]
  events?: MatchEvent[]
  /** Painel público: "Próximos jogos" só lista os que já têm data e hora. */
  publico?: boolean
}) {
  // Grupos com classificação GERAL: as equipes jogam nos seus grupos, mas a
  // tabela é única (todas as equipes juntas) e vale a colocação geral.
  const general = championship.format === 'groups_knockout' && !!championship.generalStanding
  const isGroups = championship.format === 'groups_knockout' && !general
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

  const podium = useMemo(
    () => computePodium(championship, teams, matches, events),
    [championship, teams, matches, events],
  )

  // O mata-mata aparece na visão geral assim que existe, e vai se preenchendo
  // a cada jogo encerrado (os vencedores avançam sozinhos).
  const knockout = matches.filter((m) => m.phase !== 'group')

  // Fases do campeonato: a encerrada vira um resumo de uma linha e a que está em
  // disputa ganha destaque — o mesmo andamento da aba Partidas.
  const fases = useMemo(
    () =>
      fasesDoCampeonato(matches, (etapa) => {
        const cfg = stages[etapa - 1]
        if (cfg) return stageName(cfg, etapa - 1, stages.length)
        return championship.format === 'league' ? 'Pontos corridos' : 'Classificação'
      }),
    [matches, stages, championship.format],
  )
  const comFases = fases.length > 1
  const estadosDoChaveamento = useMemo(() => (comFases ? estadosDoMataMata(fases) : undefined), [comFases, fases])
  const faseDaEtapa = (etapa: number) => (comFases ? fases.find((f) => f.key === `etapa-${etapa}`) : undefined)
  /** Fases que a pessoa abriu/fechou à mão; o resto segue o padrão (encerrada = reduzida). */
  const [aberturaManual, setAberturaManual] = useState<Record<string, boolean>>({})
  const aberta = (f: Fase) => aberturaManual[f.key] ?? f.estado !== 'encerrada'
  const nomeDoTime = (id: string) => teams.find((t) => t.id === id)?.name ?? ''
  const finished = matches.filter((m) => m.status === 'finished')
  const recent = finished.slice(-5).reverse()
  // No link público, "Próximos jogos" lista só os que já têm data e hora,
  // em ordem cronológica.
  const upcoming = (
    publico
      ? matches
          .filter((m) => m.status !== 'finished' && m.homeTeamId && m.awayTeamId && !!m.scheduledAt)
          .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!))
      : matches.filter((m) => m.status !== 'finished' && m.homeTeamId && m.awayTeamId)
  ).slice(0, 5)

  const goals = finished.reduce((s, m) => s + (m.homeScore ?? 0) + (m.awayScore ?? 0), 0)

  return (
    <div className="overview">
      <ChampionBanner podium={podium} teams={teams} />

      <div className="stat-row">
        <StatTile label="Times" value={teams.length} icon="🛡️" />
        <StatTile label="Partidas" value={matches.length} icon="📅" />
        <StatTile label="Jogos realizados" value={finished.length} icon="✅" />
        <StatTile label="Gols marcados" value={goals} icon="⚽" />
      </div>

      <div className="overview__cols">
        <div className="overview__main">
          {!isKnockout && <h2 className="section-title">Classificação</h2>}
          {isKnockout ? (
            knockout.length === 0 && (
              <EmptyState icon="🏆" title="Formato mata-mata">
                <p>Neste formato não há tabela de pontos. O chaveamento aparece aqui assim que os jogos forem gerados.</p>
              </EmptyState>
            )
          ) : isGroups ? (
            <>
              {stageTables.map(({ cfg, stage, table }) => {
                const fase = faseDaEtapa(stage)
                const corpo = (
                  <>
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
                  </>
                )
                // Fase encerrada: o resumo diz quem se classificou, em cada grupo.
                const resumo = Object.keys(table)
                  .sort()
                  .map((g) => {
                    const nomes = table[g].slice(0, qualifiersOfGroup(cfg, g)).map((r) => nomeDoTime(r.teamId)).filter(Boolean)
                    return `Grupo ${g}: ${nomes.join(', ')}`
                  })
                  .join(' · ')
                if (fase) {
                  return (
                    <BlocoDaFase
                      key={cfg.id ?? stage}
                      fase={fase}
                      aberta={aberta(fase)}
                      onAlternar={() => setAberturaManual((m) => ({ ...m, [fase.key]: !aberta(fase) }))}
                      resumo={`🟢 Classificados — ${resumo}`}
                    >
                      {corpo}
                    </BlocoDaFase>
                  )
                }
                return (
                  <div key={cfg.id ?? stage} className="stage-block">
                    {stages.length > 1 && (
                      <h3 className="stage-block__title">{stageName(cfg, stage - 1, stages.length)}</h3>
                    )}
                    {corpo}
                  </div>
                )
              })}
            </>
          ) : (
            (() => {
              const fase = faseDaEtapa(1)
              const corpo = (
                <>
                  {general && (
                    <p className="qualify-note">
                      📊 Classificação <b>geral</b>: as equipes jogam nos seus grupos, mas a tabela é única.
                    </p>
                  )}
                  {leagueQualifiers > 0 && (
                    <p className="qualify-note">
                      🟢 Os {leagueQualifiers} primeiros colocados{general ? ' no geral' : ''} se classificam
                      {general ? ' ao mata-mata' : ''}.
                    </p>
                  )}
                  <StandingsTable
                    rows={standings ?? []}
                    teams={teams}
                    highlightTop={leagueQualifiers}
                    championTeamId={podium.decidedBy === 'league' ? podium.championId : undefined}
                  />
                </>
              )
              if (!fase) return corpo
              // Classificação encerrada e mata-mata em andamento: o resumo diz quem passou.
              const passaram = (standings ?? [])
                .slice(0, leagueQualifiers || 1)
                .map((r) => nomeDoTime(r.teamId))
                .filter(Boolean)
                .join(', ')
              return (
                <BlocoDaFase
                  fase={fase}
                  aberta={aberta(fase)}
                  onAlternar={() => setAberturaManual((m) => ({ ...m, [fase.key]: !aberta(fase) }))}
                  resumo={leagueQualifiers > 0 ? `🟢 Classificados — ${passaram}` : `🥇 Líder — ${passaram}`}
                >
                  {corpo}
                </BlocoDaFase>
              )
            })()
          )}

          {knockout.length > 0 && (
            <div className="bracket-block">
              <h2 className="section-title">🏆 Mata-mata</h2>
              <BracketView matches={knockout} teams={teams} estados={estadosDoChaveamento} />
            </div>
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

/**
 * Moldura de uma fase na Visão geral: encerrada = cabeçalho + resumo de uma
 * linha (clique abre a tabela); em disputa = destaque; o resto = como estava.
 */
function BlocoDaFase({
  fase,
  aberta,
  onAlternar,
  resumo,
  children,
}: {
  fase: Fase
  aberta: boolean
  onAlternar: () => void
  /** Linha mostrada quando a fase está reduzida. */
  resumo: string
  children: React.ReactNode
}) {
  const pct = fase.total ? Math.round((fase.encerrados / fase.total) * 100) : 0
  const jogos = `${fase.encerrados} de ${fase.total} jogo${fase.total === 1 ? '' : 's'} encerrado${fase.total === 1 ? '' : 's'}`
  return (
    <div className={`fase fase--${fase.estado} ${aberta ? 'is-aberta' : 'is-reduzida'}`}>
      <button
        type="button"
        className="fase__head"
        aria-expanded={aberta}
        onClick={onAlternar}
        title={aberta ? 'Reduzir esta fase' : 'Mostrar a classificação desta fase'}
      >
        <span className="fase__chevron" aria-hidden>{aberta ? '▾' : '▸'}</span>
        <span className="fase__titulo">{fase.titulo}</span>
        {fase.estado === 'atual' && <span className="fase__selo fase__selo--atual">● Em disputa</span>}
        {fase.estado === 'encerrada' && <span className="fase__selo fase__selo--ok">✅ Encerrada</span>}
        <span className="fase__contagem">{fase.estado === 'encerrada' ? `${fase.total} jogo${fase.total === 1 ? '' : 's'}` : jogos}</span>
      </button>
      {fase.estado === 'atual' && (
        <div className="fase__barra" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${fase.titulo}: ${jogos}`}>
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      {aberta ? <div className="fase__corpo fase__corpo--bloco">{children}</div> : <p className="fase__resumo">{resumo}</p>}
    </div>
  )
}
