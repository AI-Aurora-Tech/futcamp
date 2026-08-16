import { useMemo, useRef, useState } from 'react'
import { parseAthletesRows, parseAthletesText, type ParsedAthlete } from '../lib/importAthletes'
import { readSpreadsheet, SpreadsheetError, type SheetRows } from '../lib/spreadsheet'
import { checkEligibility, checkRosterLimit, formatCpf } from '../lib/eligibility'
import { checkCpfConflict } from '../lib/duplicates'
import type { Category, Player } from '../types'
import { Button, Field, Modal } from './ui'

/** Modelo de planilha para o organizador preencher (CSV que o Excel abre). */
function downloadTemplate() {
  const csv = [
    'Nome;CPF;Data de nascimento',
    'Maria Souza;529.982.247-25;12/03/2004',
    'Carlos Lima;111.444.777-35;21/07/2005',
  ].join('\r\n')
  // BOM para o Excel abrir os acentos corretamente.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'modelo-atletas.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

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
  championshipPlayers,
  teamId,
  teamName,
  onAdd,
  onClose,
  onDone,
}: {
  categories: Category[]
  existing: Player[]
  /** Todos os atletas do campeonato — para barrar CPF já inscrito por outro time. */
  championshipPlayers?: Player[]
  /** Time que está recebendo os atletas (necessário para a checagem de CPF). */
  teamId?: string
  teamName?: (teamId: string) => string | undefined
  onAdd: (input: ImportInput) => Promise<void>
  onClose: () => void
  onDone: () => void
}) {
  const [text, setText] = useState('')
  /** Linhas vindas de um arquivo de planilha (têm prioridade sobre o texto). */
  const [sheet, setSheet] = useState<SheetRows | null>(null)
  const [fileName, setFileName] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ added: number; failed: number; firstError?: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setResult(null)
    setFileError(null)
    try {
      const rows = await readSpreadsheet(file)
      if (rows.length === 0) throw new SpreadsheetError('A planilha está vazia.')
      setSheet(rows)
      setText('')
    } catch (err) {
      setSheet(null)
      setFileError(
        err instanceof SpreadsheetError
          ? err.message
          : 'Não foi possível ler o arquivo. Use .xlsx ou salve a planilha como CSV.',
      )
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function clearFile() {
    setSheet(null)
    setFileName('')
    setFileError(null)
    setResult(null)
  }

  // Avalia cada linha acumulando (respeita limites e exceções da categoria).
  const rows: EvalRow[] = useMemo(() => {
    const parsed: ParsedAthlete[] = sheet ? parseAthletesRows(sheet) : parseAthletesText(text)
    const category = categories.find((c) => c.id === categoryId)
    const running: Player[] = existing.filter((p) => p.categoryId === categoryId)
    // Acumula o que já foi aceito neste mesmo arquivo, para pegar CPF repetido.
    const inFile: Player[] = []
    return parsed.map((p, i) => {
      if (p.error) return { ...p, ok: false, reason: p.error }

      // Um CPF, um time no campeonato.
      if (teamId) {
        const conflict = checkCpfConflict({
          cpf: p.cpf,
          teamId,
          categoryId,
          players: [...(championshipPlayers ?? existing), ...inFile],
          teamName,
        })
        if (!conflict.ok) return { ...p, ok: false, reason: conflict.reason }
      }

      const elig = checkEligibility({ category, birthdate: p.birthdate, existingInCategory: running })
      if (!elig.ok) return { ...p, ok: false, reason: elig.reason }
      const lim = checkRosterLimit({ category, role: 'atleta', existingInCategory: running })
      if (!lim.ok) return { ...p, ok: false, reason: lim.reason }
      const pending: Player = {
        id: `tmp-${i}`,
        teamId: teamId ?? '',
        championshipId: '',
        name: p.name,
        cpf: p.cpf,
        birthdate: p.birthdate,
        categoryId,
        role: 'atleta',
        createdAt: '',
      }
      running.push(pending)
      inFile.push(pending)
      return { ...p, ok: true }
    })
  }, [text, sheet, categoryId, categories, existing, championshipPlayers, teamId, teamName])

  const okCount = rows.filter((r) => r.ok).length

  async function doImport() {
    setImporting(true)
    let added = 0
    let failed = 0
    let firstError: string | undefined
    for (const r of rows) {
      if (!r.ok) continue
      try {
        await onAdd({ name: r.name, cpf: r.cpf, birthdate: r.birthdate, categoryId: categoryId || undefined, role: 'atleta' })
        added++
      } catch (err) {
        failed++
        // O motivo da recusa (ex.: CPF já inscrito por outro time) vem do serviço.
        if (!firstError) firstError = `${r.name}: ${err instanceof Error ? err.message : 'erro ao salvar'}`
      }
    }
    setImporting(false)
    setResult({ added, failed, firstError })
    if (added > 0) onDone()
  }

  return (
    <Modal title="Importar atletas por planilha" onClose={onClose} wide>
      <p className="muted small">
        Planilha (<code>.xlsx</code>, <code>.csv</code>) ou arquivo de texto com três colunas por
        atleta: <b>Nome</b>, <b>CPF</b> e <b>Data de nascimento</b>. Se a primeira linha for o
        cabeçalho, as colunas são reconhecidas pelo nome — em qualquer ordem.
      </p>

      <div className="import-controls">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xlsm,.csv,.tsv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          hidden
          onChange={onFile}
        />
        <Button variant="soft" type="button" onClick={() => fileRef.current?.click()}>📊 Escolher planilha</Button>
        <button type="button" className="link-btn" onClick={downloadTemplate}>⬇ baixar modelo</button>
        {fileName && (
          <span className="muted small">
            {sheet ? '📄' : '⚠️'} {fileName}
            {sheet && ` · ${sheet.length} linha(s)`}
            <button type="button" className="link-btn import-clear" onClick={clearFile}>remover</button>
          </span>
        )}
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

      {fileError && <p className="auth-error">{fileError}</p>}

      {!sheet && (
        <>
          <p className="muted small">
            Ou cole as linhas abaixo (direto do Excel, ou no formato <code>NOME - CPF - DATA</code>):
          </p>
          <textarea
            className="import-textarea"
            rows={5}
            value={text}
            onChange={(e) => { setText(e.target.value); setResult(null) }}
            placeholder={'Maria Souza;529.982.247-25;12/03/2004\nCarlos Lima - 111.444.777-35 - 2005-07-21'}
          />
        </>
      )}

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
        <p className={result.failed ? 'auth-error' : 'reg__msg'}>
          {result.added} atleta(s) importado(s){result.failed ? ` · ${result.failed} recusado(s)` : ''}.
          {result.firstError ? ` ${result.firstError}` : ''}
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
