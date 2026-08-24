// ---------------------------------------------------------------------------
// Leitura de planilhas no navegador, sem dependências externas.
//
//  • .xlsx (Excel, Google Planilhas, LibreOffice) — o arquivo é um ZIP com XML;
//    aqui ele é descompactado com `DecompressionStream('deflate-raw')` e as
//    células são lidas de `sheet1.xml` + `sharedStrings.xml`. Datas vêm como
//    número de série do Excel e são convertidas para dd/mm/aaaa.
//  • .csv / .tsv / .txt — separador detectado automaticamente (`;`, `,`, tab)
//    com suporte a campos entre aspas.
//
// O resultado é sempre uma matriz de texto (linhas × colunas).
// ---------------------------------------------------------------------------

/** Uma planilha lida: linhas de células já convertidas em texto. */
export type SheetRows = string[][]

export class SpreadsheetError extends Error {}

/* -------------------------------------------------------------------------- */
/* CSV / TSV                                                                   */
/* -------------------------------------------------------------------------- */

/** Descobre o separador mais provável olhando as primeiras linhas. */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n')
  const counts: Record<string, number> = {
    ';': (sample.match(/;/g) ?? []).length,
    '\t': (sample.match(/\t/g) ?? []).length,
    ',': (sample.match(/,/g) ?? []).length,
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return best && best[1] > 0 ? best[0] : ';'
}

/** Converte texto delimitado (CSV/TSV) em linhas × colunas. */
export function parseDelimited(text: string, delimiter = detectDelimiter(text)): SheetRows {
  const rows: SheetRows = []
  let row: string[] = []
  let field = ''
  let quoted = false

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  // Remove BOM (Excel grava UTF-8 com BOM).
  const src = text.replace(/^﻿/, '')

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === delimiter) endField()
    else if (ch === '\r') continue
    else if (ch === '\n') endRow()
    else field += ch
  }
  if (field || row.length) endRow()

  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/* -------------------------------------------------------------------------- */
/* XLSX                                                                        */
/* -------------------------------------------------------------------------- */

interface ZipEntry {
  name: string
  offset: number
  compression: number
  compressedSize: number
}

const u16 = (v: DataView, p: number) => v.getUint16(p, true)
const u32 = (v: DataView, p: number) => v.getUint32(p, true)

/** Lê o diretório central do ZIP e devolve as entradas. */
function readZipEntries(buf: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buf)
  // Fim do diretório central (EOCD): assinatura 0x06054b50, procurada do fim.
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= 0 && i > buf.byteLength - 22 - 65536; i--) {
    if (u32(view, i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new SpreadsheetError('Arquivo .xlsx inválido (não parece um ZIP).')

  const count = u16(view, eocd + 10)
  let p = u32(view, eocd + 16)
  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (u32(view, p) !== 0x02014b50) break
    const compression = u16(view, p + 10)
    const compressedSize = u32(view, p + 20)
    const nameLen = u16(view, p + 28)
    const extraLen = u16(view, p + 30)
    const commentLen = u16(view, p + 32)
    const localOffset = u32(view, p + 42)
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen))
    entries.push({ name, offset: localOffset, compression, compressedSize })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** Extrai (e descompacta) um arquivo do ZIP como texto. */
async function readZipFile(buf: ArrayBuffer, entry: ZipEntry): Promise<string> {
  const view = new DataView(buf)
  if (u32(view, entry.offset) !== 0x04034b50) {
    throw new SpreadsheetError('Arquivo .xlsx corrompido.')
  }
  const nameLen = u16(view, entry.offset + 26)
  const extraLen = u16(view, entry.offset + 28)
  const start = entry.offset + 30 + nameLen + extraLen
  const raw = new Uint8Array(buf, start, entry.compressedSize)

  if (entry.compression === 0) return new TextDecoder().decode(raw)
  if (entry.compression !== 8) {
    throw new SpreadsheetError('Compactação do .xlsx não suportada. Salve a planilha como CSV.')
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new SpreadsheetError(
      'Este navegador não consegue abrir .xlsx. Salve a planilha como CSV e tente de novo.',
    )
  }
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Response(stream).text()
}

/** Número de série do Excel → data dd/mm/aaaa. */
export function excelSerialToDate(serial: number): string {
  // Epoch 30/12/1899 compensa o bug do ano bissexto de 1900 do Excel.
  const ms = Math.round(serial) * 86400000
  const d = new Date(Date.UTC(1899, 11, 30) + ms)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}

/** Formatos de data embutidos do Excel. */
const BUILTIN_DATE_FMT = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57, 58])

