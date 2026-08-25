import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AUDIENCE_LABELS,
  DEFAULT_TIEBREAKERS,
  FORMAT_LABELS,
  OVERALL_GROUP,
  SPORT_LABELS,
  TIEBREAKER_LABELS,
  type Audience,
  type BracketPairing,
  type Category,
  type Championship,
  type ChampionshipFormat,
  type GroupStage,
  type PlanKey,
  type QualifierSlot,
  type Sport,
  type TiebreakerId,
} from '../types'
import { Button, ChampLogo, Field, Modal } from './ui'
import { uid } from '../lib/id'
import { fileToDataUrl } from '../lib/image'
import { PLANS, breakdown, formatBRL, planOf } from '../lib/pricing'
import { phaseForPairs, slotLabel, suggestBracket } from '../lib/knockout'
import {
  groupStagesOf,
  qualifiersOfGroup,
  stageGroupLetters,
  stageName,
  totalQualifiers,
} from '../lib/groupStages'
import { PHASE_LABELS, SEND_OFF_LABELS, SUBSTITUTION_LABELS } from '../types'
import type { SendOffPolicy, SubstitutionMode } from '../types'
import { centavosDeTexto, textoDeCentavos } from '../lib/regras'
import type { NewChampionship } from '../services/championships'

const LOGO_CHOICES = ['🏆', '⚽', '🥇', '🔥', '⭐', '🦁', '🦅', '🐯', '🐺', '🛡️']

interface CatDraft {
  id: string
  name: string
  year: string
  exceptions: string
  exceptionYear: string
  maxAthletes: string
  maxStaff: string
  /** Atletas federados: a permissão é desta categoria, não do campeonato. */
  allowFederated: boolean
  /** Vazio = sem limite. Texto para o campo aceitar ser apagado. */
  maxFederated: string

  /* Regras de jogo — tudo texto, para o campo poder ficar vazio ("não
     definido") em vez de assumir um número que ninguém escolheu. */
  periodMinutes: string
  periods: string
  substitutionMode: '' | SubstitutionMode
  maxSubstitutions: string
  /** Penalidade da expulsão — cada categoria é um caso. */
  sendOffPolicy: '' | SendOffPolicy
  /** Quantas equipes se classificam nesta categoria. */
  qualifiers: string
  yellowAccumulates: boolean
  yellowsForSuspension: string
  refereeFee: string
  refereePix: string
}

function toDraft(c: Category): CatDraft {
  return {
    id: c.id,
    name: c.name,
    year: c.birthYear != null ? String(c.birthYear) : '',
    exceptions: c.exceptions != null ? String(c.exceptions) : '',
    exceptionYear: c.exceptionYear != null ? String(c.exceptionYear) : '',
    maxAthletes: c.maxAthletes != null ? String(c.maxAthletes) : '',
    maxStaff: c.maxStaff != null ? String(c.maxStaff) : '',
    allowFederated: Boolean(c.allowFederated),
    maxFederated: c.maxFederated != null ? String(c.maxFederated) : '',
    periodMinutes: c.periodMinutes != null ? String(c.periodMinutes) : '',
    periods: String(c.periods ?? 2),
    substitutionMode: c.substitutionMode ?? '',
    maxSubstitutions: c.maxSubstitutions != null ? String(c.maxSubstitutions) : '',
    sendOffPolicy: c.sendOffPolicy ?? '',
    qualifiers: c.qualifiers != null ? String(c.qualifiers) : '',
    yellowAccumulates: c.yellowAccumulates !== false,
    yellowsForSuspension: c.yellowsForSuspension != null ? String(c.yellowsForSuspension) : '',
    refereeFee: textoDeCentavos(c.refereeFeeCents),
    refereePix: c.refereePix ?? '',
  }
}

function emptyDraft(): CatDraft {
  return {
    id: uid('cat'), name: '', year: '', exceptions: '', exceptionYear: '',
    maxAthletes: '', maxStaff: '', allowFederated: false, maxFederated: '',
    periodMinutes: '', periods: '2', substitutionMode: '', maxSubstitutions: '',
    sendOffPolicy: '', qualifiers: '',
    yellowAccumulates: true, yellowsForSuspension: '3', refereeFee: '', refereePix: '',
  }
}

/** Seleciona uma vaga do chaveamento: "Nº X do grupo Y" (ou vaga livre/bye). */
function SlotPicker({
  slot,
  side,
  groups,
  maxPosition,
  onChange,
}: {
  slot: QualifierSlot | null
  side: 'home' | 'away'
  groups: string[]
  maxPosition: number
  onChange: (patch: Partial<QualifierSlot> | null) => void
}) {
  const positions = Array.from({ length: Math.max(maxPosition, slot?.position ?? 1) }, (_, i) => i + 1)
  return (
    <span className={`slot-picker slot-picker--${side}`}>
      <select
        value={slot ? String(slot.position) : ''}
        onChange={(e) => (e.target.value ? onChange({ position: Number(e.target.value) }) : onChange(null))}
        aria-label="Colocação"
      >
        <option value="">bye</option>
        {positions.map((p) => (
          <option key={p} value={p}>{p}º</option>
        ))}
      </select>
      {groups.length > 1 && (
        <select
          value={slot?.group ?? groups[0]}
          onChange={(e) => onChange({ group: e.target.value })}
          disabled={!slot}
          aria-label="Grupo"
        >
          {groups.map((g) => (
            <option key={g} value={g}>{g === OVERALL_GROUP ? 'geral' : `grupo ${g}`}</option>
          ))}
        </select>
      )}
    </span>
  )
}

