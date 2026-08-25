// ---------------------------------------------------------------------------
// Gerador de PDF mínimo.
//
// Por que não uma biblioteca: o Tabelaço não tem dependência de runtime além
// de React e Supabase, e as bibliotecas de PDF pesam centenas de KB — mais do
// que o app inteiro, para gerar um documento de texto. Aqui só precisamos de
// texto corrido em Helvetica, e isso o formato PDF resolve em poucas linhas.
//
// Limites conscientes: uma fonte (Helvetica, normal e negrito), sem imagens,
// sem tabelas de verdade. Acentuação vai por WinAnsiEncoding, que cobre o
// português — caractere fora dessa tabela vira "?" em vez de quebrar o arquivo.
// ---------------------------------------------------------------------------

export type EstiloTexto = 'titulo' | 'subtitulo' | 'secao' | 'corpo' | 'item' | 'nota'

export interface Linha {
  texto: string
  estilo?: EstiloTexto
}

interface Estilo {
  tamanho: number
  negrito: boolean
  antes: number
  depois: number
  recuo: number
}

const ESTILOS: Record<EstiloTexto, Estilo> = {
  titulo: { tamanho: 20, negrito: true, antes: 0, depois: 6, recuo: 0 },
  subtitulo: { tamanho: 11, negrito: false, antes: 0, depois: 16, recuo: 0 },
  secao: { tamanho: 13, negrito: true, antes: 16, depois: 6, recuo: 0 },
  corpo: { tamanho: 10.5, negrito: false, antes: 0, depois: 5, recuo: 0 },
  item: { tamanho: 10.5, negrito: false, antes: 0, depois: 4, recuo: 14 },
  nota: { tamanho: 9, negrito: false, antes: 10, depois: 4, recuo: 0 },
}

// A4 em pontos, com margens generosas para leitura em papel.
const LARGURA = 595.28
const ALTURA = 841.89
const MARGEM = 56
const UTIL = LARGURA - MARGEM * 2

/**
 * Largura média de um caractere, em fração do tamanho da fonte.
 *
 * Helvetica tem uma tabela de larguras por caractere; usar a média mantém o
 * gerador pequeno ao custo de a quebra de linha ser aproximada. Como o texto
 * é corrido e a margem é folgada, a diferença não aparece.
 */
const FATOR = 0.5

function larguraTexto(texto: string, tamanho: number, negrito: boolean): number {
  return texto.length * tamanho * (negrito ? FATOR + 0.03 : FATOR)
}

/** Quebra o texto na largura disponível, respeitando palavras. */
export function quebrar(texto: string, tamanho: number, negrito: boolean, largura: number): string[] {
  const palavras = (texto ?? '').split(/\s+/).filter(Boolean)
  if (!palavras.length) return ['']

  const linhas: string[] = []
  let atual = ''
  for (const palavra of palavras) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra
    if (larguraTexto(tentativa, tamanho, negrito) <= largura || !atual) {
      atual = tentativa
    } else {
      linhas.push(atual)
      atual = palavra
    }
  }
  if (atual) linhas.push(atual)
  return linhas
}

/**
 * Escapa o que o PDF trata como sintaxe dentro de uma string literal e
 * converte para WinAnsi (Latin-1). Fora da tabela vira "?" — melhor um
 * caractere errado do que um arquivo corrompido.
 */
/**
 * A faixa 0x80–0x9F do WinAnsi não é Latin-1: ela guarda a tipografia que o
 * texto de verdade usa — marcador, travessão, aspas curvas, reticências.
 * Sem esta tabela, o "•" de cada item do regulamento vira "?".
 */
const WINANSI_ESPECIAIS: Record<number, number> = {
  0x20ac: 0x80, // €
  0x201a: 0x82, // ‚
  0x0192: 0x83, // ƒ
  0x201e: 0x84, // „
  0x2026: 0x85, // …
  0x2020: 0x86, // †
  0x2021: 0x87, // ‡
  0x02c6: 0x88, // ˆ
  0x2030: 0x89, // ‰
  0x0160: 0x8a, // Š
  0x2039: 0x8b, // ‹
  0x0152: 0x8c, // Œ
  0x017d: 0x8e, // Ž
  0x2018: 0x91, // '
  0x2019: 0x92, // '
  0x201c: 0x93, // "
  0x201d: 0x94, // "
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x02dc: 0x98, // ˜
  0x2122: 0x99, // ™
  0x0161: 0x9a, // š
  0x203a: 0x9b, // ›
  0x0153: 0x9c, // œ
  0x017e: 0x9e, // ž
  0x0178: 0x9f, // Ÿ
}

