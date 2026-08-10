import { useEffect, useState } from 'react'
import { addEvent, deleteEvent, listEvents, updateMatch, type NewEvent } from '../services/matches'
import {
  EVENT_LABELS,
  type EventType,
  type Match,
  type MatchEvent,
  type Player,
  type Team,
} from '../types'
import { Button, Modal, TeamBadge } from './ui'

const EVENT_ICONS: Record<EventType, string> = {
  goal: '⚽',
  own_goal: '🥅',
  assist: '🅰️',
  yellow_card: '🟨',
  red_card: '🟥',
}

export function MatchResultModal({
  match,
  teams,
  players,
  onClose,
  onSaved,
}: {
  match: Match
  teams: Team[]
  players: Player[]
  onClose: () => void
  onSaved: () => void
}) {
  const home = teams.find((t) => t.id === match.homeTeamId)
  const away = teams.find((t) => t.id === match.awayTeamId)
  const [homeScore, setHomeScore] = useState<string>(match.homeScore != null ? String(match.homeScore) : '')
  const [awayScore, setAwayScore] = useState<string>(match.awayScore != null ? String(match.awayScore) : '')
  const [events, setEvents] = useState<MatchEvent[]>([])
  const [busy, setBusy] = useState(false)

  // Formulário de novo evento
  const [evTeam, setEvTeam] = useState<string>(match.homeTeamId ?? '')
  const [evType, setEvType] = useState<EventType>('goal')
  const [evPlayer, setEvPlayer] = useState<string>('')
  const [evMinute, setEvMinute] = useState<string>('')

  useEffect(() => {
    listEvents(match.championshipId).then((all) => setEvents(all.filter((e) => e.matchId === match.id)))
  }, [match.id, match.championshipId])

  const teamPlayers = players.filter((p) => p.teamId === evTeam)

  async function addNewEvent() {
    if (!evTeam) return
    const payload: NewEvent = {
      matchId: match.id,
      championshipId: match.championshipId,
      teamId: evTeam,
      playerId: evPlayer || undefined,
      type: evType,
      minute: evMinute ? Number(evMinute) : undefined,
    }
    const created = await addEvent(payload)
    setEvents((prev) => [...prev, created])
    setEvPlayer('')
    setEvMinute('')
  }

  async function removeEvent(id: string) {
    await deleteEvent(id)
    setEvents((prev) => prev.filter((e) => e.id !== id))
  }

  async function saveResult(status: 'finished' | 'scheduled') {
    setBusy(true)
    await updateMatch(match.id, {
      homeScore: homeScore === '' ? null : Number(homeScore),
      awayScore: awayScore === '' ? null : Number(awayScore),
      status,
    })
    setBusy(false)
    onSaved()
  }

  const playerName = (id?: string) => players.find((p) => p.id === id)?.name
  const teamShort = (id: string) => teams.find((t) => t.id === id)?.shortName || teams.find((t) => t.id === id)?.name

  return (
    <Modal title="Registrar resultado" onClose={onClose} wide>
      <div className="scoreboard">
        <div className="scoreboard__team">
          <TeamBadge team={home} size={48} />
          <span>{home?.name ?? 'A definir'}</span>
        </div>
        <div className="scoreboard__score">
          <input type="number" min={0} value={homeScore} onChange={(e) => setHomeScore(e.target.value)} aria-label="Gols mandante" />
          <span>×</span>
          <input type="number" min={0} value={awayScore} onChange={(e) => setAwayScore(e.target.value)} aria-label="Gols visitante" />
        </div>
        <div className="scoreboard__team">
          <TeamBadge team={away} size={48} />
          <span>{away?.name ?? 'A definir'}</span>
        </div>
      </div>

      {(match.homeTeamId && match.awayTeamId) && (
        <div className="events-box">
          <h4>Eventos da partida</h4>
          <div className="event-form">
            <select value={evTeam} onChange={(e) => { setEvTeam(e.target.value); setEvPlayer('') }}>
              {match.homeTeamId && <option value={match.homeTeamId}>{home?.name}</option>}
              {match.awayTeamId && <option value={match.awayTeamId}>{away?.name}</option>}
            </select>
            <select value={evType} onChange={(e) => setEvType(e.target.value as EventType)}>
              {(Object.keys(EVENT_LABELS) as EventType[]).map((t) => (
                <option key={t} value={t}>{EVENT_ICONS[t]} {EVENT_LABELS[t]}</option>
              ))}
            </select>
            <select value={evPlayer} onChange={(e) => setEvPlayer(e.target.value)}>
              <option value="">Jogador (opcional)</option>
              {teamPlayers.map((p) => (
                <option key={p.id} value={p.id}>{p.number ? `${p.number} · ` : ''}{p.name}</option>
              ))}
            </select>
            <input type="number" min={1} max={130} placeholder="min" value={evMinute} onChange={(e) => setEvMinute(e.target.value)} className="minute-input" />
            <Button variant="soft" type="button" onClick={() => void addNewEvent()}>Adicionar</Button>
          </div>

          {events.length > 0 && (
            <ul className="event-list">
              {events
                .slice()
                .sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999))
                .map((e) => (
                  <li key={e.id}>
                    <span className="event-list__icon">{EVENT_ICONS[e.type]}</span>
                    <span className="event-list__min">{e.minute != null ? `${e.minute}'` : '—'}</span>
                    <span className="event-list__txt">
                      {EVENT_LABELS[e.type]} · {playerName(e.playerId) ?? teamShort(e.teamId)}
                    </span>
                    <button className="icon-btn icon-btn--danger" onClick={() => void removeEvent(e.id)} title="Remover">✕</button>
                  </li>
                ))}
            </ul>
          )}
          <p className="hint">Dica: registre os gols para alimentar a artilharia automaticamente.</p>
        </div>
      )}

      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={() => void saveResult('scheduled')} disabled={busy}>
          Salvar como agendada
        </Button>
        <Button type="button" onClick={() => void saveResult('finished')} disabled={busy}>
          {busy ? 'Salvando…' : 'Encerrar partida'}
        </Button>
      </div>
    </Modal>
  )
}
