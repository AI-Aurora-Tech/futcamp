import { useEffect, useMemo, useState } from 'react'
import { defaultMatchWriter, type MatchWriter, type NewEvent } from '../services/matches'
import { buildSumulaHtml, downloadSumula, openSumula } from '../lib/sumula'
import { suspensosNaPartida, type Suspensao } from '../lib/suspensao'
import { flushPush } from '../services/push'
import {
  EVENT_LABELS,
  type Championship,
  type EventType,
  type LineupEntry,
  type Match,
  type MatchEvent,
  type MatchStatus,
  type Official,
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
  substitution: '🔁',
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
  allMatches = [],
  teams,
  players,
  officials,
  writer,
  readOnlySchedule = false,
  onClose,
  onSaved,
}: {
  championship: Championship
  match: Match
  /**
   * Todas as partidas do campeonato. É o que permite saber quem chega
   * suspenso NESTA rodada — a conta olha os jogos anteriores de cada time,
   * não só este.
   */
  allMatches?: Match[]
  teams: Team[]
  players: Player[]
  /** Presente apenas no modo administrador: habilita atribuir mesário. */
  officials?: Official[]
  /** Camada de escrita (admin por padrão; mesário injeta writer restrito). */
  writer?: MatchWriter
  /** Mesário não edita agendamento. */
  readOnlySchedule?: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const w = writer ?? defaultMatchWriter
  const home = teams.find((t) => t.id === match.homeTeamId)
  const away = teams.find((t) => t.id === match.awayTeamId)
  const [homeScore, setHomeScore] = useState<string>(match.homeScore != null ? String(match.homeScore) : '')
  const [awayScore, setAwayScore] = useState<string>(match.awayScore != null ? String(match.awayScore) : '')
  const [status, setStatus] = useState<MatchStatus>(match.status)
  const [scheduledAt, setScheduledAt] = useState<string>(toLocalInput(match.scheduledAt))
  const [venue, setVenue] = useState<string>(match.venue ?? '')
  const [refereeId, setRefereeId] = useState<string>(match.refereeId ?? '')
  const [officialId, setOfficialId] = useState<string>(match.officialId ?? '')
  const [winnerTeamId, setWinnerTeamId] = useState<string>(match.winnerTeamId ?? '')
  const [penHome, setPenHome] = useState<string>(match.penaltyHome != null ? String(match.penaltyHome) : '')
  const [penAway, setPenAway] = useState<string>(match.penaltyAway != null ? String(match.penaltyAway) : '')
  const [incidents, setIncidents] = useState<string>(match.incidents ?? '')
  const [events, setEvents] = useState<MatchEvent[]>([])
  /** Eventos do campeonato inteiro — a suspensão se conta pelas rodadas anteriores. */
  const [todosEventos, setTodosEventos] = useState<MatchEvent[]>([])
  const [lineup, setLineup] = useState<LineupEntry[]>(match.lineup ?? [])
  const [busy, setBusy] = useState(false)

  // Formulário de novo evento
  const [evTeam, setEvTeam] = useState<string>(match.homeTeamId ?? '')
  const [evType, setEvType] = useState<EventType>('goal')
  const [evPlayer, setEvPlayer] = useState<string>('')
  const [evPlayerIn, setEvPlayerIn] = useState<string>('')
  const [evDetail, setEvDetail] = useState<string>('')
  const [evMinute, setEvMinute] = useState<string>('')

  useEffect(() => {
    w.listEvents(match.championshipId).then((all) => {
      setTodosEventos(all)
      setEvents(all.filter((e) => e.matchId === match.id))
    })
  }, [match.id, match.championshipId, w])

  // Quem cumpre suspensão nesta partida. Fica fora da escalação: a regra do
  // campeonato é que o suspenso não recebe presença.
  const suspensos = useMemo(
    () =>
      suspensosNaPartida({
        match,
        matches: allMatches.length ? allMatches : [match],
        events: todosEventos,
        players,
        categories: championship.categories,
      }),
    [match, allMatches, todosEventos, players, championship.categories],
  )

  // Só atletas PRESENTES (na escalação salva) podem receber eventos.
  const presentIds = new Set(lineup.map((l) => l.playerId))
  const lineupNumber = new Map(lineup.map((l) => [l.playerId, l.number] as const))
  const teamPlayers = players.filter(
    (p) => p.teamId === evTeam && (p.role ?? 'atleta') === 'atleta' && presentIds.has(p.id),
  )
  /** Nº da camisa desta partida (cai para o nº de inscrição se não definido). */
  const shirtOf = (p: Player) => lineupNumber.get(p.id) ?? p.number
  const playerOption = (p: Player) => `${shirtOf(p) ? `${shirtOf(p)} · ` : ''}${p.name}`

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
      playerInId: evType === 'substitution' ? evPlayerIn || undefined : undefined,
      detail: evType === 'red_card' ? evDetail.trim() || undefined : undefined,
      type: evType,
      minute: evMinute ? Number(evMinute) : undefined,
    }
    const created = await w.addEvent(payload)
    setEvents((prev) => [...prev, created])
    if (evType === 'goal' || evType === 'own_goal') {
      bumpScore(evTeam, evType)
      // Avisa os times do mesmo grupo (fila criada por gatilho no banco).
      void flushPush(match.championshipId)
    }
    setEvPlayer('')
    setEvPlayerIn('')
    setEvDetail('')
    setEvMinute('')
  }

  async function removeEvent(id: string) {
    await w.deleteEvent(id)
    setEvents((prev) => prev.filter((e) => e.id !== id))
  }

  async function save(newStatus: MatchStatus) {
    // Ao vivo/encerrada, placar em branco vira 0 (entra na classificação);
    // agendada mantém null (ainda sem placar).
    const norm = (v: string) => (v === '' ? (newStatus === 'scheduled' ? null : 0) : Number(v))
    const patch: Partial<Match> = {
      homeScore: norm(homeScore),
      awayScore: norm(awayScore),
      status: newStatus,
    }
    if (!readOnlySchedule) {
      patch.scheduledAt = scheduledAt ? new Date(scheduledAt).toISOString() : undefined
      patch.venue = venue.trim() || undefined
      patch.refereeId = refereeId || undefined
    }
    if (officials) patch.officialId = officialId || undefined
    if (isKnockoutMatch) {
      patch.winnerTeamId = winnerTeamId || undefined
      patch.penaltyHome = penHome === '' ? null : Number(penHome)
      patch.penaltyAway = penAway === '' ? null : Number(penAway)
    }
    patch.incidents = incidents.trim() || undefined
    setBusy(true)
    await w.updateMatch(match.id, patch)
    setBusy(false)
    onSaved()
  }

  function generateSumula(action: 'print' | 'download') {
    const category = championship.categories.length === 1 ? championship.categories[0] : undefined
    const html = buildSumulaHtml({
      championship,
      match: {
        ...match,
        homeScore: homeScore === '' ? null : Number(homeScore),
        awayScore: awayScore === '' ? null : Number(awayScore),
        status,
        incidents: incidents.trim() || undefined,
      },
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
  const isKnockoutMatch = match.phase !== 'group'
  const isTied = homeScore !== '' && awayScore !== '' && Number(homeScore) === Number(awayScore)
  /** Quem venceu as cobranças, se já houver placar de pênaltis. */
  const penWinner =
    penHome !== '' && penAway !== '' && Number(penHome) !== Number(penAway)
      ? Number(penHome) > Number(penAway)
        ? home?.name
        : away?.name
      : null
  // A súmula sai ANTES do jogo (partida agendada) e, DEPOIS, somente quando a
  // partida for ENCERRADA. Durante o jogo (ao vivo) fica bloqueada.
  const canSumula = match.status === 'scheduled' || match.status === 'finished'
  const sumulaHint =
    match.status === 'live'
      ? '— bloqueada durante o jogo; libera quando a partida for encerrada'
      : match.status === 'finished'
        ? 'disponível (partida encerrada)'
        : 'disponível (antes do jogo)'

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

      {!readOnlySchedule && (
        <div className="schedule-row">
          <label className="field">
            <span className="field__label">Data e hora do jogo</span>
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Local</span>
            <select value={venue} onChange={(e) => setVenue(e.target.value)}>
              <option value="">— selecione o campo —</option>
              {(championship.venues ?? []).map((v) => (
                <option key={v.id} value={v.name}>{v.name}</option>
              ))}
              {venue && !(championship.venues ?? []).some((v) => v.name === venue) && (
                <option value={venue}>{venue}</option>
              )}
            </select>
            {(championship.venues ?? []).find((v) => v.name === venue)?.address && (
              <span className="field__hint">📍 {(championship.venues ?? []).find((v) => v.name === venue)!.address}</span>
            )}
          </label>
          <label className="field">
            <span className="field__label">Árbitro</span>
            <select value={refereeId} onChange={(e) => setRefereeId(e.target.value)}>
              <option value="">— sem árbitro —</option>
              {(championship.referees ?? []).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {officials && (
        <label className="field mesa-assign">
          <span className="field__label">Mesário responsável</span>
          <select value={officialId} onChange={(e) => setOfficialId(e.target.value)}>
            <option value="">— sem mesário —</option>
            {officials.map((o) => (
              <option key={o.id} value={o.id}>{o.name} ({o.username})</option>
            ))}
          </select>
        </label>
      )}

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

      {isKnockoutMatch && match.homeTeamId && match.awayTeamId && (
        <div className={`penalties ${isTied ? 'penalties--needed' : ''}`}>
          <div className="penalties__head">
            <strong>🥅 Disputa por pênaltis</strong>
            <span className="muted small">
              {isTied
                ? 'Jogo empatado: informe as cobranças para definir quem avança.'
                : 'Preencha só se o confronto for para os pênaltis.'}
            </span>
          </div>
          <div className="penalties__score">
            <span className="penalties__team">{home?.name ?? 'Mandante'}</span>
            <input
              type="number"
              min={0}
              max={30}
              value={penHome}
              onChange={(e) => setPenHome(e.target.value)}
              aria-label={`Pênaltis ${home?.name ?? 'mandante'}`}
              placeholder="—"
            />
            <span className="penalties__x">×</span>
            <input
              type="number"
              min={0}
              max={30}
              value={penAway}
              onChange={(e) => setPenAway(e.target.value)}
              aria-label={`Pênaltis ${away?.name ?? 'visitante'}`}
              placeholder="—"
            />
            <span className="penalties__team">{away?.name ?? 'Visitante'}</span>
          </div>
          {penWinner && (
            <p className="penalties__result">✅ {penWinner} avança nos pênaltis.</p>
          )}
        </div>
      )}

      {isKnockoutMatch && !readOnlySchedule && match.homeTeamId && match.awayTeamId && (
        <label className={`field ko-winner ${isTied && !winnerTeamId ? 'ko-winner--warn' : ''}`}>
          <span className="field__label">🏆 Classificado para a fase seguinte</span>
          <select value={winnerTeamId} onChange={(e) => setWinnerTeamId(e.target.value)}>
            <option value="">— pelo placar —</option>
            <option value={match.homeTeamId}>{home?.name}</option>
            <option value={match.awayTeamId}>{away?.name}</option>
          </select>
          <span className="field__hint">
            {penWinner
              ? 'Já definido pelos pênaltis acima — use aqui apenas para W.O. ou decisão do organizador.'
              : isTied
                ? 'Empate: informe as cobranças acima ou escolha aqui quem passou (W.O.).'
                : 'Deixe em “pelo placar” — use apenas em W.O. ou decisão do organizador.'}
          </span>
        </label>
      )}

      {match.homeTeamId && match.awayTeamId && (
        <PresencePanel
          home={home}
          away={away}
          players={players}
          lineup={lineup}
          suspensos={suspensos}
          onSave={async (entries) => {
            await w.setLineup(match.id, entries)
            setLineup(entries)
          }}
        />
      )}

      {match.homeTeamId && match.awayTeamId && (
        <div className="events-box">
          <h4>Eventos da partida {status === 'live' && <span className="live-dot">ao vivo</span>}</h4>
          {teamPlayers.length === 0 && (
            <p className="hint hint--warn">⚠️ Marque a presença dos atletas na escalação acima para habilitá-los aqui.</p>
          )}
          <div className="event-form">
            <select value={evTeam} onChange={(e) => { setEvTeam(e.target.value); setEvPlayer(''); setEvPlayerIn('') }}>
              {match.homeTeamId && <option value={match.homeTeamId}>{home?.name}</option>}
              {match.awayTeamId && <option value={match.awayTeamId}>{away?.name}</option>}
            </select>
            <select value={evType} onChange={(e) => setEvType(e.target.value as EventType)}>
              {(Object.keys(EVENT_LABELS) as EventType[]).map((t) => (
                <option key={t} value={t}>{EVENT_ICONS[t]} {EVENT_LABELS[t]}</option>
              ))}
            </select>
            {evType === 'substitution' ? (
              <>
                <select value={evPlayer} onChange={(e) => setEvPlayer(e.target.value)}>
                  <option value="">▼ Saiu</option>
                  {teamPlayers.map((p) => (
                    <option key={p.id} value={p.id}>{playerOption(p)}</option>
                  ))}
                </select>
                <select value={evPlayerIn} onChange={(e) => setEvPlayerIn(e.target.value)}>
                  <option value="">▲ Entrou</option>
                  {teamPlayers.map((p) => (
                    <option key={p.id} value={p.id}>{playerOption(p)}</option>
                  ))}
                </select>
              </>
            ) : (
              <select value={evPlayer} onChange={(e) => setEvPlayer(e.target.value)}>
                <option value="">Jogador (opcional)</option>
                {teamPlayers.map((p) => (
                  <option key={p.id} value={p.id}>{playerOption(p)}</option>
                ))}
              </select>
            )}
            <input type="number" min={1} max={130} placeholder="min" value={evMinute} onChange={(e) => setEvMinute(e.target.value)} className="minute-input" />
            {evType === 'red_card' && (
              <input className="event-detail" value={evDetail} onChange={(e) => setEvDetail(e.target.value)} placeholder="Motivo da expulsão" />
            )}
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
                      {EVENT_LABELS[e.type]} ·{' '}
                      {e.type === 'substitution'
                        ? `${playerName(e.playerId) ?? '—'} ▼  ▲ ${playerName(e.playerInId) ?? '—'}`
                        : playerName(e.playerId) ?? teamShort(e.teamId)}
                      {e.type === 'red_card' && e.detail ? ` — ${e.detail}` : ''}
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

      <label className="field incidents-field">
        <span className="field__label">📝 Relato de incidentes</span>
        <textarea
          rows={3}
          value={incidents}
          onChange={(e) => setIncidents(e.target.value)}
          placeholder="Atrasos, problemas de segurança, conduta de torcidas, etc."
        />
        <span className="field__hint">Salvo ao clicar em salvar/encerrar; aparece na súmula.</span>
      </label>

      <div className="sumula-row">
        <span className="muted small">Súmula {sumulaHint}</span>
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

/* -------------------------------------------------------------------------- */
/* Presença / escalação da partida                                             */
/* Admin ou mesário marca os atletas presentes e o nº da camisa do jogo.       */
/* Só os presentes ficam disponíveis para gols/cartões. Atrasado? Marque e     */
/* salve novamente — ele passa a fazer parte.                                   */
/* -------------------------------------------------------------------------- */
interface PresenceRow {
  present: boolean
  number: string
}

function PresencePanel({
  home,
  away,
  players,
  lineup,
  suspensos,
  onSave,
}: {
  home?: Team
  away?: Team
  players: Player[]
  lineup: LineupEntry[]
  /** Atletas que cumprem suspensão nesta partida — não podem ser marcados. */
  suspensos: Map<string, Suspensao>
  onSave: (entries: LineupEntry[]) => Promise<void>
}) {
  const athletes = players.filter((p) => (p.role ?? 'atleta') === 'atleta')

  const build = (): Record<string, PresenceRow> => {
    const present = new Set(lineup.map((l) => l.playerId))
    const num = new Map(lineup.map((l) => [l.playerId, l.number] as const))
    const draft: Record<string, PresenceRow> = {}
    for (const p of athletes) {
      const n = num.get(p.id) ?? p.number
      // Suspenso entra desmarcado mesmo se estava na escalação salva: pode ter
      // sido escalado antes de o cartão da rodada anterior ser lançado.
      draft[p.id] = { present: present.has(p.id) && !suspensos.has(p.id), number: n != null ? String(n) : '' }
    }
    return draft
  }

  const [draft, setDraft] = useState<Record<string, PresenceRow>>(build)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  /**
   * Ressincroniza quando a escalação salva muda por fora — e também quando a
   * lista de suspensos chega.
   *
   * Os eventos do campeonato são carregados depois da primeira renderização,
   * então na montagem `suspensos` ainda está vazio e o rascunho nasce com o
   * suspenso marcado. Sem esta dependência ele continuaria marcado na tela.
   * A chave é o conjunto de ids, não o Map: o Map é recriado a cada render.
   */
  const chaveSuspensos = [...suspensos.keys()].sort().join(',')
  useEffect(() => {
    setDraft(build())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineup, chaveSuspensos])

  const presentCount = athletes.filter((p) => draft[p.id]?.present).length

  /** Estava escalado e chegou suspenso: precisa sair, e o time precisa saber. */
  const retirados = athletes.filter(
    (p) => suspensos.has(p.id) && lineup.some((l) => l.playerId === p.id),
  )

  function toggle(id: string) {
    if (suspensos.has(id)) return
    setDraft((d) => ({ ...d, [id]: { ...d[id], present: !d[id]?.present } }))
    setMsg(null)
  }
  function setNumber(id: string, v: string) {
    setDraft((d) => ({ ...d, [id]: { ...d[id], number: v.replace(/\D/g, '').slice(0, 3) } }))
    setMsg(null)
  }

  async function save() {
    setBusy(true)
    const entries: LineupEntry[] = athletes
      .filter((p) => draft[p.id]?.present && !suspensos.has(p.id))
      .map((p) => ({ playerId: p.id, number: draft[p.id].number ? Number(draft[p.id].number) : undefined }))
    try {
      await onSave(entries)
      setMsg('Presença salva ✅')
    } catch {
      setMsg('Não foi possível salvar a presença.')
    } finally {
      setBusy(false)
    }
  }

  // IMPORTANTE: função que RETORNA os elementos (não um componente aninhado).
  // Definir um componente dentro do render faria o React remontar os inputs a
  // cada tecla — foco perdido ao digitar o 2º dígito da camisa.
  const renderTeamColumn = (team?: Team) => {
    const list = athletes.filter((p) => p.teamId === team?.id)
    return (
      <div className="presence-col">
        <div className="presence-col__head"><TeamBadge team={team} size={22} /> <span>{team?.name ?? '—'}</span></div>
        {list.length === 0 ? (
          <p className="muted small">Nenhum atleta inscrito.</p>
        ) : (
          <ul className="presence-list">
            {list.map((p) => {
              const row = draft[p.id] ?? { present: false, number: '' }
              const susp = suspensos.get(p.id)
              return (
                <li
                  key={p.id}
                  className={`presence-item ${row.present ? 'is-present' : ''} ${susp ? 'is-suspenso' : ''}`}
                >
                  <label className="presence-item__check">
                    <input
                      type="checkbox"
                      checked={row.present}
                      disabled={Boolean(susp)}
                      onChange={() => toggle(p.id)}
                    />
                    <span className="presence-item__label">
                      <span className="presence-item__nome">{p.name}</span>
                      {susp && (
                        <span className="susp-tag" title="Cumpre suspensão nesta partida">
                          {susp.motivo}
                        </span>
                      )}
                    </span>
                  </label>
                  <input
                    className="presence-item__num"
                    inputMode="numeric"
                    placeholder="nº"
                    value={row.number}
                    onChange={(e) => setNumber(p.id, e.target.value)}
                    disabled={!row.present || Boolean(susp)}
                    aria-label={`Número de ${p.name}`}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="presence-box">
      <button type="button" className="presence-box__toggle" onClick={() => setOpen((o) => !o)}>
        <span>👥 Presença / escalação <span className="presence-box__count">{presentCount} presente(s)</span></span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="presence-box__body">
          <p className="hint">
            Marque quem está presente e informe o número da camisa desta partida. Só os presentes recebem gols e cartões.
            Chegou atrasado? Marque e salve novamente.
          </p>

          {suspensos.size > 0 && (
            <p className="hint hint--warn">
              🚫 {suspensos.size} atleta(s) cumprem suspensão nesta partida e não podem ser escalados
              {retirados.length > 0 && (
                <>
                  {' '}— <b>{retirados.map((p) => p.name).join(', ')}</b>{' '}
                  {retirados.length === 1 ? 'estava' : 'estavam'} na escalação e{' '}
                  {retirados.length === 1 ? 'foi retirado' : 'foram retirados'}. Salve para confirmar
                </>
              )}
              .
            </p>
          )}

          <div className="presence-grid">
            {renderTeamColumn(home)}
            {renderTeamColumn(away)}
          </div>
          <div className="presence-box__actions">
            {msg && <span className="reg__msg">{msg}</span>}
            <Button variant="soft" type="button" onClick={() => void save()} disabled={busy}>
              {busy ? 'Salvando…' : 'Salvar presentes'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
