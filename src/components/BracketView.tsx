import { KNOCKOUT_ORDER, winnerOf } from '../lib/knockout'
import { PHASE_LABELS, type Match, type Team } from '../types'
import { TeamBadge } from './ui'

/**
 * Organograma do mata-mata: uma coluna por fase (oitavas → final), os
 * confrontos na ordem do chaveamento, e o vencedor de cada um em destaque.
 * A disputa de 3º lugar aparece embaixo da final.
 *
 * Vale para o painel (com `onMatchClick`, abre a partida) e para a visão
 * geral/página pública (só leitura). Cresce sozinho conforme os jogos
 * acontecem: o avanço automático preenche as vagas "a definir".
 */
export function BracketView({
  matches,
  teams,
  onMatchClick,
}: {
  matches: Match[]
  teams: Team[]
  onMatchClick?: (m: Match) => void
}) {
  const ko = matches.filter((m) => m.phase !== 'group')
  const fases = KNOCKOUT_ORDER.filter((p) => ko.some((m) => m.phase === p))
  const terceiro = ko.filter((m) => m.phase === 'third_place')
  if (fases.length === 0 && terceiro.length === 0) return null

  const porPos = (a: Match, b: Match) => (a.bracketPos ?? 0) - (b.bracketPos ?? 0)

  return (
    <div className="bracket" role="group" aria-label="Chaveamento do mata-mata">
      {fases.map((fase, i) => {
        const jogos = ko.filter((m) => m.phase === fase).sort(porPos)
        const ultima = i === fases.length - 1
        return (
          <div key={fase} className="bracket__col">
            <h4 className="bracket__title">{PHASE_LABELS[fase]}</h4>
            <div className="bracket__games">
              {jogos.map((m) => (
                <BracketGame key={m.id} match={m} teams={teams} onClick={onMatchClick} />
              ))}
            </div>
            {ultima && terceiro.length > 0 && (
              <div className="bracket__third">
                <h4 className="bracket__title">{PHASE_LABELS.third_place}</h4>
                {terceiro.map((m) => (
                  <BracketGame key={m.id} match={m} teams={teams} onClick={onMatchClick} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function BracketGame({
  match,
  teams,
  onClick,
}: {
  match: Match
  teams: Team[]
  onClick?: (m: Match) => void
}) {
  // Vencedor só depois do jogo: antes disso, uma vaga preenchida e a outra
  // "a definir" é só o avanço chegando, não uma vitória.
  const vencedor = match.status === 'finished' ? winnerOf(match) : null
  const aoVivo = match.status === 'live'
  const mostraPlacar = match.status === 'finished' || aoVivo
  const linha = (teamId: string | null, gols: number | null, pen?: number | null) => {
    const t = teams.find((x) => x.id === teamId)
    const venceu = !!teamId && vencedor === teamId
    return (
      <div className={`bracket__team ${venceu ? 'is-winner' : ''} ${vencedor && !venceu ? 'is-out' : ''}`}>
        <TeamBadge team={t} size={20} />
        <span className="bracket__name" title={t?.name}>{t?.name ?? 'A definir'}</span>
        {mostraPlacar && (
          <span className="bracket__score">
            {gols ?? 0}
            {pen != null && <small> ({pen})</small>}
          </span>
        )}
      </div>
    )
  }
  // Data/local do jogo: com a lista de mata-mata fora da aba Partidas, é aqui
  // que o organizador vê quando cada confronto acontece.
  const quando = match.scheduledAt ? new Date(match.scheduledAt) : null
  const agenda = [
    quando && !Number.isNaN(quando.getTime())
      ? quando.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : null,
    match.venue,
  ].filter(Boolean).join(' · ')
  const conteudo = (
    <>
      {aoVivo && <span className="live-dot live-dot--sm">ao vivo</span>}
      {linha(match.homeTeamId, match.homeScore, match.penaltyHome)}
      {linha(match.awayTeamId, match.awayScore, match.penaltyAway)}
      {agenda && match.status !== 'finished' && <span className="bracket__when">📅 {agenda}</span>}
    </>
  )
  return onClick ? (
    <button type="button" className={`bracket__game ${aoVivo ? 'is-live' : ''}`} onClick={() => onClick(match)}>
      {conteudo}
    </button>
  ) : (
    <div className={`bracket__game ${aoVivo ? 'is-live' : ''}`}>{conteudo}</div>
  )
}
