import { useMemo, useState } from 'react'
import {
  createKnockoutStage,
  applyFixturePlan,
  createMatch,
  generateGroups,
  generateKnockout,
  generateLeague,
} from '../services/matches'
import { updateChampionship } from '../services/championships'
import { flushWhatsapp } from '../services/whatsapp'
import { flushPush } from '../services/push'
import { useAuth } from '../context/AuthContext'
import {
  hasKnockoutStage,
  isUnresolvedTie,
  KNOCKOUT_ORDER,
  KNOCKOUT_ROUND_BASE,
} from '../lib/knockout'
import {
  allGroupStagesComplete,
  groupStagesOf,
  grupoDoJogo,
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
import { Button, EmptyState, Field, Modal, TeamBadge } from './ui'
import { MatchResultModal } from './MatchResultModal'
import { MatchScheduler } from './MatchScheduler'
import { planejarTabela } from '../lib/tabela'

export function MatchesPanel({
  championship,
  teams,
  players,
  matches,
  events = [],
  officials,
  categoryId,
  onChange,
}: {
  championship: Championship
  teams: Team[]
  players: Player[]
  matches: Match[]
  events?: MatchEvent[]
  officials: Official[]
  /**
   * Categoria em foco. As partidas geradas nascem nela — é o que separa a
   * tabela do Sub-11 da do Sub-15, com os seus próprios locais e horários.
   */
  categoryId?: string
  onChange: () => void
}) {
  const { isMaster } = useAuth()
  const [editing, setEditing] = useState<Match | null>(null)
  const [generating, setGenerating] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [adding, setAdding] = useState(false)
  const isKnockout = championship.format === 'knockout'
  const isGroups = championship.format === 'groups_knockout'
  // Jogos já encerrados nunca são apagados por "Gerar tabela".
  const finishedCount = matches.filter((m) => m.status === 'finished').length
  const groupMatchesOnly = matches.filter((m) => m.phase === 'group')
  const knockoutMatches = matches.filter((m) => m.phase !== 'group')
  const stages = groupStagesOf(championship)
  // Fase de grupos em curso: a última que já tem jogos criados.
  const currentStage = Math.max(1, ...groupMatchesOnly.map(matchStage))
  const remaining = matchesOfStage(matches, currentStage).filter((m) => m.status !== 'finished').length
  const pendingStage = nextGroupStageToCreate(championship, matches)
  /**
   * Rótulo da fase (1-based) tolerante a campeonatos sem fases configuradas —
   * um índice inexistente não pode derrubar a tela.
   */
  const stageLabel = (stage: number): string => {
    const cfg = stages[stage - 1]
    return cfg ? stageName(cfg, stage - 1, stages.length) : 'fase de classificação'
  }
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
    // Já há jogos: completa a tabela com o que falta, sem apagar resultados.
    if (matches.length > 0) {
      await completeTable()
      return
    }
    setGenerating(true)
    try {
      const force = isMaster
      if (isKnockout) {
        await generateKnockout(championship.id, teams.map((t) => t.id), championship.thirdPlace, force, categoryId)
      } else if (isGroups) {
        const groups: Record<string, string[]> = {}
        for (const t of teams) {
          const g = t.group || 'A'
          ;(groups[g] ??= []).push(t.id)
        }
        await generateGroups(championship.id, groups, championship.doubleRound, force, categoryId)
      } else {
        await generateLeague(
          championship.id,
          teams.map((t) => t.id),
          championship.doubleRound,
          force,
          categoryId,
          championship.leagueMatchesPerTeam,
        )
      }
      onChange()
      setScheduling(true) // abre o agendador para informar data/hora jogo a jogo
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Não foi possível gerar a tabela.')
    } finally {
      setGenerating(false)
    }
  }

  /**
   * "Gerar tabela" com jogos já criados: mantém os jogos realizados, confere os
   * não realizados contra as regras do campeonato e cria os confrontos que
   * faltam (ver lib/tabela.ts).
   */
  async function completeTable() {
    if (isKnockout) {
      if (finishedCount > 0) {
        alert(
          'No mata-mata os vencedores avançam sozinhos para a fase seguinte — não há jogos a gerar.\n\n' +
            'Para um confronto novo, use “Adicionar jogo”.',
        )
        return
      }
      if (!confirm('Nenhum jogo foi realizado ainda. Refazer o chaveamento com os times atuais?')) return
      setGenerating(true)
      try {
        await generateKnockout(championship.id, teams.map((t) => t.id), championship.thirdPlace, false, categoryId)
        onChange()
      } catch (e) {
        alert(e instanceof Error ? e.message : 'Não foi possível gerar a tabela.')
      } finally {
        setGenerating(false)
      }
      return
    }
    if (knockoutMatches.length > 0 || groupMatchesOnly.some((m) => matchStage(m) > 1)) {
      alert(
        'A fase de classificação inicial já foi encerrada — as fases seguintes são montadas ' +
          'automaticamente com os classificados. Para um jogo avulso, use “Adicionar jogo”.',
      )
      return
    }

    const plano = planejarTabela(championship, teams, matches, categoryId)
    if (plano.criar.length === 0 && plano.remover.length === 0 && plano.corrigirGrupo.length === 0) {
      alert('A tabela já está completa: todos os confrontos previstos pelas regras do campeonato existem.')
      return
    }
    const linhas = [
      `✅ ${plano.realizados} jogo(s) já realizado(s) continuam como estão.`,
      plano.mantidos > 0 && `📅 ${plano.mantidos} jogo(s) ainda não realizado(s) continuam (com data e local).`,
      plano.criar.length > 0 && `＋ ${plano.criar.length} jogo(s) que faltam serão criados.`,
      plano.corrigirGrupo.length > 0 &&
        `🔁 ${plano.corrigirGrupo.length} jogo(s) estavam no grupo errado e serão movidos para o grupo atual dos times.`,
      plano.remover.length > 0 &&
        `🗑 ${plano.remover.length} jogo(s) não realizado(s) serão removidos por não valerem mais pelas regras (grupo, turno/returno ou time fora da categoria).`,
    ].filter(Boolean)
    if (!confirm(`Gerar a tabela com os jogos que ainda não foram realizados?\n\n${linhas.join('\n')}`)) return

    setGenerating(true)
    try {
      await applyFixturePlan(plano, championship.id)
      onChange()
      if (plano.criar.length > 0) setScheduling(true) // datas e horários dos jogos novos
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Não foi possível gerar a tabela.')
    } finally {
      setGenerating(false)
    }
  }

  // Agrupa por rodada (primeira fase) e por fase (mata-mata).
  // Com grupos, a lista pode ser vista por grupo (padrão) ou por rodada.
  const grupoDoTime = useMemo(() => new Map(teams.map((t) => [t.id, t.group] as const)), [teams])
  const temGrupos = new Set(groupMatchesOnly.map((m) => grupoDoJogo(m, grupoDoTime)).filter(Boolean)).size > 1
  const [porGrupo, setPorGrupo] = useState(true)
  const verPorGrupo = temGrupos && porGrupo
  const sections = useMemo(
    () => (verPorGrupo ? matchSectionsByGroup(matches, teams) : matchSections(matches)),
    [matches, teams, verPorGrupo],
  )
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
          <Button variant="soft" onClick={() => setAdding(true)} disabled={teams.length < 2}>
            ＋ Adicionar jogo
          </Button>
          {canCreateKnockout && (
            <Button onClick={() => void createKnockout()} disabled={generating}>
              {generating ? 'Montando…' : '🏆 Criar mata-mata'}
            </Button>
          )}
          <Button
            onClick={() => void generate()}
            disabled={generating}
            title={
              matches.length
                ? 'Completa a tabela com os jogos que ainda não foram realizados, pelas regras do campeonato. Jogos já realizados não são alterados.'
                : undefined
            }
          >
            {generating ? 'Gerando…' : matches.length ? '⚙ Gerar tabela' : '⚙ Gerar tabela de jogos'}
          </Button>
        </div>
      </div>

      {!isKnockout && hasKnockoutStage(championship) && groupMatchesOnly.length > 0 && (
        <p className={`ko-note ${knockoutMatches.length ? 'ko-note--done' : ''}`}>
          {knockoutMatches.length
            ? '🏆 Mata-mata criado com os classificados. Ao encerrar cada confronto, o vencedor avança sozinho para a fase seguinte.'
            : remaining > 0
              ? `🏁 Faltam ${remaining} jogo(s) para encerrar a fase atual (${stageLabel(currentStage)}).` +
                (currentStage < stages.length
                  ? ' Depois, a fase seguinte é criada automaticamente com os classificados.'
                  : ' Depois, o mata-mata é criado automaticamente com os classificados.')
              : pendingStage != null
                ? `✅ Fase encerrada (${stageLabel(pendingStage - 1)}) — montando a ${stageLabel(pendingStage)} com os classificados…`
                : '🏆 Fase de classificação encerrada — montando o mata-mata com os classificados…'}
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
          {temGrupos && (
            <div className="view-switch" role="group" aria-label="Organizar jogos">
              <button type="button" className={`view-switch__btn ${porGrupo ? 'is-active' : ''}`} onClick={() => setPorGrupo(true)}>
                Por grupo
              </button>
              <button type="button" className={`view-switch__btn ${!porGrupo ? 'is-active' : ''}`} onClick={() => setPorGrupo(false)}>
                Por rodada
              </button>
            </div>
          )}
          {sections.map((sec) => {
            const roundNo = sec.byGroup ? undefined : sec.matches[0]?.round
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
                    <MatchRow
                      key={m.id}
                      match={m}
                      teams={teams}
                      onClick={() => setEditing(m)}
                      showSchedule
                      venues={championship.venues}
                      // Na visão por grupo os jogos vêm pela situação, não
                      // pela rodada — então a rodada vai no próprio jogo.
                      roundLabel={
                        sec.byGroup
                          ? `Rodada ${m.round}${closedRounds.has(m.round) ? ' · 🔒 inscrições encerradas' : ''}`
                          : undefined
                      }
                    />
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
          allMatches={matches}
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

      {adding && (
        <AddMatchModal
          championship={championship}
          teams={teams}
          matches={matches}
          officials={officials}
          categoryId={categoryId}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            onChange()
          }}
        />
      )}
    </section>
  )
}

/**
 * Criação MANUAL de uma partida — para montar a tabela à mão ou acrescentar um
 * jogo avulso, além da geração automática. O placar e os eventos são lançados
 * depois, na própria partida.
 */
function AddMatchModal({
  championship,
  teams,
  matches,
  officials,
  categoryId,
  onClose,
  onSaved,
}: {
  championship: Championship
  teams: Team[]
  matches: Match[]
  officials: Official[]
  categoryId?: string
  onClose: () => void
  onSaved: () => void
}) {
  const grupos = [...new Set(teams.map((t) => t.group).filter((g): g is string => !!g))].sort()
  const [phase, setPhase] = useState<MatchPhase>('group')
  const [home, setHome] = useState('')
  const [away, setAway] = useState('')
  const [group, setGroup] = useState(grupos[0] ?? '')
  const [scheduledAt, setScheduledAt] = useState('')
  const [venue, setVenue] = useState('')
  const [refereeId, setRefereeId] = useState('')
  const [officialId, setOfficialId] = useState('')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const isGroupPhase = phase === 'group'
  const nomeTime = (id: string) => teams.find((t) => t.id === id)?.name ?? ''

  // Na fase de grupos, só entram no confronto os times do grupo escolhido.
  const timesDisponiveis =
    isGroupPhase && group ? teams.filter((t) => t.group === group) : teams

  // Jogos de cada time na 1ª fase de grupos — é o que define a rodada.
  const jogosPorTime = useMemo(() => {
    const cont = new Map<string, number>()
    for (const m of matches) {
      if (m.phase !== 'group' || matchStage(m) !== 1) continue
      for (const id of [m.homeTeamId, m.awayTeamId]) {
        if (id) cont.set(id, (cont.get(id) ?? 0) + 1)
      }
    }
    return cont
  }, [matches])
  const jogosDe = (id: string) => jogosPorTime.get(id) ?? 0

  // Times com menos jogos primeiro: são eles que ainda faltam na rodada atual.
  const opcoesTimes = [...timesDisponiveis].sort(
    (a, b) => jogosDe(a.id) - jogosDe(b.id) || a.name.localeCompare(b.name),
  )

  /**
   * Rodada gerada automaticamente pelo time com MAIS partidas: escolhidos os
   * times, é a próxima rodada de quem jogou mais entre os dois (assim nenhum
   * deles joga duas vezes na mesma rodada); antes disso, a do time do grupo
   * com mais partidas.
   */
  const base = home || away ? [home, away].filter(Boolean) : opcoesTimes.map((t) => t.id)
  const round = Math.max(0, ...base.map(jogosDe)) + 1

  function trocarGrupo(g: string) {
    setGroup(g)
    // Times de outro grupo deixam de valer para o confronto.
    const doGrupo = (id: string) => teams.some((t) => t.id === id && t.group === g)
    if (home && !doGrupo(home)) setHome('')
    if (away && !doGrupo(away)) setAway('')
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!home || !away) return setErro('Escolha o time mandante e o visitante.')
    if (home === away) return setErro('O mandante e o visitante devem ser times diferentes.')
    // Fase eliminatória entra fora da numeração das rodadas da 1ª fase.
    const koIdx = KNOCKOUT_ORDER.indexOf(phase)
    const rodada = isGroupPhase
      ? round
      : KNOCKOUT_ROUND_BASE + (phase === 'third_place' ? KNOCKOUT_ORDER.length : Math.max(0, koIdx))
    setBusy(true)
    try {
      await createMatch({
        championshipId: championship.id,
        categoryId,
        round: rodada,
        phase,
        stage: isGroupPhase ? 1 : undefined,
        group: isGroupPhase && group ? group : undefined,
        homeTeamId: home,
        awayTeamId: away,
        homeScore: null,
        awayScore: null,
        status: 'scheduled',
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        venue: venue.trim() || undefined,
        refereeId: refereeId || undefined,
        officialId: officialId || undefined,
      })
      // Com data definida, o jogo já nasce "marcado": os avisos (push/WhatsApp)
      // são enfileirados pelo gatilho — aqui a entrega começa na hora.
      if (scheduledAt) {
        void flushPush(championship.id)
        void flushWhatsapp(championship.id)
      }
      onSaved()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível criar o jogo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Adicionar jogo" onClose={onClose} dismissable={false}>
      <form onSubmit={salvar} className="form-grid">
        <p className="field__hint">
          Crie uma partida na mão — dá para montar a tabela jogo a jogo em vez de gerar tudo
          automaticamente. Placar, data e local são informados depois.
        </p>

        <Field label="Fase">
          <select value={phase} onChange={(e) => setPhase(e.target.value as MatchPhase)}>
            {(Object.keys(PHASE_LABELS) as MatchPhase[]).map((p) => (
              <option key={p} value={p}>{PHASE_LABELS[p]}</option>
            ))}
          </select>
        </Field>

        {isGroupPhase && (
          <div className="form-row">
            {grupos.length > 0 && (
              <Field label="Grupo">
                <select value={group} onChange={(e) => trocarGrupo(e.target.value)}>
                  {grupos.map((g) => (
                    <option key={g} value={g}>Grupo {g}</option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Rodada" hint="Automática, pelo time com mais partidas.">
              <input type="number" value={round} readOnly disabled />
            </Field>
          </div>
        )}

        <div className="form-row">
          <Field label="Time mandante">
            <select value={home} onChange={(e) => setHome(e.target.value)}>
              <option value="">Escolha…</option>
              {opcoesTimes.map((t) => (
                <option key={t.id} value={t.id} disabled={t.id === away}>
                  {t.name}{isGroupPhase ? ` (${jogosDe(t.id)} jogo${jogosDe(t.id) === 1 ? '' : 's'})` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Time visitante">
            <select value={away} onChange={(e) => setAway(e.target.value)}>
              <option value="">Escolha…</option>
              {opcoesTimes.map((t) => (
                <option key={t.id} value={t.id} disabled={t.id === home}>
                  {t.name}{isGroupPhase ? ` (${jogosDe(t.id)} jogo${jogosDe(t.id) === 1 ? '' : 's'})` : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {home && away && home !== away && (
          <p className="field__hint">🆚 <b>{nomeTime(home)}</b> × <b>{nomeTime(away)}</b></p>
        )}

        <div className="form-row">
          <Field label="Data e hora">
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </Field>
          <Field label="Local">
            <select value={venue} onChange={(e) => setVenue(e.target.value)}>
              <option value="">— sem local —</option>
              {(championship.venues ?? []).map((v) => (
                <option key={v.id} value={v.name}>{v.name}{v.address ? ` — ${v.address}` : ''}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="form-row">
          <Field label="Árbitro">
            <select value={refereeId} onChange={(e) => setRefereeId(e.target.value)}>
              <option value="">— sem árbitro —</option>
              {(championship.referees ?? []).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Mesário">
            <select value={officialId} onChange={(e) => setOfficialId(e.target.value)}>
              <option value="">— sem mesário —</option>
              {officials.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </Field>
        </div>

        {erro && <p className="auth-error">{erro}</p>}

        <div className="form-actions">
          <Button variant="ghost" type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Criando…' : 'Adicionar jogo'}</Button>
        </div>
      </form>
    </Modal>
  )
}

export function MatchRow({
  match,
  teams,
  onClick,
  showSchedule,
  venues,
  roundLabel,
}: {
  match: Match
  teams: Team[]
  onClick?: () => void
  showSchedule?: boolean
  venues?: Venue[]
  /** Rodada do jogo, quando a lista não está agrupada por rodada. */
  roundLabel?: string
}) {
  const home = teams.find((t) => t.id === match.homeTeamId)
  const away = teams.find((t) => t.id === match.awayTeamId)
  const live = match.status === 'live'
  // Jogo encerrado ganha cor própria na lista do administrador e do mesário.
  const finished = match.status === 'finished'
  // Ainda por jogar: azul com data e hora marcadas, cinza sem.
  const scheduled = !finished && !live && Boolean(match.scheduledAt)
  const unscheduled = !finished && !live && !match.scheduledAt
  const hasScore = match.homeScore != null && match.awayScore != null
  const showScore = finished || live
  const schedule = [roundLabel, showSchedule ? matchScheduleText(match, venues) : null]
    .filter(Boolean)
    .join(' · ')
  return (
    <button
      className={`match-row ${onClick ? 'is-clickable' : ''} ${live ? 'is-live' : ''} ${finished ? 'is-finished' : ''} ${scheduled ? 'is-scheduled' : ''} ${unscheduled ? 'is-unscheduled' : ''}`}
      onClick={onClick}
      disabled={!onClick}
      title={finished ? 'Partida encerrada' : scheduled ? 'Data e hora marcadas' : unscheduled ? 'Sem data e hora' : undefined}
    >
      <span className="match-row__side match-row__side--home">
        <span className="match-row__name" title={home?.name}>{home?.name ?? 'A definir'}</span>
        <TeamBadge team={home} size={26} />
      </span>
      <span className={`match-row__score ${showScore && hasScore ? 'is-played' : ''}`}>
        {live && <span className="live-dot live-dot--sm">ao vivo</span>}
        {finished && <span className="finished-tag">encerrado</span>}
        {showScore && hasScore ? `${match.homeScore} × ${match.awayScore}` : 'vs'}
        {match.penaltyHome != null && match.penaltyAway != null && (
          <span className="match-row__pens" title="Disputa por pênaltis">
            {match.penaltyHome} × {match.penaltyAway} pên
          </span>
        )}
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
  /** Seção de um grupo: os jogos vêm em ordem de rodada, com a rodada indicada. */
  byGroup?: boolean
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
/**
 * Ordem dos jogos dentro da rodada ou do grupo: encerrados, ao vivo, com data
 * e hora marcadas e, por último, os ainda sem data. Dentro de cada situação,
 * pela data (quando houver) e pela rodada.
 */
function situacao(m: Match): number {
  if (m.status === 'finished') return 0
  if (m.status === 'live') return 1
  return m.scheduledAt ? 2 : 3
}

export function porSituacao(a: Match, b: Match): number {
  return (
    situacao(a) - situacao(b) ||
    (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '') ||
    a.round - b.round ||
    a.createdAt.localeCompare(b.createdAt)
  )
}

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
      matches: [...byRound.get(r)!].sort(porSituacao),
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

/**
 * Seções agrupadas por GRUPO: cada grupo (de cada fase de grupos) com os seus
 * jogos em ordem de rodada e, depois, as fases do mata-mata.
 */
export function matchSectionsByGroup(matches: Match[], teams: Team[]): Section[] {
  const grupoDoTime = new Map(teams.map((t) => [t.id, t.group] as const))
  const deGrupo = matches.filter((m) => m.phase === 'group')
  const multiStage = new Set(deGrupo.map(matchStage)).size > 1
  const byGroup = new Map<string, Match[]>()
  for (const m of deGrupo) {
    const k = `${matchStage(m)}|${grupoDoJogo(m, grupoDoTime) ?? ''}`
    if (!byGroup.has(k)) byGroup.set(k, [])
    byGroup.get(k)!.push(m)
  }
  const grupos: Section[] = [...byGroup.entries()]
    .sort(([a], [b]) => {
      const [sa, ga] = a.split('|')
      const [sb, gb] = b.split('|')
      return Number(sa) - Number(sb) || ga.localeCompare(gb)
    })
    .map(([k, list]) => {
      const [stage, g] = k.split('|')
      const nome = g ? `Grupo ${g}` : 'Sem grupo'
      return {
        key: `g${k}`,
        title: multiStage ? `${stage}ª fase · ${nome}` : nome,
        matches: [...list].sort(porSituacao),
        isKnockout: false,
        byGroup: true,
      }
    })
  const fases = matchSections(matches.filter((m) => m.phase !== 'group'))
  return [...grupos, ...fases]
}
