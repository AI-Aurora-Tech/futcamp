import { useMemo } from 'react'
import { PHASE_LABELS, type Championship, type Match, type MatchPhase, type Team } from '../types'
import { MatchRow } from './MatchesPanel'
import { EmptyState } from './ui'

export function MatchesReadOnly({
  championship,
  teams,
  matches,
}: {
  championship: Championship
  teams: Team[]
  matches: Match[]
}) {
  const isKnockout = championship.format === 'knockout'
  const sections = useMemo(() => {
    if (isKnockout) {
      const byPhase = new Map<MatchPhase, Match[]>()
      for (const m of matches) (byPhase.get(m.phase) ?? byPhase.set(m.phase, []).get(m.phase)!)!.push(m)
      const order: MatchPhase[] = ['round_of_32', 'round_of_16', 'quarter', 'semi', 'final', 'third_place']
      return order.filter((p) => byPhase.has(p)).map((p) => ({ key: p, title: PHASE_LABELS[p], matches: byPhase.get(p)! }))
    }
    const byRound = new Map<number, Match[]>()
    for (const m of matches) (byRound.get(m.round) ?? byRound.set(m.round, []).get(m.round)!)!.push(m)
    return [...byRound.keys()].sort((a, b) => a - b).map((r) => ({ key: `r${r}`, title: `Rodada ${r}`, matches: byRound.get(r)! }))
  }, [matches, isKnockout])

  if (matches.length === 0) {
    return (
      <section className="panel">
        <EmptyState icon="📅" title="Nenhum jogo publicado ainda">
          <p>As partidas aparecerão aqui assim que forem definidas pelo organizador.</p>
        </EmptyState>
      </section>
    )
  }

  return (
    <section className="panel">
      <div className="rounds">
        {sections.map((sec) => (
          <div key={sec.key} className="round">
            <h3 className="round__title">{sec.title}</h3>
            <div className="round__matches">
              {sec.matches.map((m) => <MatchRow key={m.id} match={m} teams={teams} />)}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
