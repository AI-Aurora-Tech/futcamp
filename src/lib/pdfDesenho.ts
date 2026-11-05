// ---------------------------------------------------------------------------
// Desenho de páginas em PDF (texto posicionado, retângulos e linhas).
//
// Complementa o `pdf.ts` (texto corrido) para documentos com layout de
// formulário, como a súmula: tabelas, caixas e campos de assinatura. Continua
// sem dependências — só Helvetica e operadores gráficos básicos do PDF.
// ---------------------------------------------------------------------------

import { anexar, bytesDe, escaparWinAnsi, textoUtf16 } from './pdf'

export const A4_LARGURA = 595.28
export const A4_ALTURA = 841.89

/** Larguras da Helvetica (AFM) para ASCII 32–126, em milésimos do corpo. */
const LARGURAS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
  334, 260, 334, 584,
]

/** Remove o acento para medir: "ã" ocupa o mesmo que "a". */
function base(ch: string): string {
  return ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function larguraDe(texto: string, tamanho: number, negrito = false): number {
  let w = 0
  for (const ch of texto) {
    const c = base(ch).charCodeAt(0)
    w += c >= 32 && c <= 126 ? LARGURAS[c - 32] : 556
  }
  return (w / 1000) * tamanho * (negrito ? 1.06 : 1)
}

/** Corta o texto com reticências para caber na largura. */
export function caber(texto: string, tamanho: number, largura: number, negrito = false): string {
  if (larguraDe(texto, tamanho, negrito) <= largura) return texto
  let t = texto
  while (t.length > 1 && larguraDe(`${t}…`, tamanho, negrito) > largura) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}

type Cor = number | [number, number, number]
const rgb = (c: Cor) => (typeof c === 'number' ? [c, c, c] : c).map((n) => n.toFixed(3)).join(' ')

export class Pagina {
  readonly ops: number[] = []
  private push(s: string) {
    anexar(this.ops, bytesDe(s))
  }

  /** `y` é medido do TOPO da página, como numa tela. */
  retangulo(x: number, y: number, w: number, h: number, opt: { fill?: Cor; stroke?: Cor; espessura?: number } = {}) {
    const yb = A4_ALTURA - y - h
    const partes: string[] = []
    if (opt.fill !== undefined) partes.push(`${rgb(opt.fill)} rg`)
    if (opt.stroke !== undefined) partes.push(`${rgb(opt.stroke)} RG ${(opt.espessura ?? 0.6).toFixed(2)} w`)
    const op = opt.fill !== undefined && opt.stroke !== undefined ? 'B' : opt.fill !== undefined ? 'f' : 'S'
    this.push(`${partes.join(' ')} ${x.toFixed(2)} ${yb.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${op}\n`)
  }

  linha(x1: number, y1: number, x2: number, y2: number, cor: Cor = 0, espessura = 0.6) {
    this.push(
      `${rgb(cor)} RG ${espessura.toFixed(2)} w ${x1.toFixed(2)} ${(A4_ALTURA - y1).toFixed(2)} m ` +
        `${x2.toFixed(2)} ${(A4_ALTURA - y2).toFixed(2)} l S\n`,
    )
  }

  /** `y` é a linha de base do texto. */
  texto(
    s: string,
    x: number,
    y: number,
    opt: { tamanho?: number; negrito?: boolean; cor?: Cor; alinhar?: 'e' | 'c' | 'd'; largura?: number } = {},
  ) {
    const tamanho = opt.tamanho ?? 9
    const negrito = opt.negrito ?? false
    let txt = s ?? ''
    if (opt.largura !== undefined) txt = caber(txt, tamanho, opt.largura, negrito)
    const w = larguraDe(txt, tamanho, negrito)
    const px = opt.alinhar === 'd' ? x - w : opt.alinhar === 'c' ? x - w / 2 : x
    this.push(`BT /${negrito ? 'F2' : 'F1'} ${tamanho} Tf ${rgb(opt.cor ?? 0)} rg 1 0 0 1 ${px.toFixed(2)} ${(A4_ALTURA - y).toFixed(2)} Tm (`)
    anexar(this.ops, escaparWinAnsi(txt))
    this.push(') Tj ET\n')
  }
}

/** Monta o arquivo PDF a partir das páginas desenhadas. */
export function gerarPdfPaginas(paginas: Pagina[], titulo: string): Uint8Array {
  const objetos: number[][] = []
  const add = (corpo: number[]) => (objetos.push(corpo), objetos.length)

  const f1 = add(bytesDe('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'))
  const f2 = add(bytesDe('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'))
  const idCatalogo = add([])
  const idPages = add([])

  const ids: number[] = []
  for (const p of paginas) {
    const c = add([...bytesDe(`<< /Length ${p.ops.length} >>\nstream\n`), ...p.ops, ...bytesDe('\nendstream')])
    ids.push(
      add(
        bytesDe(
          `<< /Type /Page /Parent ${idPages} 0 R /MediaBox [0 0 ${A4_LARGURA.toFixed(2)} ${A4_ALTURA.toFixed(2)}] ` +
            `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`,
        ),
      ),
    )
  }
  const idInfo = add([...bytesDe('<< /Title '), ...textoUtf16(titulo), ...bytesDe(' /Producer (Tabelaco) /Creator (Tabelaco) >>')])
  objetos[idCatalogo - 1] = bytesDe(`<< /Type /Catalog /Pages ${idPages} 0 R >>`)
  objetos[idPages - 1] = bytesDe(`<< /Type /Pages /Count ${ids.length} /Kids [${ids.map((i) => `${i} 0 R`).join(' ')}] >>`)

  const arq: number[] = []
  anexar(arq, bytesDe('%PDF-1.4\n'))
  anexar(arq, [0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])
  const pos: number[] = []
  objetos.forEach((corpo, i) => {
    pos[i] = arq.length
    anexar(arq, bytesDe(`${i + 1} 0 obj\n`))
    anexar(arq, corpo)
    anexar(arq, bytesDe('\nendobj\n'))
  })
  const xref = arq.length
  anexar(arq, bytesDe(`xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`))
  for (const p of pos) anexar(arq, bytesDe(`${String(p).padStart(10, '0')} 00000 n \n`))
  anexar(arq, bytesDe(`trailer\n<< /Size ${objetos.length + 1} /Root ${idCatalogo} 0 R /Info ${idInfo} 0 R >>\nstartxref\n${xref}\n%%EOF\n`))
  return new Uint8Array(arq)
}

/** Dispara o download dos bytes de um PDF. */
export function baixarBytesPdf(bytes: Uint8Array, nomeArquivo: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo.endsWith('.pdf') ? nomeArquivo : `${nomeArquivo}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
