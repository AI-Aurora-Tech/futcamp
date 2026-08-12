import { useRef, useState } from 'react'
import {
  AUDIENCE_LABELS,
  FORMAT_LABELS,
  SPORT_LABELS,
  type Audience,
  type Category,
  type Championship,
  type ChampionshipFormat,
  type Sport,
} from '../types'
import { Button, ChampLogo, Field, Modal } from './ui'
import { uid } from '../lib/id'
import { fileToDataUrl } from '../lib/image'
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
  }
}

function emptyDraft(): CatDraft {
  return { id: uid('cat'), name: '', year: '', exceptions: '', exceptionYear: '', maxAthletes: '', maxStaff: '' }
}

export function ChampionshipForm({
  initial,
  onClose,
  onSave,
}: {
  initial?: Championship
  onClose: () => void
  onSave: (data: NewChampionship) => Promise<void>
}) {
  const [name, setName] = useState(initial?.name ?? '')
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
  const [numGroups, setNumGroups] = useState(initial?.numGroups ?? 2)
  const [teamsPerGroup, setTeamsPerGroup] = useState<string>(initial?.teamsPerGroup != null ? String(initial.teamsPerGroup) : '')
  const [cutoffHours, setCutoffHours] = useState(initial?.registrationCutoffHours ?? 3)
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
        }
      })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const categories = buildCategories()
    if (categories.length === 0) {
      setError('Informe ao menos uma categoria.')
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
      description: description.trim() || undefined,
      logo,
      primaryColor,
      pointsWin: Number(pointsWin),
      pointsDraw: Number(pointsDraw),
      registrationCutoffHours: Number(cutoffHours),
      doubleRound,
      numGroups: format === 'groups_knockout' ? Number(numGroups) : undefined,
      teamsPerGroup: format === 'groups_knockout' && teamsPerGroup ? Number(teamsPerGroup) : undefined,
    })
    setBusy(false)
  }

  return (
    <Modal title={initial ? 'Editar campeonato' : 'Novo campeonato'} onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
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
          <div className="cats__list">
            {cats.map((c, i) => (
              <div key={c.id} className="cat-card">
                <div className="cat-card__head">
                  <span className="cat-card__idx">Categoria {i + 1}</span>
                  <button
                    type="button"
                    className="icon-btn icon-btn--danger"
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
          <div className="form-row">
            <Field label="Número de grupos" hint="Use 1 para uma fase única seguida de mata-mata.">
              <input type="number" min={1} max={8} value={numGroups} onChange={(e) => setNumGroups(Number(e.target.value))} />
            </Field>
            <Field label="Times por grupo (opcional)" hint="Meta de times em cada grupo. Deixe em branco para não limitar.">
              <input type="number" min={2} max={64} value={teamsPerGroup} onChange={(e) => setTeamsPerGroup(e.target.value)} placeholder="ex.: 4" />
            </Field>
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

        <div className="form-actions">
          <Button variant="ghost" type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? 'Salvando…' : initial ? 'Salvar alterações' : 'Criar campeonato'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