/** Índices de estilo que representam datas (para converter o número de série). */
function readDateStyles(stylesXml: string | null): Set<number> {
  const out = new Set<number>()
  if (!stylesXml) return out
  const doc = new DOMParser().parseFromString(stylesXml, 'application/xml')

  const customDate = new Set<number>()
  doc.querySelectorAll('numFmt').forEach((el) => {
    const id = Number(el.getAttribute('numFmtId'))
    const code = (el.getAttribute('formatCode') ?? '').toLowerCase()
    // Um formato é de data quando tem dia/mês/ano fora de aspas.
    if (/[dmyh]/.test(code.replace(/"[^"]*"/g, '')) && /d|y/.test(code)) customDate.add(id)
  })

  const cellXfs = doc.querySelector('cellXfs')
  if (!cellXfs) return out
  Array.from(cellXfs.children).forEach((xf, i) => {
    const id = Number(xf.getAttribute('numFmtId') ?? 0)
    if (BUILTIN_DATE_FMT.has(id) || customDate.has(id)) out.add(i)
  })
  return out
}

/** Índice da coluna a partir da referência da célula ("B7" → 1). */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref.toUpperCase())?.[0] ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** Lê a primeira planilha de um arquivo .xlsx. */
export async function parseXlsx(buf: ArrayBuffer): Promise<SheetRows> {
  const entries = readZipEntries(buf)
  const find = (name: string) => entries.find((e) => e.name === name)
  const sheetEntry =
    find('xl/worksheets/sheet1.xml') ??
    entries.find((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
  if (!sheetEntry) throw new SpreadsheetError('Não encontrei nenhuma aba na planilha.')

  const sheetXml = await readZipFile(buf, sheetEntry)
  const sharedEntry = find('xl/sharedStrings.xml')
  const stylesEntry = find('xl/styles.xml')
  const sharedXml = sharedEntry ? await readZipFile(buf, sharedEntry) : null
  const stylesXml = stylesEntry ? await readZipFile(buf, stylesEntry) : null

  const parser = new DOMParser()
  const shared: string[] = []
  if (sharedXml) {
    const doc = parser.parseFromString(sharedXml, 'application/xml')
    doc.querySelectorAll('si').forEach((si) => {
      shared.push(Array.from(si.querySelectorAll('t')).map((t) => t.textContent ?? '').join(''))
    })
  }
  const dateStyles = readDateStyles(stylesXml)

  const doc = parser.parseFromString(sheetXml, 'application/xml')
  const rows: SheetRows = []
  doc.querySelectorAll('row').forEach((rowEl) => {
    const cells: string[] = []
    rowEl.querySelectorAll('c').forEach((c) => {
      const idx = columnIndex(c.getAttribute('r') ?? '')
      const type = c.getAttribute('t')
      let value = ''
      if (type === 'inlineStr') {
        value = Array.from(c.querySelectorAll('t')).map((t) => t.textContent ?? '').join('')
      } else {
        const v = c.querySelector('v')?.textContent ?? ''
        if (type === 's') value = shared[Number(v)] ?? ''
        else if (v !== '') {
          const styleIdx = Number(c.getAttribute('s') ?? -1)
          const num = Number(v)
          value =
            dateStyles.has(styleIdx) && Number.isFinite(num) && num > 0
              ? excelSerialToDate(num)
              : v
        }
      }
      while (cells.length < idx) cells.push('')
      cells[idx] = value
    })
    rows.push(cells)
  })

  return rows.filter((r) => r.some((c) => (c ?? '').trim() !== ''))
}

/* -------------------------------------------------------------------------- */
/* Entrada única                                                               */
/* -------------------------------------------------------------------------- */

/** Lê qualquer arquivo suportado (.xlsx, .csv, .tsv, .txt) como linhas. */
export async function readSpreadsheet(file: File): Promise<SheetRows> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
    return parseXlsx(await file.arrayBuffer())
  }
  if (name.endsWith('.xls')) {
    throw new SpreadsheetError(
      'O formato .xls (Excel antigo) não é suportado. Salve como .xlsx ou CSV.',
    )
  }
  return parseDelimited(await file.text())
}
