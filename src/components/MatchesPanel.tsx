import { useMemo, useState } from 'react'
import {
  generateGroups,
  generateKnockout,
  generateLeague,
} from '../services/matches'
import { updateChampionship } from '../services/championships'
import {
  PHASE_LABELS,
  type Championship,
  type Match,
  type MatchPhase,
  type Official,
  type Player,
  type Team,
} from '../types'
import { Button, EmptyState, TeamBadge } from './ui'
import { MatchResultModal } from './MatchResultModal'
import { MatchScheduler } from './MatchScheduler'

export function MatchesPanel({
  championship,
  teams,
  players,
  matches,
  officials,
  onChange,
}: {
  championship: Championship
  teams: Team[]
  players: Player[]
  matches: Match[]
  officials: Official[]
  onChange: () => void
}) {
  const [editing, setEditing] = useState<Match | null>(null)
  const [generating, setGenerating] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const isKnockout = championship.format === 'knockout'
  const isGroups = championship.format === 'groups_knockout'

  async function generate() {
    if (teams.length < 2) {
      alert('Cadastre pelo menos 2 times para gerar a tabela.')
      return
    }
    if (matches.length > 0 && !confirm('Isso substitui todas as partidas e resultados atuais. Continuar?')) return
    setGenerating(true)
    try {
      if (isKnockout) {
        await generateKnockout(championship.id, teams.map((t) => t.id))
      } else if (isGroups) {
        const groups: Record<string, string[]> = {}
        for (const t of teams) {
          const g = t.group || 'A'
          ;(groups[g] ??= []).push(t.id)
        }
        await generateGroups(championship.id, groups, championship.doubleRound)
      } else {
        await generateLeague(championship.id, teams.map((t) => t.id), championship.doubleRound)
      }
      onChange()
      setScheduling(true) // abre o agendador para informar data/hora jogo a jogo
    } finally {
      setGenerating(false)
    }
  }

  // Agrupa por fase (mata-mata) ou por rodada (liga/grupos).
  const sections = useMemo(() => groupMatches(matches, isKnockout), [matches, isKnockout])
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
          <Button onClick={() => void generate()} disabled={generating}>
            {generating ? 'Gerando…' : matches.length ? '↻ Regerar tabela' : '⚙ Gerar tabela de jogos'}
          </Button>
        </div>
      </div>

      {scheduling && matches.length > 0 ? (
        <MatchScheduler
          teams={teams}
          matches={matches}
          isKnockout={isKnockout}
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
            const isClosed = !isKnockout && roundNo != null && closedRounds.has(roundNo)
            return (
              <div key={sec.key} className={`round ${isClosed ? 'round--closed' : ''}`}>
                <div className="round__head">
                  <h3 className="round__title">{sec.title} {isClosed && <span className="round__lock">🔒 inscrições encerradas</span>}</h3>
                  {!isKnockout && roundNo != null && (
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
                    <MatchRow key={m.id} match={m} teams={teams} onClick={() => setEditing(m)} />
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
}: {
  match: Match
  teams: Team[]
  onClick?: () => void
  showSchedule?: boolean
}) {
  const home = teams.find((t) => t.id === match.homeTeamId)
  const away = teams.find((t) => t.id === match.awayTeamId)
  const live = match.status === 'live'
  const hasScore = match.homeScore != null && match.awayScore != null
  const showScore = match.status === 'finished' || live
  const schedule = showSchedule ? matchScheduleText(match) : null
  return (
    <button className={`match-row ${onClick ? 'is-clickable' : ''} ${live ? 'is-live' : ''}`} onClick={onClick} disabled={!onClick}>
      <span className="match-row__side match-row__side--home">
        <span className="match-row__name">{home?.name ?? 'A definir'}</span>
        <TeamBadge team={home} size={26} />
      </span>
      <span className={`match-row__score ${showScore && hasScore ? 'is-played' : ''}`}>
        {live && <span className="live-dot live-dot--sm">ao vivo</span>}
        {showScore && hasScore ? `${match.homeScore} × ${match.awayScore}` : 'vs'}
      </span>
      <span className="match-row__side match-row__side--away">
        <TeamBadge team={away} size={26} />
        <span className="match-row__name">{away?.name ?? 'A definir'}</span>
      </span>
      {schedule && <span className="match-row__meta">{schedule}</span>}
    </button>
  )
}

/** Texto com data, hora e local da partida (usado em "Próximos jogos"). */
function matchScheduleText(match: Match): string {
  const parts: string[] = []
  if (match.scheduledAt) {
    const d = new Date(match.scheduledAt)
    if (!Number.isNaN(d.getTime())) {
      parts.push(`📅 ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`)
      parts.push(`🕒 ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`)
    }
  }
  if (match.venue) parts.push(`📍 ${match.venue}`)
  return parts.length ? parts.join(' · ') : 'Data, horário e local a definir'
}

interface Section {
  key: string
  title: string
  matches: Match[]
}

function groupMatches(matches: Match[], isKnockout: boolean): Section[] {
  if (isKnockout) {
    const byPhase = new Map<MatchPhase, Match[]>()
    for (const m of matches) {
      if (!byPhase.has(m.phase)) byPhase.set(m.phase, [])
      byPhase.get(m.phase)!.push(m)
    }
    const order: MatchPhase[] = ['round_of_32', 'round_of_16', 'quarter', 'semi', 'final', 'third_place']
    return order
      .filter((p) => byPhase.has(p))
      .map((p) => ({ key: p, title: PHASE_LABELS[p], matches: byPhase.get(p)! }))
  }

  const byRound = new Map<number, Match[]>()
  for (const m of matches) {
    if (!byRound.has(m.round)) byRound.set(m.round, [])
    byRound.get(m.round)!.push(m)
  }
  return [...byRound.keys()]
    .sort((a, b) => a - b)
    .map((r) => ({ key: `r${r}`, title: `Rodada ${r}`, matches: byRound.get(r)! }))
}
