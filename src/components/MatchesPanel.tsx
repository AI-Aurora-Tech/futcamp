import { useMemo, useState } from 'react'
import {
  generateGroups,
  generateKnockout,
  generateLeague,
} from '../services/matches'
import {
  PHASE_LABELS,
  type Championship,
  type Match,
  type MatchPhase,
  type Player,
  type Team,
} from '../types'
import { Button, EmptyState, TeamBadge } from './ui'
import { MatchResultModal } from './MatchResultModal'

export function MatchesPanel({
  championship,
  teams,
  players,
  matches,
  onChange,
}: {
  championship: Championship
  teams: Team[]
  players: Player[]
  matches: Match[]
  onChange: () => void
}) {
  const [editing, setEditing] = useState<Match | null>(null)
  const [generating, setGenerating] = useState(false)
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
    } finally {
      setGenerating(false)
    }
  }

  // Agrupa por fase (mata-mata) ou por rodada (liga/grupos).
  const sections = useMemo(() => groupMatches(matches, isKnockout), [matches, isKnockout])

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
        <Button onClick={() => void generate()} disabled={generating}>
          {generating ? 'Gerando…' : matches.length ? '↻ Regerar tabela' : '⚙ Gerar tabela de jogos'}
        </Button>
      </div>

      {matches.length === 0 ? (
        <EmptyState icon="📅" title="Nenhuma partida ainda">
          <p>Cadastre os times e clique em “Gerar tabela de jogos” para criar as rodadas automaticamente.</p>
        </EmptyState>
      ) : (
        <div className="rounds">
          {sections.map((sec) => (
            <div key={sec.key} className="round">
              <h3 className="round__title">{sec.title}</h3>
              <div className="round__matches">
                {sec.matches.map((m) => (
                  <MatchRow key={m.id} match={m} teams={teams} onClick={() => setEditing(m)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <MatchResultModal
          match={editing}
          teams={teams}
          players={players}
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
}: {
  match: Match
  teams: Team[]
  onClick?: () => void
}) {
  const home = teams.find((t) => t.id === match.homeTeamId)
  const away = teams.find((t) => t.id === match.awayTeamId)
  const played = match.status === 'finished'
  return (
    <button className={`match-row ${onClick ? 'is-clickable' : ''}`} onClick={onClick} disabled={!onClick}>
      <span className="match-row__side match-row__side--home">
        <span className="match-row__name">{home?.name ?? 'A definir'}</span>
        <TeamBadge team={home} size={26} />
      </span>
      <span className={`match-row__score ${played ? 'is-played' : ''}`}>
        {played ? `${match.homeScore} × ${match.awayScore}` : 'vs'}
      </span>
      <span className="match-row__side match-row__side--away">
        <TeamBadge team={away} size={26} />
        <span className="match-row__name">{away?.name ?? 'A definir'}</span>
      </span>
    </button>
  )
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