export function escaparWinAnsi(texto: string): number[] {
  const bytes: number[] = []
  for (const ch of texto ?? '') {
    const cp = ch.codePointAt(0) ?? 63
    let b: number
    if (WINANSI_ESPECIAIS[cp] !== undefined) b = WINANSI_ESPECIAIS[cp]
    else if (cp <= 0xff) b = cp
    else b = 63 // ?
    if (b === 0x28 || b === 0x29 || b === 0x5c) bytes.push(0x5c) // ( ) \
    bytes.push(b)
  }
  return bytes
}

/**
 * Acrescenta um bloco de bytes no fim de outro.
 *
 * `destino.push(...origem)` passa cada byte como argumento e estoura a pilha
 * quando a origem tem dezenas de milhares de itens — exatamente o tamanho de
 * um regulamento longo.
 */
function anexar(destino: number[], origem: readonly number[]): void {
  for (let i = 0; i < origem.length; i++) destino.push(origem[i])
}

function bytesDe(texto: string): number[] {
  // Cabeçalhos e comandos do PDF são ASCII puro.
  const out: number[] = []
  for (let i = 0; i < texto.length; i++) out.push(texto.charCodeAt(i) & 0xff)
  return out
}

/**
 * Texto para os METADADOS do arquivo (o /Title, que vira o nome na aba do
 * navegador e nas propriedades do arquivo).
 *
 * Aqui NÃO vale o WinAnsi do conteúdo: leitor de PDF interpreta string de
 * metadado como PDFDocEncoding, e os dois discordam justamente na faixa
 * 0x80–0x9F — o travessão de "Regulamento — Copa" saía como "Š". A forma que
 * todo leitor entende sem ambiguidade é UTF-16BE com marca de ordem de bytes,
 * escrita em hexadecimal.
 */
export function textoUtf16(texto: string): number[] {
  const bytes: number[] = [0x3c, 0x46, 0x45, 0x46, 0x46] // "<FEFF"
  for (const ch of texto) {
    const cp = ch.codePointAt(0) ?? 0
    const unidades =
      cp > 0xffff
        ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)]
        : [cp]
    for (const u of unidades) {
      for (const nibble of u.toString(16).toUpperCase().padStart(4, '0')) {
        bytes.push(nibble.charCodeAt(0))
      }
    }
  }
  bytes.push(0x3e) // ">"
  return bytes
}

export interface DocumentoPdf {
  titulo: string
  linhas: Linha[]
  /** Texto do rodapé, repetido em todas as páginas. */
  rodape?: string
}

/**
 * Monta o PDF e devolve os bytes.
 *
 * Separado do `baixarPdf` para dar para testar sem navegador.
 */
