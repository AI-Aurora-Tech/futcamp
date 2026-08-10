import { useEffect, useState } from 'react'
import { addEvent, deleteEvent, listEvents, updateMatch, type NewEvent } from '../services/matches'
import { buildSumulaHtml, downloadSumula, openSumula } from '../lib/sumula'
import { matchRegistrationClosed } from '../lib/matchWindow'
import {
  EVENT_LABELS,
  type Championship,
  type EventType,
  type Match,
  type MatchEvent,
  type MatchStatus,
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

/** ISO → valor para <input type="datetime-local"> (horário local). */
function toLocalInput(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function MatchResultModal({
  championship,
  match,
  teams,
  players,
  onClose,
  onSaved,
}: {
  championship: Championship
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
  const [status, setStatus] = useState<MatchStatus>(match.status)
  const [scheduledAt, setScheduledAt] = useState<string>(toLocalInput(match.scheduledAt))
  const [venue, setVenue] = useState<string>(match.venue ?? '')
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

  const teamPlayers = players.filter((p) => p.teamId === evTeam && (p.role ?? 'atleta') === 'atleta')

  function bumpScore(teamId: string, type: EventType) {
    // Placar automático ao vivo: gol soma para o time; gol contra soma ao adversário.
    const forHome =
      (type === 'goal' && teamId === match.homeTeamId) ||
      (type === 'own_goal' && teamId === match.awayTeamId)
    const forAway =
      (type === 'goal' && teamId === match.awayTeamId) ||
      (type === 'own_goal' && teamId === match.homeTeamId)
    if (forHome) setHomeScore((s) => String((Number(s) || 0) + 1))
    if (forAway) setAwayScore((s) => String((Number(s) || 0) + 1))
  }

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
    if (evType === 'goal' || evType === 'own_goal') bumpScore(evTeam, evType)
    setEvPlayer('')
    setEvMinute('')
  }

  async function removeEvent(id: string) {
    await deleteEvent(id)
    setEvents((prev) => prev.filter((e) => e.id !== id))
  }

  async function save(newStatus: MatchStatus) {
    // Ao vivo/encerrada, placar em branco vira 0 (entra na classificação);
    // agendada mantém null (ainda sem placar).
    const norm = (v: string) => (v === '' ? (newStatus === 'scheduled' ? null : 0) : Number(v))
    setBusy(true)
    await updateMatch(match.id, {
      homeScore: norm(homeScore),
      awayScore: norm(awayScore),
      status: newStatus,
      scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      venue: venue.trim() || undefined,
    })
    setBusy(false)
    onSaved()
  }

  function generateSumula(action: 'print' | 'download') {
    const category = championship.categories.length === 1 ? championship.categories[0] : undefined
    const html = buildSumulaHtml({
      championship,
      match: { ...match, homeScore: homeScore === '' ? null : Number(homeScore), awayScore: awayScore === '' ? null : Number(awayScore), status },
      teams,
      players,
      events,
      category,
    })
    if (action === 'print') openSumula(html)
    else downloadSumula(`sumula-${home?.shortName || 'mandante'}-x-${away?.shortName || 'visitante'}.html`, html)
  }

  const playerName = (id?: string) => players.find((p) => p.id === id)?.name
  const teamShort = (id: string) => teams.find((t) => t.id === id)?.shortName || teams.find((t) => t.id === id)?.name
  const canSumula =
    status === 'live' ||
    status === 'finished' ||
    matchRegistrationClosed(match, championship.registrationCutoffHours)

  return (
    <Modal title="Registrar resultado" onClose={onClose} wide>
      <div className="status-tabs">
        {(['scheduled', 'live', 'finished'] as MatchStatus[]).map((s) => (
          <button
            key={s}
            type="button"
            className={`status-tab ${status === s ? 'is-active' : ''} status-tab--${s}`}
            onClick={() => setStatus(s)}
          >
            {s === 'scheduled' ? 'Agendada' : s === 'live' ? '● Ao vivo' : 'Encerrada'}
          </button>
        ))}
      </div>

      <div className="schedule-row">
        <label className="field">
          <span className="field__label">Data e hora do jogo</span>
          <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Local</span>
          <input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Estádio / quadra" />
        </label>
      </div>

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

      {match.homeTeamId && match.awayTeamId && (
        <div className="events-box">
          <h4>Eventos da partida {status === 'live' && <span className="live-dot">ao vivo</span>}</h4>
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
          <p className="hint">
            Gols e cartões alimentam automaticamente a classificação e as estatísticas. No modo “ao vivo”, o placar soma sozinho a cada gol.
          </p>
        </div>
      )}

      <div className="sumula-row">
        <span className="muted small">
          Súmula {canSumula ? 'disponível' : '— liberada quando as inscrições da partida encerrarem'}
        </span>
        <div className="sumula-row__actions">
          <Button variant="ghost" type="button" disabled={!canSumula} onClick={() => generateSumula('print')}>🖨️ Imprimir</Button>
          <Button variant="ghost" type="button" disabled={!canSumula} onClick={() => generateSumula('download')}>⬇ Baixar súmula</Button>
        </div>
      </div>

      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={() => void save('scheduled')} disabled={busy}>Salvar agendada</Button>
        <Button variant="soft" type="button" onClick={() => void save('live')} disabled={busy}>● Salvar ao vivo</Button>
        <Button type="button" onClick={() => void save('finished')} disabled={busy}>
          {busy ? 'Salvando…' : 'Encerrar partida'}
        </Button>
      </div>
    </Modal>
  )
}
