import { useMemo } from 'react'
import type { Championship, Match, Team } from '../types'
import { MatchRow, matchSections } from './MatchesPanel'
import { EmptyState } from './ui'

export function MatchesReadOnly({
  teams,
  matches,
}: {
  championship?: Championship
  teams: Team[]
  matches: Match[]
}) {
  const sections = useMemo(() => matchSections(matches), [matches])

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
