import { useState } from 'react'
import {
  FORMAT_LABELS,
  SPORT_LABELS,
  type Championship,
  type ChampionshipFormat,
  type Sport,
} from '../types'
import { Button, Field, Modal } from './ui'
import type { NewChampionship } from '../services/championships'

const LOGO_CHOICES = ['🏆', '⚽', '🥇', '🔥', '⭐', '🦁', '🦅', '🐯', '🐺', '🛡️']

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
  const [format, setFormat] = useState<ChampionshipFormat>(initial?.format ?? 'league')
  const [season, setSeason] = useState(initial?.season ?? String(new Date().getFullYear()))
  const [description, setDescription] = useState(initial?.description ?? '')
  const [logo, setLogo] = useState(initial?.logo ?? '🏆')
  const [primaryColor, setPrimaryColor] = useState(initial?.primaryColor ?? '#16a34a')
  const [pointsWin, setPointsWin] = useState(initial?.pointsWin ?? 3)
  const [pointsDraw, setPointsDraw] = useState(initial?.pointsDraw ?? 1)
  const [doubleRound, setDoubleRound] = useState(initial?.doubleRound ?? false)
  const [numGroups, setNumGroups] = useState(initial?.numGroups ?? 2)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    await onSave({
      name: name.trim(),
      sport,
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
