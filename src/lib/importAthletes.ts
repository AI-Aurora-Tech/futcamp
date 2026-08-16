// ---------------------------------------------------------------------------
// Importação de atletas a partir de PLANILHA (.xlsx, .csv, .tsv) ou de texto
// colado, sempre com três informações por atleta:
//
//   NOME | CPF | DATA DE NASCIMENTO
//
// A planilha pode ter cabeçalho (as colunas são reconhecidas pelo nome, em
// qualquer ordem) ou vir direto com os dados nessa ordem. No texto colado
// valem os separadores " - ", ";", tabulação ou vírgula.
//
// Datas aceitas: dd/mm/aaaa, dd-mm-aaaa, aaaa-mm-dd ou o número de série do
// Excel. O CPF pode vir com ou sem máscara (e sem os zeros à esquerda que o
// Excel costuma comer).
// ---------------------------------------------------------------------------
import { isValidCpf } from './eligibility'
import { excelSerialToDate, parseDelimited, type SheetRows } from './spreadsheet'

export interface ParsedAthlete {
  raw: string
  name: string
  cpf: string // apenas dígitos
  birthdate: string // ISO aaaa-mm-dd (ou '' se inválida)
  error?: string
}

/** Normaliza uma data para ISO (aaaa-mm-dd) ou retorna '' se inválida. */
export function normalizeDate(input: string): string {
  let s = input.trim()
  if (!s) return ''

  // Número de série do Excel (ex.: 38412 = 21/03/2005).
  if (/^\d{5}$/.test(s)) {
    const serial = Number(s)
    if (serial >= 10000 && serial <= 60000) s = excelSerialToDate(serial)
  }
  // Data completa com hora ("2005-03-21T00:00:00" ou "21/03/2005 00:00").
  s = s.split(/[T ]/)[0]

  let y = 0
  let m = 0
  let d = 0
  const mIso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  const mBr = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s)
  if (mIso) {
    y = Number(mIso[1])
    m = Number(mIso[2])
    d = Number(mIso[3])
  } else if (mBr) {
    d = Number(mBr[1])
    m = Number(mBr[2])
    y = Number(mBr[3])
  } else {
    return ''
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const iso = `${y}-${pad(m)}-${pad(d)}`
  // valida via Date (rejeita 31/02 etc.)
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime()) || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) return ''
  return iso
}

/**
 * Só dígitos. Quando o CPF é gravado como NÚMERO na planilha, o Excel come os
 * zeros à esquerda — por isso 9 ou 10 dígitos são completados. Valores mais
 * curtos são lixo e seguem como estão, para o erro ficar visível.
 */
function normalizeCpf(input: string): string {
  const digits = input.replace(/\D/g, '')
  return digits.length === 9 || digits.length === 10 ? digits.padStart(11, '0') : digits
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .trim()

/** Colunas de nome, CPF e nascimento — descobertas pelo cabeçalho. */
interface ColumnMap {
  name: number
  cpf: number
  birthdate: number
}

const DEFAULT_COLUMNS: ColumnMap = { name: 0, cpf: 1, birthdate: 2 }

/**
 * Reconhece a linha de cabeçalho e mapeia as colunas. Devolve `null` quando a
 * primeira linha já é um atleta (planilha sem cabeçalho).
 */
export function detectHeader(row: string[]): ColumnMap | null {
  const cells = row.map(norm)
  const find = (test: (c: string) => boolean) => cells.findIndex(test)
  const name = find((c) => c === 'nome' || c.startsWith('nome') || c.includes('atleta') || c.includes('jogador'))
  const cpf = find((c) => c.includes('cpf') || c.includes('documento'))
  const birthdate = find((c) => c.includes('nasc') || c.includes('data'))
  if (name < 0 || (cpf < 0 && birthdate < 0)) return null
  return {
    name,
    cpf: cpf >= 0 ? cpf : DEFAULT_COLUMNS.cpf,
    birthdate: birthdate >= 0 ? birthdate : DEFAULT_COLUMNS.birthdate,
  }
}

function evaluate(name: string, cpfRaw: string, dateRaw: string, raw: string): ParsedAthlete {
  const cpf = normalizeCpf(cpfRaw)
  const birthdate = normalizeDate(dateRaw)
  let error: string | undefined
  if (!name) error = 'Nome vazio.'
  else if (!cpf) error = 'CPF não informado.'
  else if (!isValidCpf(cpf)) error = 'CPF inválido.'
  else if (!dateRaw.trim()) error = 'Data de nascimento não informada.'
  else if (!birthdate) error = 'Data de nascimento inválida.'
  return { raw, name, cpf, birthdate, error }
}

/**
 * Converte as linhas de uma planilha em atletas, pulando o cabeçalho quando
 * ele existir.
 */
export function parseAthletesRows(rows: SheetRows): ParsedAthlete[] {
  const clean = rows.filter((r) => r.some((c) => (c ?? '').trim() !== ''))
  if (clean.length === 0) return []

  const header = detectHeader(clean[0])
  const cols = header ?? DEFAULT_COLUMNS
  const body = header ? clean.slice(1) : clean

  return body.map((row) => {
    const cell = (i: number) => (row[i] ?? '').trim()
    const raw = row.join(' | ')
    return evaluate(cell(cols.name), cell(cols.cpf), cell(cols.birthdate), raw)
  })
}

/**
 * Analisa texto colado. Cada linha é um atleta; o separador pode ser " - ",
 * ";", tabulação ou vírgula (o mesmo que sai de um "copiar" do Excel).
 */
export function parseAthletesText(text: string): ParsedAthlete[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'))
  if (lines.length === 0) return []

  // Formato clássico "NOME - CPF - DATA" (mantido por compatibilidade).
  if (lines.every((l) => /\s+-\s+/.test(l))) {
    return lines.map((line) => {
      const raw = line.trim()
      const parts = raw.split(/\s+-\s+/)
      if (parts.length < 3) {
        return { raw, name: '', cpf: '', birthdate: '', error: 'Formato inválido (use NOME - CPF - DATA).' }
      }
      return evaluate(parts[0].trim(), parts[1], parts.slice(2).join(' - '), raw)
    })
  }

  return parseAthletesRows(parseDelimited(lines.join('\n')))
}

/** @deprecated Use `parseAthletesText`. Mantido para compatibilidade. */
export const parseAthletesTxt = parseAthletesText
