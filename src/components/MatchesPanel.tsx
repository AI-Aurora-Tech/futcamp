import { useMemo, useState } from 'react'
import {
  createKnockoutFromPairs,
  createMatch,
  updateKnockoutPairs,
  generateGroups,
  generateKnockout,
  generateLeague,
} from '../services/matches'
import { flushWhatsapp } from '../services/whatsapp'
import { flushPush } from '../services/push'
import { useAuth } from '../context/AuthContext'
import {
  hasKnockoutStage,
  isUnresolvedTie,
  KNOCKOUT_ORDER,
  KNOCKOUT_ROUND_BASE,
  phaseForPairs,
  resolveBracketTeams,
} from '../lib/knockout'
import { BracketView } from './BracketView'
import {
  allGroupStagesComplete,
  groupStagesOf,
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
  /** Montagem/edição manual dos confrontos do mata-mata. */
  const [koSetup, setKoSetup] = useState<'create' | 'edit' | null>(null)
  const isKnockout = championship.format === 'knockout'
  const isGroups = championship.format === 'groups_knockout'
  // Regerar a tabela apaga TODAS as partidas. Com jogos já encerrados isso
  // levaria junto placares, gols, cartões e súmulas — então fica bloqueado.
  const finishedCount = matches.filter((m) => m.status === 'finished').length
  const regenBlocked = finishedCount > 0 && !isMaster
  const groupMatchesOnly = matches.filter((m) => m.phase === 'group')
  const knockoutMatches = matches.filter((m) => m.phase !== 'group')
  /** Confrontos da primeira fase do mata-mata (oitavas, quartas…). */
  const primeiraFaseKo = (() => {
    const fase = KNOCKOUT_ORDER.find((p) => knockoutMatches.some((m) => m.phase === p))
    return fase ? knockoutMatches.filter((m) => m.phase === fase) : []
  })()
  /**
   * A primeira fase acabou (todos os jogos dela encerrados): a tabela não se
   * regera mais — o botão some. No mata-mata puro, a "primeira fase" é a
   * rodada inicial do chaveamento.
   */
  const primeiraFase = isKnockout ? primeiraFaseKo : groupMatchesOnly
  const primeiraFaseEncerrada = primeiraFase.length > 0 && primeiraFase.every((m) => m.status === 'finished')
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
  // Montar o mata-mata à mão: liberado assim que há jogos da 1ª fase (a
  // sugestão usa a classificação do momento) e ainda não há mata-mata.
  const canCreateKnockout =
    !isKnockout &&
    hasKnockoutStage(championship) &&
    knockoutMatches.length === 0 &&
    groupMatchesOnly.length > 0
  const faseCompleta = allGroupStagesComplete(championship, matches)
  // Editar os confrontos: enquanto nenhum jogo da 1ª fase do mata-mata começou.
  const canEditKnockout =
    primeiraFaseKo.length > 0 && primeiraFaseKo.every((m) => m.status === 'scheduled')
  const pendingTies = matches.filter(isUnresolvedTie)

  async function generate() {
    if (teams.length < 2) {
      alert('Cadastre pelo menos 2 times para gerar a tabela.')
      return
    }
    if (finishedCount > 0) {
      if (!isMaster) {
        alert(
          `Não é possível regerar a tabela: ${finishedCount} jogo(s) já foram encerrados.\n\n` +
            'Regerar apagaria placares, gols, cartões e súmulas já registrados. ' +
            'Se a tabela precisa mesmo ser refeita, fale com o administrador master.',
        )
        return
      }
      // Master pode refazer a tabela, mas com aviso explícito do que se perde.
      if (
        !confirm(
          `ATENÇÃO: ${finishedCount} jogo(s) encerrados serão APAGADOS junto com os placares, ` +
            'gols, cartões e súmulas. Esta ação não pode ser desfeita.\n\nRegerar mesmo assim?',
        )
      ) {
        return
      }
    } else if (matches.length > 0 && !confirm('Isso substitui todas as partidas atuais. Continuar?')) {
      return
    }
    setGenerating(true)
    try {
      const force = isMaster
      if (isKnockout) {
        await generateKnockout(championship.id, teams.map((t) => t.id), championship.thirdPlace, force, categoryId)
      } else if (isGroups) {
        const primeira = groupStagesOf(championship)[0]
        const groups = montarGrupos(teams, primeira?.numGroups ?? championship.numGroups ?? 1)
        const validos = Object.values(groups).filter((ids) => ids.length >= 2).length
        if (validos === 0) {
          alert('Nenhum grupo tem 2 times ou mais. Confira os grupos dos times na aba Times.')
          return
        }
        await generateGroups(
          championship.id,
          groups,
          primeira?.doubleRound ?? championship.doubleRound,
          force,
          categoryId,
        )
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

  // Agrupa por rodada (primeira fase) e por fase (mata-mata).
  const sections = useMemo(() => matchSections(matches), [matches])

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
            <Button onClick={() => setKoSetup('create')} disabled={generating}>
              🏆 Criar mata-mata
            </Button>
          )}
          {/* Com a 1ª fase toda encerrada, regerar não faz mais sentido: o
              botão sai da tela (antes ficava só desabilitado). */}
          {!primeiraFaseEncerrada && (
            <Button
              onClick={() => void generate()}
              disabled={generating || regenBlocked}
              title={
                regenBlocked
                  ? `Bloqueado: ${finishedCount} jogo(s) já encerrados. Regerar apagaria os resultados.`
                  : undefined
              }
            >
              {generating ? 'Gerando…' : matches.length ? '↻ Regerar tabela' : '⚙ Gerar tabela de jogos'}
            </Button>
          )}
        </div>
      </div>

      {finishedCount > 0 && !primeiraFaseEncerrada && (
        <p className="ko-note ko-note--lock">
          🔒 A tabela não pode mais ser regerada: {finishedCount} jogo(s) já encerrados.
          Regerar apagaria placares, gols, cartões e súmulas.
          {isMaster && ' Como administrador master, você ainda pode forçar — com perda dos resultados.'}
        </p>
      )}

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

      {knockoutMatches.length > 0 && !scheduling && (
        <div className="bracket-block">
          <div className="bracket-block__head">
            <h3 className="section-title">🏆 Chaveamento</h3>
            {canEditKnockout && (
              <Button variant="soft" onClick={() => setKoSetup('edit')}>✎ Editar confrontos</Button>
            )}
          </div>
          <BracketView matches={knockoutMatches} teams={teams} onMatchClick={setEditing} />
        </div>
      )}

      {pendingTies.length > 0 && (
        <p className="ko-note ko-note--warn">
          ⚠️ {pendingTies.length} confronto(s) de mata-mata terminaram empatados. Abra a partida e
          informe quem se classificou (pênaltis/W.O.) para liberar a fase seguinte.
        </p>
      )}

      {scheduling && matches.length > 0 ? (
        <MatchScheduler
          // Regerar troca todas as partidas (ids novos): o agendador recomeça
          // com elas, em vez de guardar rascunhos dos jogos apagados.
          key={matches.map((m) => m.id).join(',')}
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
          {sections.map((sec) => {
            // As inscrições abrem e fecham para o campeonato inteiro (aba
            // Elencos ou Ajustes) — não mais rodada a rodada.
            return (
              <div key={sec.key} className="round">
                <div className="round__head">
                  <h3 className="round__title">{sec.title}</h3>
                </div>
                <div className="round__matches">
                  {sec.matches.map((m) => (
                    <MatchRow key={m.id} match={m} teams={teams} onClick={() => setEditing(m)} showSchedule venues={championship.venues} />
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

      {koSetup && (
        <KnockoutSetupModal
          mode={koSetup}
          championship={championship}
          teams={teams}
          matches={matches}
          events={events}
          firstPhase={primeiraFaseKo}
          faseCompleta={faseCompleta}
          categoryId={categoryId}
          onClose={() => setKoSetup(null)}
          onSaved={() => {
            setKoSetup(null)
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
 * Monta (ou edita) os confrontos da PRIMEIRA fase do mata-mata.
 *
 * A sugestão vem da classificação e do chaveamento configurado ("1º A × 2º B"),
 * mas cada vaga é um seletor: o organizador coloca quem passou do jeito que
 * quiser. Criar gera o organograma inteiro (até a final, e o 3º lugar se
 * houver); as fases seguintes são preenchidas pelo avanço automático.
 */
function KnockoutSetupModal({
  mode,
  championship,
  teams,
  matches,
  events,
  firstPhase,
  faseCompleta,
  categoryId,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  championship: Championship
  teams: Team[]
  matches: Match[]
  events: MatchEvent[]
  firstPhase: Match[]
  faseCompleta: boolean
  categoryId?: string
  onClose: () => void
  onSaved: () => void
}) {
  type Par = { home: string; away: string }
  const [pares, setPares] = useState<Par[]>(() => {
    if (mode === 'edit') {
      return [...firstPhase]
        .sort((a, b) => (a.bracketPos ?? 0) - (b.bracketPos ?? 0))
        .map((m) => ({ home: m.homeTeamId ?? '', away: m.awayTeamId ?? '' }))
    }
    const sugestao = resolveBracketTeams(championship, teams, matches, events).map((p) => ({
      home: p.home ?? '',
      away: p.away ?? '',
    }))
    return sugestao.length ? sugestao : [{ home: '', away: '' }, { home: '', away: '' }]
  })
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const usados = new Map<string, number>()
  for (const p of pares) for (const id of [p.home, p.away]) if (id) usados.set(id, (usados.get(id) ?? 0) + 1)
  const repetidos = [...usados].filter(([, n]) => n > 1).map(([id]) => teams.find((t) => t.id === id)?.name ?? id)
  // No mata-mata as fases andam em potência de 2: 3 confrontos viram quartas
  // com uma vaga vazia (que passa direto).
  const fase = phaseForPairs(Math.max(1, pares.length))

  function setVaga(i: number, lado: 'home' | 'away', id: string) {
    setPares((prev) => prev.map((p, j) => (j === i ? { ...p, [lado]: id } : p)))
    setErro(null)
  }

  async function salvar() {
    if (repetidos.length) return setErro(`Time em mais de um confronto: ${repetidos.join(', ')}.`)
    if (!pares.some((p) => p.home || p.away)) return setErro('Escolha pelo menos um time.')
    const lista = pares.map((p) => ({ home: p.home || null, away: p.away || null }))
    setBusy(true)
    try {
      if (mode === 'create') {
        const ok = await createKnockoutFromPairs(championship, lista, categoryId)
        if (!ok) {
          setErro('O mata-mata desta categoria já foi criado. Feche e recarregue a tela.')
          return
        }
      } else {
        await updateKnockoutPairs(firstPhase, lista)
      }
      onSaved()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar o mata-mata.')
    } finally {
      setBusy(false)
    }
  }

  const seletor = (i: number, lado: 'home' | 'away', valor: string) => (
    <select value={valor} onChange={(e) => setVaga(i, lado, e.target.value)} aria-label={`Confronto ${i + 1} — ${lado === 'home' ? 'mandante' : 'visitante'}`}>
      <option value="">— a definir / folga —</option>
      {teams.map((t) => (
        <option key={t.id} value={t.id}>{t.name}</option>
      ))}
    </select>
  )

  return (
    <Modal title={mode === 'create' ? 'Criar mata-mata' : 'Editar confrontos do mata-mata'} onClose={onClose} wide dismissable={false}>
      <p className="field__hint">
        {mode === 'create'
          ? 'Os confrontos já vêm sugeridos pela classificação e pelo chaveamento configurado. Troque qualquer vaga para colocar quem passou. Ao criar, o organograma inteiro é montado até a final — os vencedores avançam sozinhos.'
          : 'Troque os times dos confrontos da primeira fase. Só dá para editar enquanto nenhum jogo do mata-mata começou.'}
      </p>
      {mode === 'create' && !faseCompleta && (
        <p className="hint hint--warn">
          ⚠️ A fase de classificação ainda não terminou — a sugestão usa a classificação de agora.
        </p>
      )}

      <p className="small">
        Primeira fase: <b>{PHASE_LABELS[fase]}</b> · {pares.length} confronto(s)
      </p>
      <ol className="ko-setup__list">
        {pares.map((p, i) => (
          <li key={i} className="ko-setup__pair">
            <span className="ko-setup__n">{i + 1}</span>
            {seletor(i, 'home', p.home)}
            <span className="muted">×</span>
            {seletor(i, 'away', p.away)}
            {mode === 'create' && pares.length > 1 ? (
              <button
                type="button"
                className="icon-btn icon-btn--danger"
                title="Remover confronto"
                onClick={() => setPares((prev) => prev.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ol>
      {mode === 'create' && pares.length < 16 && (
        <button type="button" className="link-btn link-btn--add" onClick={() => setPares((prev) => [...prev, { home: '', away: '' }])}>
          ＋ adicionar confronto
        </button>
      )}

      {repetidos.length > 0 && <p className="auth-error">Time repetido: {repetidos.join(', ')}.</p>}
      {erro && !repetidos.length && <p className="auth-error">{erro}</p>}

      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onClose}>Cancelar</Button>
        <Button type="button" onClick={() => void salvar()} disabled={busy || repetidos.length > 0}>
          {busy ? 'Salvando…' : mode === 'create' ? '🏆 Criar mata-mata' : 'Salvar confrontos'}
        </Button>
      </div>
    </Modal>
  )
}

/**
 * Os grupos da 1ª fase para gerar a tabela.
 *
 * Usa o grupo de cada time na categoria. Quando NENHUM time tem grupo ainda,
 * distribui sozinho (A, B, C…, um a um) — antes todos caíam no grupo A e a
 * tabela saía como um pontos corridos gigante. Time sem grupo, no meio de
 * outros que já têm, vai para o grupo com menos times.
 */
export function montarGrupos(teams: Team[], numGroups: number): Record<string, string[]> {
  const letras = Array.from({ length: Math.max(1, numGroups || 1) }, (_, i) => String.fromCharCode(65 + i))
  const groups: Record<string, string[]> = {}
  const algumComGrupo = teams.some((t) => t.group)
  if (!algumComGrupo) {
    teams.forEach((t, i) => {
      ;(groups[letras[i % letras.length]] ??= []).push(t.id)
    })
    return groups
  }
  const semGrupo: Team[] = []
  for (const t of teams) {
    if (t.group) (groups[t.group] ??= []).push(t.id)
    else semGrupo.push(t)
  }
  for (const t of semGrupo) {
    const alvo = letras.reduce((menor, g) =>
      (groups[g]?.length ?? 0) < (groups[menor]?.length ?? 0) ? g : menor, letras[0])
    ;(groups[alvo] ??= []).push(t.id)
  }
  return groups
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
  const proximaRodada =
    Math.max(0, ...matches.filter((m) => m.phase === 'group').map((m) => m.round)) + 1
  const [phase, setPhase] = useState<MatchPhase>('group')
  const [home, setHome] = useState('')
  const [away, setAway] = useState('')
  const [round, setRound] = useState(String(proximaRodada))
  const [group, setGroup] = useState(grupos[0] ?? '')
  const [scheduledAt, setScheduledAt] = useState('')
  const [venue, setVenue] = useState('')
  const [refereeId, setRefereeId] = useState('')
  const [officialId, setOfficialId] = useState('')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const isGroupPhase = phase === 'group'
  const nomeTime = (id: string) => teams.find((t) => t.id === id)?.name ?? ''

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!home || !away) return setErro('Escolha o time mandante e o visitante.')
    if (home === away) return setErro('O mandante e o visitante devem ser times diferentes.')
    // Fase eliminatória entra fora da numeração das rodadas da 1ª fase.
    const koIdx = KNOCKOUT_ORDER.indexOf(phase)
    const rodada = isGroupPhase
      ? Math.max(1, Number(round) || 1)
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
            <Field label="Rodada">
              <input type="number" min={1} max={200} value={round} onChange={(e) => setRound(e.target.value)} />
            </Field>
            {grupos.length > 0 && (
              <Field label="Grupo">
                <select value={group} onChange={(e) => setGroup(e.target.value)}>
                  {grupos.map((g) => (
                    <option key={g} value={g}>Grupo {g}</option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        )}

        <div className="form-row">
          <Field label="Time mandante">
            <select value={home} onChange={(e) => setHome(e.target.value)}>
              <option value="">Escolha…</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id} disabled={t.id === away}>{t.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Time visitante">
            <select value={away} onChange={(e) => setAway(e.target.value)}>
              <option value="">Escolha…</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id} disabled={t.id === home}>{t.name}</option>
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
}: {
  match: Match
  teams: Team[]
  onClick?: () => void
  showSchedule?: boolean
  venues?: Venue[]
}) {
  const home = teams.find((t) => t.id === match.homeTeamId)
  const away = teams.find((t) => t.id === match.awayTeamId)
  const live = match.status === 'live'
  // Jogo encerrado ganha cor própria na lista do administrador e do mesário.
  const finished = match.status === 'finished'
  const hasScore = match.homeScore != null && match.awayScore != null
  const showScore = finished || live
  const schedule = showSchedule ? matchScheduleText(match, venues) : null
  return (
    <button
      className={`match-row ${onClick ? 'is-clickable' : ''} ${live ? 'is-live' : ''} ${finished ? 'is-finished' : ''}`}
      onClick={onClick}
      disabled={!onClick}
      title={finished ? 'Partida encerrada' : undefined}
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
      matches: byRound.get(r)!,
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
