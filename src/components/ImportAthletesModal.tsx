import { useMemo, useRef, useState } from 'react'
import { parseAthletesTxt } from '../lib/importAthletes'
import { checkEligibility, checkRosterLimit, formatCpf } from '../lib/eligibility'
import type { Category, Player } from '../types'
import { Button, Field, Modal } from './ui'

export interface ImportInput {
  name: string
  cpf: string
  birthdate: string
  categoryId?: string
  role: 'atleta'
}

interface EvalRow {
  raw: string
  name: string
  cpf: string
  birthdate: string
  ok: boolean
  reason?: string
}

export function ImportAthletesModal({
  categories,
  existing,
  onAdd,
  onClose,
  onDone,
}: {
  categories: Category[]
  existing: Player[]
  onAdd: (input: ImportInput) => Promise<void>
  onClose: () => void
  onDone: () => void
}) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ added: number; failed: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setText(await file.text())
    setResult(null)
  }

  // Avalia cada linha acumulando (respeita limites e exceções da categoria).
  const rows: EvalRow[] = useMemo(() => {
    const parsed = parseAthletesTxt(text)
    const category = categories.find((c) => c.id === categoryId)
    const running: Player[] = existing.filter((p) => p.categoryId === categoryId)
    return parsed.map((p) => {
      if (p.error) return { ...p, ok: false, reason: p.error }
      const elig = checkEligibility({ category, birthdate: p.birthdate, existingInCategory: running })
      if (!elig.ok) return { ...p, ok: false, reason: elig.reason }
      const lim = checkRosterLimit({ category, role: 'atleta', existingInCategory: running })
      if (!lim.ok) return { ...p, ok: false, reason: lim.reason }
      running.push({
        id: `tmp-${running.length}`,
        teamId: '',
        championshipId: '',
        name: p.name,
        birthdate: p.birthdate,
        categoryId,
        role: 'atleta',
        createdAt: '',
      })
      return { ...p, ok: true }
    })
  }, [text, categoryId, categories, existing])

  const okCount = rows.filter((r) => r.ok).length

  async function doImport() {
    setImporting(true)
    let added = 0
    let failed = 0
    for (const r of rows) {
      if (!r.ok) continue
      try {
        await onAdd({ name: r.name, cpf: r.cpf, birthdate: r.birthdate, categoryId: categoryId || undefined, role: 'atleta' })
        added++
      } catch {
        failed++
      }
    }
    setImporting(false)
    setResult({ added, failed })
    if (added > 0) onDone()
  }

  return (
    <Modal title="Importar atletas (.txt)" onClose={onClose} wide>
      <p className="muted small">
        Um atleta por linha, no formato <code>NOME - CPF - DATA DE NASCIMENTO</code>.
        Ex.: <code>João da Silva - 111.444.777-35 - 10/05/2005</code>
      </p>

      <div className="import-controls">
        <input ref={fileRef} type="file" accept=".txt,text/plain" hidden onChange={onFile} />
        <Button variant="soft" type="button" onClick={() => fileRef.current?.click()}>📄 Escolher arquivo .txt</Button>
        {fileName && <span className="muted small">{fileName}</span>}
        {categories.length > 1 && (
          <Field label="Categoria">
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
        )}
      </div>

      <p className="muted small">Ou cole o conteúdo abaixo:</p>
      <textarea
        className="import-textarea"
        rows={5}
        value={text}
        onChange={(e) => { setText(e.target.value); setResult(null) }}
        placeholder={'Maria Souza - 529.982.247-25 - 12/03/2004\nCarlos Lima - 111.444.777-35 - 2005-07-21'}
      />

      {rows.length > 0 && (
        <div className="import-preview">
          <div className="import-preview__head">
            <span><b>{okCount}</b> de {rows.length} prontos para importar</span>
          </div>
          <div className="table-wrap">
            <table className="roster import-table">
              <thead><tr><th></th><th>Nome</th><th>CPF</th><th>Nasc.</th><th>Situação</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={r.ok ? '' : 'import-row--bad'}>
                    <td>{r.ok ? '✅' : '⚠️'}</td>
                    <td>{r.name || <span className="muted">{r.raw}</span>}</td>
                    <td>{r.cpf ? formatCpf(r.cpf) : '—'}</td>
                    <td>{r.birthdate ? r.birthdate.split('-').reverse().join('/') : '—'}</td>
                    <td>{r.ok ? 'OK' : <span className="import-reason">{r.reason}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result && (
        <p className="reg__msg">
          {result.added} atleta(s) importado(s){result.failed ? ` · ${result.failed} falharam` : ''}.
        </p>
      )}

      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onClose}>Fechar</Button>
        <Button type="button" onClick={() => void doImport()} disabled={importing || okCount === 0}>
          {importing ? 'Importando…' : `Importar ${okCount} atleta(s)`}
        </Button>
      </div>
    </Modal>
  )
}