export function ChampionshipForm({
  initial,
  plan: planFromPlans,
  onClose,
  onSave,
}: {
  initial?: Championship
  /** Plano escolhido na página de planos, quando o organizador veio de lá. */
  plan?: PlanKey
  onClose: () => void
  onSave: (data: NewChampionship) => Promise<void>
}) {
  const [name, setName] = useState(initial?.name ?? '')
  // O plano só é escolhido na criação: um campeonato já pago não troca de plano.
  const [plan, setPlan] = useState<PlanKey>(initial?.plan ?? planFromPlans ?? 'gratis')
  const [sport, setSport] = useState<Sport>(initial?.sport ?? 'futebol')
  const [audience, setAudience] = useState<Audience>(initial?.audience ?? 'adulto')
  const [cats, setCats] = useState<CatDraft[]>(
    initial?.categories?.length ? initial.categories.map(toDraft) : [emptyDraft()],
  )
  const [format, setFormat] = useState<ChampionshipFormat>(initial?.format ?? 'league')
  const [season, setSeason] = useState(initial?.season ?? String(new Date().getFullYear()))
  const [description, setDescription] = useState(initial?.description ?? '')
  const [logo, setLogo] = useState(initial?.logo ?? '🏆')
  const [primaryColor, setPrimaryColor] = useState(initial?.primaryColor ?? '#16a34a')
  const [pointsWin, setPointsWin] = useState(initial?.pointsWin ?? 3)
  const [pointsDraw, setPointsDraw] = useState(initial?.pointsDraw ?? 1)
  const [doubleRound, setDoubleRound] = useState(initial?.doubleRound ?? false)
  const [teamsPerGroup, setTeamsPerGroup] = useState<string>(initial?.teamsPerGroup != null ? String(initial.teamsPerGroup) : '')
  // Fases de grupos: a 1ª sempre existe; o organizador pode acrescentar outras
  // (os classificados de uma fase formam os grupos da seguinte).
  const [stages, setStages] = useState<GroupStage[]>(() => {
    // Só aproveita as fases de um campeonato que já é de grupos — em outros
    // formatos `groupStagesOf` devolve a fase sintética da classificação.
    const existing = initial?.format === 'groups_knockout' ? groupStagesOf(initial) : []
    return existing.length ? existing : [{ id: uid('gs'), numGroups: 2, advancePerGroup: 2 }]
  })
  const [cutoffHours, setCutoffHours] = useState(initial?.registrationCutoffHours ?? 3)
  const [benchSize, setBenchSize] = useState(
    initial?.benchSize != null ? String(initial.benchSize) : '',
  )
  const [tiebreakers, setTiebreakers] = useState<TiebreakerId[]>(
    initial?.tiebreakers?.length ? initial.tiebreakers : DEFAULT_TIEBREAKERS,
  )
  const [bracket, setBracket] = useState<BracketPairing[]>(initial?.bracket ?? [])
  /** O chaveamento já foi editado à mão? (então não é mais autossugerido) */
  const [bracketTouched, setBracketTouched] = useState(Boolean(initial?.bracket?.length))
  const [thirdPlace, setThirdPlace] = useState(initial?.thirdPlace ?? false)
  const [autoKnockout, setAutoKnockout] = useState(initial?.autoKnockout ?? true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const logoRef = useRef<HTMLInputElement>(null)

  async function onLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setLogo(await fileToDataUrl(file, 512))
    } catch {
      setError('Não foi possível carregar a imagem.')
    } finally {
      if (logoRef.current) logoRef.current.value = ''
    }
  }

  function updateCat(id: string, patch: Partial<CatDraft>) {
    setCats((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }
  function addCat() {
    setCats((prev) => [...prev, emptyDraft()])
  }
  function removeCat(id: string) {
    setCats((prev) => (prev.length > 1 ? prev.filter((c) => c.id !== id) : prev))
  }

  function buildCategories(): Category[] {
    return cats
      .filter((c) => c.name.trim())
      .map((c) => {
        const year = c.year ? Number(c.year) : undefined
        return {
          id: c.id,
          name: c.name.trim(),
          birthYear: year,
          birthYearMode: year ? (audience === 'infantil' ? 'min' : 'max') : undefined,
          exceptions: audience === 'adulto' && c.exceptions ? Number(c.exceptions) : 0,
          exceptionYear: audience === 'adulto' && c.exceptionYear ? Number(c.exceptionYear) : undefined,
          maxAthletes: c.maxAthletes ? Number(c.maxAthletes) : undefined,
          maxStaff: c.maxStaff ? Number(c.maxStaff) : undefined,
          // Federados só existem na base.
          allowFederated: audience === 'infantil' && c.allowFederated,
          maxFederated:
            audience === 'infantil' && c.allowFederated && c.maxFederated.trim()
              ? Math.max(1, Number(c.maxFederated))
              : null,
          // Regras de jogo. Campo vazio fica `undefined` de propósito: o
          // regulamento omite a regra em vez de afirmar um padrão que o
          // organizador não escolheu.
          periodMinutes: c.periodMinutes ? Math.max(1, Number(c.periodMinutes)) : undefined,
          periods: c.periodMinutes ? Math.max(1, Number(c.periods) || 2) : undefined,
          substitutionMode: c.substitutionMode || undefined,
          maxSubstitutions:
            c.substitutionMode === 'limitada' && c.maxSubstitutions
              ? Math.max(1, Number(c.maxSubstitutions))
              : undefined,
          sendOffPolicy: c.sendOffPolicy || undefined,
          qualifiers: c.qualifiers ? Math.max(1, Number(c.qualifiers)) : undefined,
          yellowAccumulates: c.yellowAccumulates,
          yellowsForSuspension: c.yellowAccumulates
            ? Math.max(1, Number(c.yellowsForSuspension) || 3)
            : undefined,
          refereeFeeCents: centavosDeTexto(c.refereeFee),
          refereePix: c.refereePix.trim() || undefined,
        }
      })
  }

  // Valor do campeonato, refeito a cada categoria digitada: é o mesmo cálculo
  // que o banco aplica na criação (plano + categorias adicionais).
  const price = breakdown(plan, Math.max(1, cats.filter((c) => c.name.trim()).length))

  /* ---------------------------------------------------------------------- */
  /* Fases de grupos, critérios de classificação e chaveamento               */
  /* ---------------------------------------------------------------------- */
  // A tabela do app é UMA só (categoria separa quem pode ser inscrito, não
  // competições diferentes). Quando as categorias declaram números diferentes
  // de classificados, ela segue a primeira — e o formulário avisa qual.
  const classificadosCats = cats
    .map((c) => (c.qualifiers ? Number(c.qualifiers) : 0))
    .filter((n) => n > 0)
  const qualifiersNum = classificadosCats[0] ?? 0
  const classificadosDiferem = new Set(classificadosCats).size > 1
  const catDaTabela = cats.find((c) => Number(c.qualifiers) > 0)
  const hasKnockout =
    format === 'groups_knockout' || (format === 'league' && qualifiersNum >= 2)
  /** O mata-mata é montado com os classificados da ÚLTIMA fase de grupos. */
  const lastStage = stages[stages.length - 1]
  const groups = useMemo(
    () =>
      format === 'groups_knockout' ? stageGroupLetters(lastStage?.numGroups ?? 2) : [OVERALL_GROUP],
    [format, lastStage?.numGroups],
  )
  const maxPosition =
    format === 'groups_knockout'
      ? Math.max(1, ...groups.map((g) => (lastStage ? qualifiersOfGroup(lastStage, g) : 2)))
      : Math.max(2, qualifiersNum)

  const suggest = useMemo(
    () =>
      suggestBracket({
        format,
        groupStages: stages,
        leagueQualifiers: qualifiersNum,
      }),
    [format, stages, qualifiersNum],
  )

  function updateStage(id: string, patch: Partial<GroupStage>) {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  function setStageQualifiers(stage: GroupStage, group: string, value: string) {
    const n = value === '' ? undefined : Math.max(0, Number(value))
    const next = { ...(stage.advanceByGroup ?? {}) }
    if (n == null) delete next[group]
    else next[group] = n
    updateStage(stage.id, { advanceByGroup: next })
  }

  function addStage() {
    setStages((prev) => [...prev, { id: uid('gs'), numGroups: 1, advancePerGroup: 2 }])
  }

  function removeStage(id: string) {
    setStages((prev) => (prev.length > 1 ? prev.filter((s) => s.id !== id) : prev))
  }

  // Enquanto o organizador não mexer no chaveamento, ele acompanha o formato:
  // mudou o nº de grupos ou de classificados, a sugestão é refeita. A partir da
  // primeira edição manual, o que ele montou é preservado.
  useEffect(() => {
    if (hasKnockout && !bracketTouched) setBracket(suggest)
  }, [hasKnockout, bracketTouched, suggest])

  function moveTiebreaker(id: TiebreakerId, dir: -1 | 1) {
    setTiebreakers((prev) => {
      const i = prev.indexOf(id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function toggleTiebreaker(id: TiebreakerId) {
    setTiebreakers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function updateSlot(pairingId: string, side: 'home' | 'away', patch: Partial<QualifierSlot> | null) {
    setBracketTouched(true)
    setBracket((prev) =>
      prev.map((p) => {
        if (p.id !== pairingId) return p
        if (patch === null) return { ...p, [side]: null }
        const base = p[side] ?? { group: groups[0], position: 1 }
        return { ...p, [side]: { ...base, ...patch } }
      }),
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const categories = buildCategories()
    if (categories.length === 0) {
      setError('Informe ao menos uma categoria.')
      return
    }
    const limite = planOf(plan).maxCategories
    if (!initial && limite != null && categories.length > limite) {
      setError(
        `O plano ${planOf(plan).tier} permite ${limite} categoria(s). ` +
          'Escolha outro plano para incluir mais categorias.',
      )
      return
    }
    if (audience === 'infantil' && categories.some((c) => !c.birthYear)) {
      setError('No campeonato infantil, informe o ano de nascimento de cada categoria.')
      return
    }
    setBusy(true)
    await onSave({
      name: name.trim(),
      sport,
      audience,
      categories,
      format,
      season: season.trim(),
      status: initial?.status ?? 'draft',
      // O plano vale para a cobrança; o valor definitivo é calculado no banco.
      plan: initial?.plan ?? plan,
      description: description.trim() || undefined,
      logo,
      primaryColor,
      pointsWin: Number(pointsWin),
      pointsDraw: Number(pointsDraw),
      registrationCutoffHours: Number(cutoffHours),
      benchSize: benchSize ? Math.max(0, Number(benchSize)) : undefined,
      doubleRound,
      // Campos "legados" espelham a 1ª fase (usados no cadastro/sorteio dos times).
      numGroups: format === 'groups_knockout' ? stages[0].numGroups : undefined,
      teamsPerGroup: format === 'groups_knockout' && teamsPerGroup ? Number(teamsPerGroup) : undefined,
      advancePerGroup: format === 'groups_knockout' ? stages[0].advancePerGroup ?? 2 : undefined,
      advanceByGroup: format === 'groups_knockout' ? stages[0].advanceByGroup : undefined,
      groupStages:
        format === 'groups_knockout'
          ? stages.map((s, i) => (i === 0 ? { ...s, doubleRound } : s))
          : undefined,
      leagueQualifiers: format === 'league' && qualifiersNum ? qualifiersNum : undefined,
      tiebreakers,
      bracket: hasKnockout ? bracket : undefined,
      thirdPlace: hasKnockout ? thirdPlace : undefined,
      autoKnockout: hasKnockout ? autoKnockout : undefined,
    })
    setBusy(false)
  }

  return (
    <Modal title={initial ? 'Editar campeonato' : 'Novo campeonato'} onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        {!initial && (
          <div className="plan-pick">
            <div className="cats__head">
              <span className="field__label">Plano</span>
              <a className="link-btn" href="#/planos" target="_blank" rel="noopener noreferrer">ver detalhes dos planos</a>
            </div>
            <div className="plan-pick__opts">
              {PLANS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`plan-pick__opt ${plan === p.key ? 'is-active' : ''}`}
                  style={{ '--tier': p.tint } as React.CSSProperties}
                  onClick={() => setPlan(p.key)}
                >
                  <span className="plan-pick__tier">{p.gem} {p.tier}</span>
                  <span className="plan-pick__price">
                    {p.consult ? 'sob consulta' : p.priceCents === 0 ? 'grátis' : formatBRL(p.priceCents)}
                  </span>
                  <span className="plan-pick__lim">
                    {p.maxTeams == null ? 'equipes ilimitadas' : `até ${p.maxTeams} equipes`}
                  </span>
                </button>
              ))}
            </div>
            <p className="field__hint">{planOf(plan).cap}</p>
          </div>
        )}

        <Field label="Nome do campeonato">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Copa de Verão 2026" required />
        </Field>

        <div className="form-row">
          <Field label="Modalidade">
            <select value={sport} onChange={(e) => setSport(e.target.value as Sport)}>
              {Object.entries(SPORT_LABELS).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </Field>
          <Field label="Temporada">
            <input value={season} onChange={(e) => setSeason(e.target.value)} placeholder="2026" />
          </Field>
        </div>

        <Field label="Tipo de campeonato">
          <div className="segmented">
            {(Object.keys(AUDIENCE_LABELS) as Audience[]).map((a) => (
              <button
                type="button"
                key={a}
                className={`segmented__item ${audience === a ? 'is-active' : ''}`}
                onClick={() => setAudience(a)}
              >
                {a === 'infantil' ? '🧒' : '🧑'} {AUDIENCE_LABELS[a]}
              </button>
            ))}
          </div>
        </Field>

        {/* Categorias */}
        <div className="cats">
          <div className="cats__head">
            <span className="field__label">Categorias</span>
            <button type="button" className="link-btn link-btn--add" onClick={addCat}>＋ adicionar categoria</button>
          </div>
          <p className="field__hint">
            {audience === 'infantil'
              ? 'Só poderão ser inscritos atletas nascidos no ano informado ou depois (mais novos).'
              : 'Ex.: nascidos em 1979 ou mais velho. A exceção permite N atletas até um ano mais novo (ex.: 3 atletas de 1980 ou mais velho).'}
          </p>
          {classificadosDiferem && (
            <p className="field__hint cats__aviso">
              ⚠️ As categorias classificam números diferentes de equipes. O regulamento traz o
              número de cada uma; a <b>tabela do app</b> é uma só e vai destacar os{' '}
              <b>{qualifiersNum} primeiros</b> — o de <b>{catDaTabela?.name || 'primeira categoria'}</b>.
            </p>
          )}
          <div className="cats__list">
            {cats.map((c, i) => (
              <div key={c.id} className="cat-card">
                <div className="cat-card__head">
                  <span className="cat-card__idx">Categoria {i + 1}</span>
                  <button
                    type="button"
                    className="icon-btn icon-btn--danger icon-btn--label"
                    title="Remover categoria"
                    onClick={() => removeCat(c.id)}
                    disabled={cats.length <= 1}
                  >
                    🗑 remover
                  </button>
                </div>
                <div className="cat-card__grid">
                  <label className="mini-field mini-field--wide">
                    <span className="mini-field__label">Nome da categoria</span>
                    <input
                      value={c.name}
                      onChange={(e) => updateCat(c.id, { name: e.target.value })}
                      placeholder={audience === 'infantil' ? `Ex.: Sub-${13 + i}` : i === 0 ? 'Ex.: Adulto Livre' : 'Ex.: Veterano +40'}
                    />
                  </label>

                  <label className="mini-field">
                    <span className="mini-field__label">
                      {audience === 'infantil' ? 'Ano de nascimento' : 'Ano-limite (opcional)'}
                    </span>
                    <input
                      type="number"
                      min={1930}
                      max={2100}
                      value={c.year}
                      onChange={(e) => updateCat(c.id, { year: e.target.value })}
                      placeholder="Ex.: 2013"
                    />
                    <small className="mini-field__hint">
                      {audience === 'infantil' ? 'nascidos neste ano ou depois' : 'nascidos neste ano ou antes'}
                    </small>
                  </label>

                  {audience === 'infantil' && (
                    <div className="fed-cat">
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={c.allowFederated}
                          onChange={(e) => updateCat(c.id, { allowFederated: e.target.checked })}
                        />
                        <span>Aceita atletas <b>federados</b> (campo / futsal)</span>
                      </label>
                      {c.allowFederated && (
                        <label className="fed-cat__qtd">
                          <span className="fed-cat__label">Quantos por time?</span>
                          <input
                            type="number"
                            min={1}
                            max={99}
                            value={c.maxFederated}
                            onChange={(e) => updateCat(c.id, { maxFederated: e.target.value })}
                            placeholder="sem limite"
                          />
                          <small className="fed-cat__hint">Em branco = sem limite.</small>
                        </label>
                      )}
                    </div>
                  )}

                  {audience === 'adulto' && (
                    <label className="mini-field">
                      <span className="mini-field__label">Exceções de idade (qtd.)</span>
                      <input
                        type="number"
                        min={0}
                        max={20}
                        value={c.exceptions}
                        onChange={(e) => updateCat(c.id, { exceptions: e.target.value })}
                        placeholder="0"
                      />
                      <small className="mini-field__hint">atletas fora da idade, por time</small>
                    </label>
                  )}
                  {audience === 'adulto' && (
                    <label className="mini-field">
                      <span className="mini-field__label">Ano da exceção</span>
                      <input
                        type="number"
                        min={1930}
                        max={2100}
                        value={c.exceptionYear}
                        onChange={(e) => updateCat(c.id, { exceptionYear: e.target.value })}
                        placeholder="Ex.: 1980"
                      />
                      <small className="mini-field__hint">até este ano de nascimento (ou antes)</small>
                    </label>
                  )}

                  <label className="mini-field">
                    <span className="mini-field__label">Máx. de atletas</span>
                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={c.maxAthletes}
                      onChange={(e) => updateCat(c.id, { maxAthletes: e.target.value })}
                      placeholder="sem limite"
                    />
                    <small className="mini-field__hint">por time (0 = sem limite)</small>
                  </label>

                  <label className="mini-field">
                    <span className="mini-field__label">Máx. comissão técnica</span>
                    <input
                      type="number"
                      min={0}
                      max={30}
                      value={c.maxStaff}
                      onChange={(e) => updateCat(c.id, { maxStaff: e.target.value })}
                      placeholder="sem limite"
                    />
                    <small className="mini-field__hint">técnicos/auxiliares por time</small>
                  </label>

                  {/* Regras de jogo: tudo o que se discute na beira do campo e
                      entra no regulamento que os times baixam. */}
                  <div className="cat-regras">
                    <span className="cat-regras__titulo">⏱ Regras de jogo</span>

                    <div className="cat-regras__linha">
                      <label className="mini-field">
                        <span className="mini-field__label">Tempo de jogo</span>
                        <input
                          type="number"
                          min={1}
                          max={90}
                          value={c.periodMinutes}
                          onChange={(e) => updateCat(c.id, { periodMinutes: e.target.value })}
                          placeholder="Ex.: 25"
                        />
                        <small className="mini-field__hint">minutos de cada tempo</small>
                      </label>
                      <label className="mini-field">
                        <span className="mini-field__label">Nº de tempos</span>
                        <select
                          value={c.periods}
                          onChange={(e) => updateCat(c.id, { periods: e.target.value })}
                        >
                          <option value="1">1 (corrido)</option>
                          <option value="2">2 tempos</option>
                          <option value="3">3 tempos</option>
                          <option value="4">4 tempos</option>
                        </select>
                        <small className="mini-field__hint">
                          {c.periodMinutes
                            ? `total de ${Math.max(1, Number(c.periods) || 2) * Number(c.periodMinutes)} min`
                            : 'em branco = não definido'}
                        </small>
                      </label>
                    </div>

                    <div className="cat-regras__linha">
                      <label className="mini-field">
                        <span className="mini-field__label">Substituições</span>
                        <select
                          value={c.substitutionMode}
                          onChange={(e) =>
                            updateCat(c.id, { substitutionMode: e.target.value as '' | SubstitutionMode })
                          }
                        >
                          <option value="">Não definido</option>
                          {Object.entries(SUBSTITUTION_LABELS).map(([id, label]) => (
                            <option key={id} value={id}>{label}</option>
                          ))}
                        </select>
                      </label>
                      {c.substitutionMode === 'limitada' && (
                        <label className="mini-field">
                          <span className="mini-field__label">Quantas por partida</span>
                          <input
                            type="number"
                            min={1}
                            max={20}
                            value={c.maxSubstitutions}
                            onChange={(e) => updateCat(c.id, { maxSubstitutions: e.target.value })}
                            placeholder="Ex.: 5"
                          />
                        </label>
                      )}
                    </div>

                    <div className="cat-regras__linha">
                      <label className="check cat-regras__check">
                        <input
                          type="checkbox"
                          checked={c.yellowAccumulates}
                          onChange={(e) => updateCat(c.id, { yellowAccumulates: e.target.checked })}
                        />
                        <span>O cartão <b>amarelo acumula</b></span>
                      </label>
                      {c.yellowAccumulates && (
                        <label className="mini-field">
                          <span className="mini-field__label">Amarelos p/ suspensão</span>
                          <input
                            type="number"
                            min={1}
                            max={20}
                            value={c.yellowsForSuspension}
                            onChange={(e) => updateCat(c.id, { yellowsForSuspension: e.target.value })}
                            placeholder="3"
                          />
                          <small className="mini-field__hint">suspensão automática</small>
                        </label>
                      )}
                    </div>

                    <div className="cat-regras__linha">
                      <label className="mini-field mini-field--wide">
                        <span className="mini-field__label">Se um atleta for expulso</span>
                        <select
                          value={c.sendOffPolicy}
                          onChange={(e) =>
                            updateCat(c.id, { sendOffPolicy: e.target.value as '' | SendOffPolicy })
                          }
                        >
                          <option value="">Não definido</option>
                          {Object.entries(SEND_OFF_LABELS).map(([id, label]) => (
                            <option key={id} value={id}>{label}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {format !== 'knockout' && (
                      <div className="cat-regras__linha">
                        <label className="mini-field">
                          <span className="mini-field__label">
                            {format === 'groups_knockout' ? 'Classificados por grupo' : 'Classificados ao mata-mata'}
                          </span>
                          <input
                            type="number"
                            min={1}
                            max={64}
                            value={c.qualifiers}
                            onChange={(e) => updateCat(c.id, { qualifiers: e.target.value })}
                            placeholder={format === 'groups_knockout' ? 'Ex.: 2' : 'Ex.: 8'}
                          />
                          <small className="mini-field__hint">
                            {format === 'groups_knockout'
                              ? 'quantas equipes avançam de cada grupo'
                              : 'primeiras colocadas que avançam'}
                          </small>
                        </label>
                      </div>
                    )}

                    <div className="cat-regras__linha">
                      <label className="mini-field">
                        <span className="mini-field__label">Valor da arbitragem</span>
                        <input
                          inputMode="decimal"
                          value={c.refereeFee}
                          onChange={(e) => updateCat(c.id, { refereeFee: e.target.value })}
                          placeholder="Ex.: 180,00"
                        />
                        <small className="mini-field__hint">R$ por partida</small>
                      </label>
                      <label className="mini-field mini-field--wide">
                        <span className="mini-field__label">PIX da arbitragem</span>
                        <input
                          value={c.refereePix}
                          onChange={(e) => updateCat(c.id, { refereePix: e.target.value })}
                          placeholder="CPF, e-mail, telefone ou chave aleatória"
                        />
                        <small className="mini-field__hint">entra no regulamento</small>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <Field label="Formato de disputa">
          <select value={format} onChange={(e) => setFormat(e.target.value as ChampionshipFormat)}>
            {Object.entries(FORMAT_LABELS).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </Field>

        {format === 'groups_knockout' && (
          <div className="phase-config">
            <div className="phase-config__head">
              <h4 className="phase-config__title">🔠 Fases de grupos</h4>
              <button type="button" className="link-btn link-btn--add" onClick={addStage}>
                ＋ adicionar fase de grupos
              </button>
            </div>
            <p className="field__hint">
              Os classificados de uma fase formam os grupos da fase seguinte; da última fase saem
              as vagas do mata-mata. Cada grupo tem o <b>seu</b> número de classificados — útil
              quando os grupos têm quantidades diferentes de times.
            </p>

            {stages.map((s, i) => {
              const letters = stageGroupLetters(s.numGroups)
              const entra = i === 0 ? null : totalQualifiers(stages[i - 1])
              return (
                <div key={s.id} className="stage-card">
                  <div className="stage-card__head">
                    <span className="stage-card__idx">{stageName(s, i, stages.length)}</span>
                    {stages.length > 1 && (
                      <button
                        type="button"
                        className="icon-btn icon-btn--danger icon-btn--label"
                        title="Remover esta fase"
                        onClick={() => removeStage(s.id)}
                      >
                        🗑 remover
                      </button>
                    )}
                  </div>

                  {entra != null && (
                    <p className="stage-card__note">
                      Recebe os <b>{entra}</b> classificados da fase anterior, distribuídos nos
                      grupos abaixo.
                    </p>
                  )}

                  <div className="stage-card__grid">
                    <label className="mini-field">
                      <span className="mini-field__label">Número de grupos</span>
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={s.numGroups}
                        onChange={(e) => updateStage(s.id, { numGroups: Math.max(1, Number(e.target.value) || 1) })}
                      />
                      <small className="mini-field__hint">{i === 0 ? 'grupos da primeira fase' : 'grupos desta fase'}</small>
                    </label>

                    {i === 0 && (
                      <label className="mini-field">
                        <span className="mini-field__label">Times por grupo</span>
                        <input
                          type="number"
                          min={2}
                          max={64}
                          value={teamsPerGroup}
                          onChange={(e) => setTeamsPerGroup(e.target.value)}
                          placeholder="sem meta"
                        />
                        <small className="mini-field__hint">meta no cadastro dos times (opcional)</small>
                      </label>
                    )}

                    {i > 0 && (
                      <label className="mini-field mini-field--wide">
                        <span className="mini-field__label">Turno e returno</span>
                        <span className="checkbox checkbox--inline">
                          <input
                            type="checkbox"
                            checked={s.doubleRound ?? false}
                            onChange={(e) => updateStage(s.id, { doubleRound: e.target.checked })}
                          />
                          <span>jogam duas vezes</span>
                        </span>
                      </label>
                    )}
                  </div>

                  <div className="stage-card__quotas">
                    <span className="mini-field__label">Classificados por grupo</span>
                    <div className="quota-grid">
                      {letters.map((g) => (
                        <label key={g} className="quota-item">
                          <span className="quota-item__label">Grupo {g}</span>
                          <input
                            type="number"
                            min={0}
                            max={32}
                            value={String(qualifiersOfGroup(s, g))}
                            onChange={(e) => setStageQualifiers(s, g, e.target.value)}
                          />
                        </label>
                      ))}
                    </div>
                    <small className="mini-field__hint">
                      Total: <b>{totalQualifiers(s)}</b> classificado(s)
                      {i === stages.length - 1 ? ' para o mata-mata' : ' para a fase seguinte'}.
                    </small>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {format === 'league' && (
          <p className="field__hint">
            🏁 <b>Quantos se classificam</b> agora é definido em cada categoria, no bloco
            “Regras de jogo”. A forma de disputa acima vale para todas.
          </p>
        )}

        {format !== 'knockout' && (
          <div className="phase-config">
            <h4 className="phase-config__title">📊 Critérios de classificação</h4>
            <p className="field__hint">
              O 1º critério é sempre a <b>pontuação</b>. Abaixo, ordene os critérios de desempate —
              eles valem para a tabela e para definir quem se classifica ao mata-mata.
            </p>
            <ol className="tiebreak-list">
              {tiebreakers.map((t, i) => (
                <li key={t} className="tiebreak-item">
                  <span className="tiebreak-item__idx">{i + 2}º</span>
                  <span className="tiebreak-item__label">{TIEBREAKER_LABELS[t]}</span>
                  <span className="tiebreak-item__actions">
                    <button type="button" className="icon-btn" title="Subir" onClick={() => moveTiebreaker(t, -1)} disabled={i === 0}>↑</button>
                    <button type="button" className="icon-btn" title="Descer" onClick={() => moveTiebreaker(t, 1)} disabled={i === tiebreakers.length - 1}>↓</button>
                    <button type="button" className="icon-btn icon-btn--danger" title="Remover critério" onClick={() => toggleTiebreaker(t)}>✕</button>
                  </span>
                </li>
              ))}
            </ol>
            {(Object.keys(TIEBREAKER_LABELS) as TiebreakerId[]).some((t) => !tiebreakers.includes(t)) && (
              <div className="tiebreak-add">
                <span className="muted small">Adicionar:</span>
                {(Object.keys(TIEBREAKER_LABELS) as TiebreakerId[])
                  .filter((t) => !tiebreakers.includes(t))
                  .map((t) => (
                    <button type="button" key={t} className="chip-btn" onClick={() => toggleTiebreaker(t)}>
                      ＋ {TIEBREAKER_LABELS[t]}
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}

        {hasKnockout && (
          <div className="phase-config">
            <div className="phase-config__head">
              <h4 className="phase-config__title">🏆 Chaveamento do mata-mata</h4>
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setBracket(suggest)
                  setBracketTouched(false)
                }}
              >
                ↻ sugerir automaticamente
              </button>
            </div>
            <p className="field__hint">
              Defina <b>quem pega quem</b> na primeira fase eliminatória. As fases seguintes saem
              daqui: o vencedor do Jogo 1 enfrenta o vencedor do Jogo 2, o do Jogo 3 enfrenta o do
              Jogo 4, e assim por diante — até a final.
            </p>

            <div className="bracket-list">
              {bracket.length === 0 && (
                <p className="muted small">
                  Informe os classificados {format === 'groups_knockout' ? 'por grupo' : 'da tabela'} para montar o chaveamento.
                </p>
              )}
              {bracket.map((p, i) => (
                <div key={p.id} className="bracket-row">
                  <span className="bracket-row__idx">Jogo {i + 1}</span>
                  <SlotPicker
                    slot={p.home}
                    side="home"
                    groups={groups}
                    maxPosition={maxPosition}
                    onChange={(patch) => updateSlot(p.id, 'home', patch)}
                  />
                  <span className="bracket-row__x">×</span>
                  <SlotPicker
                    slot={p.away}
                    side="away"
                    groups={groups}
                    maxPosition={maxPosition}
                    onChange={(patch) => updateSlot(p.id, 'away', patch)}
                  />
                  <button
                    type="button"
                    className="icon-btn icon-btn--danger"
                    title="Remover confronto"
                    onClick={() => {
                      setBracketTouched(true)
                      setBracket((prev) => prev.filter((x) => x.id !== p.id))
                    }}
                  >
                    🗑
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="link-btn link-btn--add"
                onClick={() => {
                  setBracketTouched(true)
                  setBracket((prev) => [
                    ...prev,
                    { id: uid('br'), home: { group: groups[0], position: 1 }, away: { group: groups[groups.length - 1], position: Math.min(2, maxPosition) } },
                  ])
                }}
              >
                ＋ adicionar confronto
              </button>
            </div>

            {bracket.length > 0 && (
              <p className="bracket-preview">
                Fase inicial: <b>{PHASE_LABELS[phaseForPairs(bracket.length)]}</b> ·{' '}
                {bracket.map((p, i) => `Jogo ${i + 1}: ${slotLabel(p.home)} × ${slotLabel(p.away)}`).join(' · ')}
              </p>
            )}

            <label className="checkbox">
              <input type="checkbox" checked={thirdPlace} onChange={(e) => setThirdPlace(e.target.checked)} />
              <span>Criar disputa de 3º lugar (perdedores das semifinais)</span>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={autoKnockout} onChange={(e) => setAutoKnockout(e.target.checked)} />
              <span>Criar o mata-mata automaticamente quando todos os jogos da primeira fase forem encerrados</span>
            </label>
          </div>
        )}

        {format !== 'knockout' && (
          <div className="form-row">
            <Field label="Pontos por vitória">
              <input type="number" min={1} max={5} value={pointsWin} onChange={(e) => setPointsWin(Number(e.target.value))} />
            </Field>
            <Field label="Pontos por empate">
              <input type="number" min={0} max={3} value={pointsDraw} onChange={(e) => setPointsDraw(Number(e.target.value))} />
            </Field>
          </div>
        )}

        {format !== 'knockout' && (
          <label className="checkbox">
            <input type="checkbox" checked={doubleRound} onChange={(e) => setDoubleRound(e.target.checked)} />
            <span>Turno e returno (todos se enfrentam duas vezes)</span>
          </label>
        )}

        <Field
          label="Atletas no banco de reservas"
          hint="Entra no regulamento: “Poderá ficar no banco de reservas até X atletas devidamente uniformizados.” Em branco = não definido."
        >
          <input
            type="number"
            min={0}
            max={30}
            value={benchSize}
            onChange={(e) => setBenchSize(e.target.value)}
            placeholder="Ex.: 7"
          />
        </Field>

        <Field label="Prazo de inscrição (horas antes do jogo)" hint="As inscrições de um time encerram este tempo antes da partida e reabrem após o jogo ser finalizado. Use 0 para não limitar.">
          <input type="number" min={0} max={168} value={cutoffHours} onChange={(e) => setCutoffHours(Number(e.target.value))} />
        </Field>

        <Field label="Brasão do campeonato">
          <div className="champ-logo-field">
            <span className="champ-logo-preview">
              <ChampLogo logo={logo} />
            </span>
            <div className="champ-logo-actions">
              <input ref={logoRef} type="file" accept="image/*" hidden onChange={onLogoUpload} />
              <Button variant="soft" type="button" onClick={() => logoRef.current?.click()}>⬆ Enviar imagem</Button>
              {logo?.startsWith('data:') && (
                <button type="button" className="link-btn" onClick={() => setLogo('🏆')}>remover imagem</button>
              )}
              <div className="emoji-picker">
                {LOGO_CHOICES.map((e) => (
                  <button
                    type="button"
                    key={e}
                    className={`emoji-picker__item ${logo === e ? 'is-active' : ''}`}
                    onClick={() => setLogo(e)}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Field>

        <div className="form-row">
          <Field label="Cor principal">
            <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="color-input" />
          </Field>
        </div>

        <Field label="Descrição (opcional)">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Regras, local, premiação…" />
        </Field>

        {error && <p className="auth-error">{error}</p>}

        {!initial && (
          <div className="plan-total">
            <div className="plan-total__lines">
              <span>
                Plano {price.plan.tier}
                {price.extraCategories > 0 && ` + ${price.extraCategories} categoria(s)`}
              </span>
              <strong className="plan-total__val">
                {price.plan.consult
                  ? 'sob consulta'
                  : price.totalCents === 0
                    ? 'grátis'
                    : formatBRL(price.totalCents)}
              </strong>
            </div>
            {price.extraCategories > 0 && (
              <p className="field__hint">
                {formatBRL(price.baseCents)} do plano + {price.extraCategories} ×{' '}
                {formatBRL(price.plan.addonCents)} por categoria adicional.
              </p>
            )}
            {price.totalCents > 0 && (
              <p className="field__hint">
                O campeonato é criado e liberado assim que o pagamento for confirmado.
              </p>
            )}
          </div>
        )}

        <div className="form-actions">
          <Button variant="ghost" type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy
              ? 'Salvando…'
              : initial
                ? 'Salvar alterações'
                : price.totalCents > 0
                  ? `Criar e pagar ${formatBRL(price.totalCents)}`
                  : 'Criar campeonato'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
