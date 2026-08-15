import { useMemo, useState } from 'react'
import {
  createKnockoutStage,
  generateGroups,
  generateKnockout,
  generateLeague,
} from '../services/matches'
import { updateChampionship } from '../services/championships'
import { useAuth } from '../context/AuthContext'
import { hasKnockoutStage, isUnresolvedTie } from '../lib/knockout'
import {
  allGroupStagesComplete,
  groupStagesOf,
  matchStage,
  matchesOfStage,
  nextGroupStageToCreate,
  stageName,
} from '../lib/groupStages'
import {
  PHASE_LABELS,
  type Championship,
  type Match,
  type MatchEvent,
  type MatchPhase,
  type Official,
  type Player,
  type Team,
  type Venue,
} from '../types'
import { Button, EmptyState, TeamBadge } from './ui'
import { MatchResultModal } from './MatchResultModal'
import { MatchScheduler } from './MatchScheduler'

export function MatchesPanel({
  championship,
  teams,
  players,
  matches,
  events = [],
  officials,
  onChange,
}: {
  championship: Championship
  teams: Team[]
  players: Player[]
  matches: Match[]
  events?: MatchEvent[]
  officials: Official[]
  onChange: () => void
}) {
  const { isMaster } = useAuth()
  const [editing, setEditing] = useState<Match | null>(null)
  const [generating, setGenerating] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const isKnockout = championship.format === 'knockout'
  const isGroups = championship.format === 'groups_knockout'
  // Regerar a tabela apaga TODAS as partidas. Com jogos já encerrados isso
  // levaria junto placares, gols, cartões e súmulas — então fica bloqueado.
  const finishedCount = matches.filter((m) => m.status === 'finished').length
  const regenBlocked = finishedCount > 0 && !isMaster
  const groupMatchesOnly = matches.filter((m) => m.phase === 'group')
  const knockoutMatches = matches.filter((m) => m.phase !== 'group')
  const stages = groupStagesOf(championship)
  // Fase de grupos em curso: a última que já tem jogos criados.
  const currentStage = Math.max(1, ...groupMatchesOnly.map(matchStage))
  const remaining = matchesOfStage(matches, currentStage).filter((m) => m.status !== 'finished').length
  const pendingStage = nextGroupStageToCreate(championship, matches)
  const canCreateKnockout =
    !isKnockout &&
    hasKnockoutStage(championship) &&
    knockoutMatches.length === 0 &&
    allGroupStagesComplete(championship, matches)
  const pendingTies = matches.filter(isUnresolvedTie)

  async function createKnockout() {
    setGenerating(true)
    try {
      const ok = await createKnockoutStage(championship, teams, matches, events)
      if (!ok) {
        alert('Não foi possível montar o mata-mata: confira o chaveamento e a classificação em Ajustes.')
      }
      onChange()
    } finally {
      setGenerating(false)
    }
  }

  async function generate() {
    if (teams.length < 2) {
      alert('Cadastre pelo menos 2 times para gerar a tabela.')
      return
    }
    if (finishedCount > 0) {
      if (!isMaster) {
        alert(
          `Não é possível regerar a tabela: ${finishedCount} jogo(s) já foram encerrados.\n\n` +
            'Regerar apagaria placares, gols, cartões e súmulas já registrados. ' +
            'Se a tabela precisa mesmo ser refeita, fale com o administrador master.',
        )
        return
      }
      // Master pode refazer a tabela, mas com aviso explícito do que se perde.
      if (
        !confirm(
          `ATENÇÃO: ${finishedCount} jogo(s) encerrados serão APAGADOS junto com os placares, ` +
            'gols, cartões e súmulas. Esta ação não pode ser desfeita.\n\nRegerar mesmo assim?',
        )
      ) {
        return
      }
    } else if (matches.length > 0 && !confirm('Isso substitui todas as partidas atuais. Continuar?')) {
      return
    }
    setGenerating(true)
    try {
      const force = isMaster
      if (isKnockout) {
        await generateKnockout(championship.id, teams.map((t) => t.id), championship.thirdPlace, force)
      } else if (isGroups) {
        const groups: Record<string, string[]> = {}
        for (const t of teams) {
          const g = t.group || 'A'
          ;(groups[g] ??= []).push(t.id)
        }
        await generateGroups(championship.id, groups, championship.doubleRound, force)
      } else {
        await generateLeague(championship.id, teams.map((t) => t.id), championship.doubleRound, force)
      }
      onChange()
      setScheduling(true) // abre o agendador para informar data/hora jogo a jogo
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Não foi possível gerar a tabela.')
    } finally {
      setGenerating(false)
    }
  }

  // Agrupa por rodada (primeira fase) e por fase (mata-mata).
  const sections = useMemo(() => matchSections(matches), [matches])
  const closedRounds = new Set(championship.closedRounds ?? [])

  async function toggleRound(round: number) {
    const set = new Set(championship.closedRounds ?? [])
    if (set.has(round)) set.delete(round)
    else set.add(round)
    await updateChampionship(championship.id, { closedRounds: [...set].sort((a, b) => a - b) })
    onChange()
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <div>
          <h2>Partidas ({matches.length})</h2>
          <p className="muted">
            {isKnockout
              ? 'Chaveamento eliminatório.'
              : isGroups
                ? 'Rodadas por grupo (todos contra todos).'
                : 'Pontos corridos — todos contra todos.'}
          </p>
        </div>
        <div className="panel__head-actions">
          {matches.length > 0 && (
            <Button variant="soft" onClick={() => setScheduling((s) => !s)}>🗓️ Datas e horários</Button>
          )}
          {canCreateKnockout && (
            <Button onClick={() => void createKnockout()} disabled={generating}>
              {generating ? 'Montando…' : '🏆 Criar mata-mata'}
            </Button>
          )}
          <Button
            onClick={() => void generate()}
            disabled={generating || regenBlocked}
            title={
              regenBlocked
                ? `Bloqueado: ${finishedCount} jogo(s) já encerrados. Regerar apagaria os resultados.`
                : undefined
            }
          >
            {generating ? 'Gerando…' : matches.length ? '↻ Regerar tabela' : '⚙ Gerar tabela de jogos'}
          </Button>
        </div>
      </div>

      {finishedCount > 0 && (
        <p className="ko-note ko-note--lock">
          🔒 A tabela não pode mais ser regerada: {finishedCount} jogo(s) já encerrados.
          Regerar apagaria placares, gols, cartões e súmulas.
          {isMaster && ' Como administrador master, você ainda pode forçar — com perda dos resultados.'}
        </p>
      )}

      {!isKnockout && hasKnockoutStage(championship) && groupMatchesOnly.length > 0 && (
        <p className={`ko-note ${knockoutMatches.length ? 'ko-note--done' : ''}`}>
          {knockoutMatches.length
            ? '🏆 Mata-mata criado com os classificados. Ao encerrar cada confronto, o vencedor avança sozinho para a fase seguinte.'
            : remaining > 0
              ? `🏁 Faltam ${remaining} jogo(s) da ${stageName(stages[currentStage - 1] ?? stages[0], currentStage - 1, stages.length)}.` +
                (pendingStage != null || currentStage < stages.length
                  ? ' Quando o último for encerrado, a fase seguinte é criada automaticamente com os classificados.'
                  : ' Quando o último for encerrado, o mata-mata é criado automaticamente com os classificados.')
              : pendingStage != null
                ? `✅ ${stageName(stages[pendingStage - 2] ?? stages[0], pendingStage - 2, stages.length)} encerrada — montando a ${stageName(stages[pendingStage - 1], pendingStage - 1, stages.length)} com os classificados…`
                : '🏆 Fase de grupos encerrada — montando o mata-mata com os classificados…'}
        </p>
      )}

      {pendingTies.length > 0 && (
        <p className="ko-note ko-note--warn">
          ⚠️ {pendingTies.length} confronto(s) de mata-mata terminaram empatados. Abra a partida e
          informe quem se classificou (pênaltis/W.O.) para liberar a fase seguinte.
        </p>
      )}

      {scheduling && matches.length > 0 ? (
        <MatchScheduler
          teams={teams}
          matches={matches}
          isKnockout={isKnockout}
          venues={championship.venues ?? []}
          onClose={() => setScheduling(false)}
          onSaved={() => {
            onChange()
            setScheduling(false)
          }}
        />
      ) : matches.length === 0 ? (
        <EmptyState icon="📅" title="Nenhuma partida ainda">
          <p>Cadastre os times e clique em “Gerar tabela de jogos” para criar as rodadas automaticamente.</p>
        </EmptyState>
      ) : (
        <div className="rounds">
          {sections.map((sec) => {
            const roundNo = sec.matches[0]?.round
            const isClosed = !sec.isKnockout && roundNo != null && closedRounds.has(roundNo)
            return (
              <div key={sec.key} className={`round ${isClosed ? 'round--closed' : ''}`}>
                <div className="round__head">
                  <h3 className="round__title">{sec.title} {isClosed && <span className="round__lock">🔒 inscrições encerradas</span>}</h3>
                  {!sec.isKnockout && roundNo != null && (
                    <button
                      type="button"
                      className="round__toggle"
                      onClick={() => void toggleRound(roundNo)}
                      title={isClosed ? 'Reabrir inscrições desta rodada' : 'Encerrar inscrições desta rodada'}
                    >
                      {isClosed ? '🔓 Reabrir inscrições' : '🔒 Encerrar inscrições'}
                    </button>
                  )}
                </div>
                <div className="round__matches">
                  {sec.matches.map((m) => (
                    <MatchRow key={m.id} match={m} teams={teams} onClick={() => setEditing(m)} showSchedule venues={championship.venues} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <MatchResultModal
          championship={championship}
          match={editing}
          teams={teams}
          players={players}
          officials={officials}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            onChange()
          }}
        />
      )}
    </section>
  )
}

export function MatchRow({
  match,
  teams,
  onClick,
  showSchedule,
  venues,
}: {
  match: Match
  teams: Team[]
  onClick?: () => void
  showSchedule?: boolean
  venues?: Venue[]
}) {
  const home = teams.find((t) => t.id === match.homeTeamId)
  const away = teams.find((t) => t.id === match.awayTeamId)
  const live = match.status === 'live'
  // Jogo encerrado ganha cor própria na lista do administrador e do mesário.
  const finished = match.status === 'finished'
  const hasScore = match.homeScore != null && match.awayScore != null
  const showScore = finished || live
  const schedule = showSchedule ? matchScheduleText(match, venues) : null
  return (
    <button
      className={`match-row ${onClick ? 'is-clickable' : ''} ${live ? 'is-live' : ''} ${finished ? 'is-finished' : ''}`}
      onClick={onClick}
      disabled={!onClick}
      title={finished ? 'Partida encerrada' : undefined}
    >
      <span className="match-row__side match-row__side--home">
        <span className="match-row__name" title={home?.name}>{home?.name ?? 'A definir'}</span>
        <TeamBadge team={home} size={26} />
      </span>
      <span className={`match-row__score ${showScore && hasScore ? 'is-played' : ''}`}>
        {live && <span className="live-dot live-dot--sm">ao vivo</span>}
        {finished && <span className="finished-tag">encerrado</span>}
        {showScore && hasScore ? `${match.homeScore} × ${match.awayScore}` : 'vs'}
      </span>
      <span className="match-row__side match-row__side--away">
        <TeamBadge team={away} size={26} />
        <span className="match-row__name" title={away?.name}>{away?.name ?? 'A definir'}</span>
      </span>
      {schedule && <span className="match-row__meta">{schedule}</span>}
    </button>
  )
}

/** Texto com data, hora e local (nome + endereço) da partida — "Próximos jogos". */
function matchScheduleText(match: Match, venues?: Venue[]): string {
  const parts: string[] = []
  if (match.scheduledAt) {
    const d = new Date(match.scheduledAt)
    if (!Number.isNaN(d.getTime())) {
      parts.push(`📅 ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`)
      parts.push(`🕒 ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`)
    }
  }
  if (match.venue) {
    const v = venues?.find((x) => x.name === match.venue)
    parts.push(`📍 ${v?.address ? `${match.venue} — ${v.address}` : match.venue}`)
  }
  return parts.length ? parts.join(' · ') : 'Data, horário e local a definir'
}

export interface Section {
  key: string
  title: string
  matches: Match[]
  /** Seção de mata-mata (sem fechamento de inscrições por rodada). */
  isKnockout: boolean
}

/** "2ª fase · Rodada 4" quando há mais de uma fase de grupos. */
function roundTitle(matches: Match[], round: number, multiStage: boolean): string {
  if (!multiStage) return `Rodada ${round}`
  const stage = matchStage(matches[0])
  return `${stage}ª fase · Rodada ${round}`
}

const PHASE_ORDER: MatchPhase[] = [
  'round_of_32',
  'round_of_16',
  'quarter',
  'semi',
  'final',
  'third_place',
]

/**
 * Seções da lista de jogos: as rodadas da primeira fase e, na sequência, as
 * fases do mata-mata (que podem coexistir no formato grupos + mata-mata).
 */
export function matchSections(matches: Match[]): Section[] {
  const byRound = new Map<number, Match[]>()
  const byPhase = new Map<MatchPhase, Match[]>()
  for (const m of matches) {
    if (m.phase === 'group') {
      if (!byRound.has(m.round)) byRound.set(m.round, [])
      byRound.get(m.round)!.push(m)
    } else {
      if (!byPhase.has(m.phase)) byPhase.set(m.phase, [])
      byPhase.get(m.phase)!.push(m)
    }
  }

  const multiStage = new Set(matches.filter((m) => m.phase === 'group').map(matchStage)).size > 1
  const rounds: Section[] = [...byRound.keys()]
    .sort((a, b) => a - b)
    .map((r) => ({
      key: `r${r}`,
      title: roundTitle(byRound.get(r)!, r, multiStage),
      matches: byRound.get(r)!,
      isKnockout: false,
    }))

  const phases: Section[] = PHASE_ORDER.filter((p) => byPhase.has(p)).map((p) => ({
    key: p,
    title: PHASE_LABELS[p],
    matches: byPhase.get(p)!.sort((a, b) => (a.bracketPos ?? 0) - (b.bracketPos ?? 0)),
    isKnockout: true,
  }))

  return [...rounds, ...phases]
}
