import { useState } from 'react'
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
import { Button, Field, Modal } from './ui'
import { uid } from '../lib/id'
import type { NewChampionship } from '../services/championships'

const LOGO_CHOICES = ['🏆', '⚽', '🥇', '🔥', '⭐', '🦁', '🦅', '🐯', '🐺', '🛡️']

interface CatDraft {
  id: string
  name: string
  year: string
  exceptions: string
}

function toDraft(c: Category): CatDraft {
  return {
    id: c.id,
    name: c.name,
    year: c.birthYear != null ? String(c.birthYear) : '',
    exceptions: c.exceptions != null ? String(c.exceptions) : '',
  }
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
    initial?.categories?.length ? initial.categories.map(toDraft) : [{ id: uid('cat'), name: '', year: '', exceptions: '' }],
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
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function updateCat(id: string, patch: Partial<CatDraft>) {
    setCats((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }
  function addCat() {
    setCats((prev) => [...prev, { id: uid('cat'), name: '', year: '', exceptions: '' }])
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
      doubleRound,
      numGroups: format === 'groups_knockout' ? Number(numGroups) : undefined,
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
              : 'Defina a categoria. Opcional: ano de nascimento limite e quantas exceções de idade cada time pode ter.'}
          </p>
          <div className="cats__list">
            {cats.map((c, i) => (
              <div key={c.id} className="cat-row">
                <input
                  className="cat-row__name"
                  value={c.name}
                  onChange={(e) => updateCat(c.id, { name: e.target.value })}
                  placeholder={audience === 'infantil' ? `Ex.: Sub-${13 + i}` : i === 0 ? 'Ex.: Adulto Livre' : 'Ex.: Veterano +40'}
                />
                <input
                  className="cat-row__year"
                  type="number"
                  min={1930}
                  max={2100}
                  value={c.year}
                  onChange={(e) => updateCat(c.id, { year: e.target.value })}
                  placeholder={audience === 'infantil' ? 'ano nasc.' : 'ano (opc.)'}
                  title={audience === 'infantil' ? 'Ano de nascimento da categoria (ou depois)' : 'Ano de nascimento limite (ou antes)'}
                />
                {audience === 'adulto' && (
                  <input
                    className="cat-row__exc"
                    type="number"
                    min={0}
                    max={20}
                    value={c.exceptions}
                    onChange={(e) => updateCat(c.id, { exceptions: e.target.value })}
                    placeholder="exceç."
                    title="Exceções de idade por time"
                  />
                )}
                <button
                  type="button"
                  className="icon-btn icon-btn--danger"
                  title="Remover categoria"
                  onClick={() => removeCat(c.id)}
                  disabled={cats.length <= 1}
                >
                  🗑
                </button>
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
          <Field label="Número de grupos" hint="Use 1 para uma fase única seguida de mata-mata.">
            <input type="number" min={1} max={8} value={numGroups} onChange={(e) => setNumGroups(Number(e.target.value))} />
          </Field>
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

        <Field label="Brasão (emoji)">
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
