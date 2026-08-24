import type { Podium } from '../lib/champion'
import type { Team } from '../types'
import { TeamBadge } from './ui'

/**
 * Faixa de campeão — aparece na visão geral do campeonato (para o organizador)
 * e na página pública, assim que o título é decidido.
 */
export function ChampionBanner({ podium, teams }: { podium: Podium; teams: Team[] }) {
  const byId = (id?: string) => teams.find((t) => t.id === id)
  const champion = byId(podium.championId)
  if (!champion) return null

  const runnerUp = byId(podium.runnerUpId)
  const third = byId(podium.thirdId)

  return (
    <section className="champion" aria-label="Equipe campeã">
      <div className="champion__main">
        <span className="champion__trophy" aria-hidden>🏆</span>
        <span className="champion__badge"><TeamBadge team={champion} size={56} /></span>
        <div className="champion__text">
          <span className="champion__label">Campeão</span>
          <strong className="champion__name">{champion.name}</strong>
          <span className="champion__how">
            {podium.decidedBy === 'final'
              ? podium.finalScore
                ? `Final: ${podium.finalScore}`
                : 'Campeão na final'
              : podium.points != null
                ? `Campeão com ${podium.points} ponto(s) em ${podium.played} jogo(s)`
                : 'Campeão pela classificação final'}
          </span>
        </div>
      </div>

      {(runnerUp || third) && (
        <ul className="champion__podium">
          {runnerUp && (
            <li>
              <span aria-hidden>🥈</span> <TeamBadge team={runnerUp} size={22} />
              <span className="champion__podium-name">{runnerUp.name}</span>
              <span className="muted small">vice</span>
            </li>
          )}
          {third && (
            <li>
              <span aria-hidden>🥉</span> <TeamBadge team={third} size={22} />
              <span className="champion__podium-name">{third.name}</span>
              <span className="muted small">3º lugar</span>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

/** Selo compacto de campeão, para o cabeçalho do campeonato. */
export function ChampionTag({ podium, teams }: { podium: Podium; teams: Team[] }) {
  const champion = teams.find((t) => t.id === podium.championId)
  if (!champion) return null
  return (
    <span className="champion-tag" title={`Campeão: ${champion.name}`}>
      <span aria-hidden>🏆</span>
      <TeamBadge team={champion} size={20} />
      <span className="champion-tag__name">Campeão: {champion.name}</span>
    </span>
  )
}
