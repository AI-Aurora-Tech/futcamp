// ---------------------------------------------------------------------------
// Importação de atletas a partir de arquivo .txt no formato, uma por linha:
//   NOME - CPF - DATA DE NASCIMENTO
// Ex.: João da Silva - 111.444.777-35 - 10/05/2005
//
// Datas aceitas: dd/mm/aaaa, dd-mm-aaaa ou aaaa-mm-dd. O CPF pode vir com ou sem
// máscara. Linhas em branco e começadas por "#" são ignoradas.
// ---------------------------------------------------------------------------
import { isValidCpf } from './eligibility'

export interface ParsedAthlete {
  raw: string
  name: string
  cpf: string // apenas dígitos
  birthdate: string // ISO aaaa-mm-dd (ou '' se inválida)
  error?: string
}

/** Normaliza uma data para ISO (aaaa-mm-dd) ou retorna '' se inválida. */
export function normalizeDate(input: string): string {
  const s = input.trim()
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

/** Analisa o conteúdo do arquivo e valida cada linha. */
export function parseAthletesTxt(text: string): ParsedAthlete[] {
  const out: ParsedAthlete[] = []
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    const raw = line.trim()
    if (!raw || raw.startsWith('#')) continue
    // separador " - " (com espaços) para não conflitar com hífens de data
    const parts = raw.split(/\s+-\s+/)
    if (parts.length < 3) {
      out.push({ raw, name: '', cpf: '', birthdate: '', error: 'Formato inválido (use NOME - CPF - DATA).' })
      continue
    }
    const name = parts[0].trim()
    const cpfDigits = parts[1].replace(/\D/g, '')
    const birthdate = normalizeDate(parts.slice(2).join(' - '))

    let error: string | undefined
    if (!name) error = 'Nome vazio.'
    else if (!isValidCpf(cpfDigits)) error = 'CPF inválido.'
    else if (!birthdate) error = 'Data de nascimento inválida.'

    out.push({ raw, name, cpf: cpfDigits, birthdate, error })
  }
  return out
}