export function gerarPdf(doc: DocumentoPdf): Uint8Array {
  // 1. Distribui as linhas em páginas.
  const paginas: { texto: string; estilo: Estilo; y: number }[][] = []
  let pagina: { texto: string; estilo: Estilo; y: number }[] = []
  let y = ALTURA - MARGEM

  const novaPagina = () => {
    paginas.push(pagina)
    pagina = []
    y = ALTURA - MARGEM
  }

  for (const linha of doc.linhas ?? []) {
    const e = ESTILOS[linha.estilo ?? 'corpo']
    const alturaLinha = e.tamanho * 1.35
    y -= e.antes

    for (const pedaco of quebrar(linha.texto, e.tamanho, e.negrito, UTIL - e.recuo)) {
      // Deixa espaço para o rodapé.
      if (y - alturaLinha < MARGEM + 20) novaPagina()
      y -= alturaLinha
      pagina.push({ texto: pedaco, estilo: e, y })
    }
    y -= e.depois
  }
  paginas.push(pagina)

  // 2. Monta o fluxo de desenho de cada página.
  const conteudos = paginas.map((linhas, i) => {
    const partes: number[] = []
    const push = (s: string) => anexar(partes, bytesDe(s))

    for (const l of linhas) {
      push(`BT /${l.estilo.negrito ? 'F2' : 'F1'} ${l.estilo.tamanho} Tf `)
      push(`1 0 0 1 ${(MARGEM + l.estilo.recuo).toFixed(2)} ${l.y.toFixed(2)} Tm (`)
      anexar(partes, escaparWinAnsi(l.texto))
      push(') Tj ET\n')
    }

    const rodape = `${doc.rodape ? `${doc.rodape} · ` : ''}Página ${i + 1} de ${paginas.length}`
    push(`BT /F1 8 Tf 1 0 0 1 ${MARGEM} ${MARGEM - 14} Tm 0.45 0.45 0.45 rg (`)
    anexar(partes, escaparWinAnsi(rodape))
    push(') Tj ET\n')

    return partes
  })

  // 3. Objetos do arquivo.
  const objetos: number[][] = []
  const add = (corpo: number[]) => {
    objetos.push(corpo)
    return objetos.length // números de objeto começam em 1
  }

  const idFonteNormal = add(
    bytesDe('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
  )
  const idFonteNegrito = add(
    bytesDe('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
  )

  // Reserva os números: páginas e conteúdos vêm depois do catálogo/pages.
  const idCatalogo = add([])
  const idPages = add([])

  const idsPagina: number[] = []
  for (const conteudo of conteudos) {
    const idConteudo = add([
      ...bytesDe(`<< /Length ${conteudo.length} >>\nstream\n`),
      ...conteudo,
      ...bytesDe('\nendstream'),
    ])
    idsPagina.push(
      add(
        bytesDe(
          `<< /Type /Page /Parent ${idPages} 0 R /MediaBox [0 0 ${LARGURA.toFixed(2)} ${ALTURA.toFixed(2)}] ` +
            `/Resources << /Font << /F1 ${idFonteNormal} 0 R /F2 ${idFonteNegrito} 0 R >> >> ` +
            `/Contents ${idConteudo} 0 R >>`,
        ),
      ),
    )
  }

  const idInfo = add([
    ...bytesDe('<< /Title '),
    ...textoUtf16(doc.titulo),
    ...bytesDe(' /Producer (Tabelaco) /Creator (Tabelaco) >>'),
  ])

  objetos[idCatalogo - 1] = bytesDe(`<< /Type /Catalog /Pages ${idPages} 0 R >>`)
  objetos[idPages - 1] = bytesDe(
    `<< /Type /Pages /Count ${idsPagina.length} /Kids [${idsPagina.map((i) => `${i} 0 R`).join(' ')}] >>`,
  )

  // 4. Escreve o arquivo, anotando onde cada objeto começa (o xref exige o
  //    deslocamento em BYTES, não em caracteres).
  const arquivo: number[] = []
  const escrever = (bytes: readonly number[]) => anexar(arquivo, bytes)
  escrever(bytesDe('%PDF-1.4\n'))
  // Comentário binário: marca o arquivo como não-texto para os leitores.
  escrever([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])

  const posicoes: number[] = []
  objetos.forEach((corpo, i) => {
    posicoes[i] = arquivo.length
    escrever(bytesDe(`${i + 1} 0 obj\n`))
    escrever(corpo)
    escrever(bytesDe('\nendobj\n'))
  })

  const inicioXref = arquivo.length
  escrever(bytesDe(`xref\n0 ${objetos.length + 1}\n`))
  escrever(bytesDe('0000000000 65535 f \n'))
  for (const pos of posicoes) {
    escrever(bytesDe(`${String(pos).padStart(10, '0')} 00000 n \n`))
  }
  escrever(
    bytesDe(
      `trailer\n<< /Size ${objetos.length + 1} /Root ${idCatalogo} 0 R /Info ${idInfo} 0 R >>\n` +
        `startxref\n${inicioXref}\n%%EOF\n`,
    ),
  )

  return new Uint8Array(arquivo)
}

/** Gera o PDF e dispara o download no navegador. */
export function baixarPdf(doc: DocumentoPdf, nomeArquivo: string): void {
  const bytes = gerarPdf(doc)
  // `slice()` devolve um ArrayBuffer próprio — é o que o Blob aceita sem
  // reclamar do tipo do buffer subjacente.
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo.endsWith('.pdf') ? nomeArquivo : `${nomeArquivo}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Espera o navegador começar o download antes de soltar o objeto.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
