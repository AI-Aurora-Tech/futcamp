// ---------------------------------------------------------------------------
// Relação de elenco em PDF: atletas e comissão técnica inscritos.
//
// É o papel que o organizador leva para conferir quem está inscrito — o mesmo
// recorte da súmula (atleta e comissão técnica, com CPF), mas do campeonato,
// time a time, e não de uma partida. Um time por página; se o elenco não cabe,
// continua na seguinte com o cabeçalho da tabela repetido.
//
// Sem dependências: usa o desenho de páginas do `pdfDesenho.ts`.
// ---------------------------------------------------------------------------
import { A4_ALTURA, A4_LARGURA, Pagina, gerarPdfPaginas } from './pdfDesenho'
import { formatCpf } from './eligibility'
import { porNome } from './ordem'
import { labelDaPosicao, type Category, type Championship, type Player, type Team } from '../types'

/** 1998-03-27 → 27/03/1998, sem passar por Date (fuso não pode mexer no dia). */
export function dataBr(iso?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

interface Coluna {
  rotulo: string
  /** Fração da largura útil. */
  frac: number
  alinhar?: 'e' | 'c'
}

/** Atletas e comissão técnica de um time, já separados e na ordem da tela (A–Z). */
export function separarElenco(players: Player[], teamId: string): { atletas: Player[]; comissao: Player[] } {
  const doTime = players.filter((p) => p.teamId === teamId)
  return {
    atletas: doTime.filter((p) => (p.role ?? 'atleta') === 'atleta').sort(porNome),
    comissao: doTime.filter((p) => p.role === 'comissao').sort(porNome),
  }
}

/**
 * Monta o PDF com a relação de elenco dos times informados.
 *
 * `players` deve vir já recortado na categoria (é o que a tela de elencos
 * mostra); `category` só dá nome ao cabeçalho.
 */
export function buildElencoPdf(params: {
  championship: Championship
  category?: Category
  teams: Team[]
  players: Player[]
  emitidoEm?: Date
}): Uint8Array {
  const { championship, category, teams, players } = params
  const emitido = (params.emitidoEm ?? new Date()).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  const M = 36
  const W = A4_LARGURA - M * 2
  const LIMITE = A4_ALTURA - 44 // deixa o rodapé livre
  const ESCURO = 0.12
  const ZEBRA = 0.955
  const ALTURA_LINHA = 16

  const paginas: Pagina[] = []
  let pg = new Pagina()
  let y = M
  paginas.push(pg)

  const cabecalho = () => {
    pg.retangulo(M, y, W, 42, { stroke: 0, espessura: 1 })
    pg.texto(championship.name, M + 10, y + 19, { tamanho: 14, negrito: true, largura: W - 200 })
    pg.texto(
      [category?.name, championship.season].filter(Boolean).join(' - ') || 'Campeonato',
      M + 10,
      y + 34,
      { tamanho: 9.5, cor: 0.35, largura: W - 200 },
    )
    pg.texto('RELAÇÃO DE ELENCO', M + W - 10, y + 27, { tamanho: 14, negrito: true, alinhar: 'd' })
    y += 52
  }
  const novaPagina = () => {
    pg = new Pagina()
    paginas.push(pg)
    y = M
    cabecalho()
  }
  const garantir = (h: number) => {
    if (y + h > LIMITE) novaPagina()
  }

  const cabecaTabela = (colunas: Coluna[]) => {
    pg.retangulo(M, y, W, 15, { fill: 0.85, stroke: 0, espessura: 0.5 })
    let x = M
    for (const c of colunas) {
      const w = W * c.frac
      pg.texto(c.rotulo.toUpperCase(), c.alinhar === 'c' ? x + w / 2 : x + 5, y + 10.5, {
        tamanho: 7.5, negrito: true, alinhar: c.alinhar === 'c' ? 'c' : 'e', largura: w - 8,
      })
      x += w
    }
    y += 15
  }

  /** Faixa escura com o título + cabeça das colunas + linhas (quebrando página). */
  const tabela = (titulo: string, colunas: Coluna[], linhas: string[][], vazio: string) => {
    // Título, cabeça e ao menos uma linha juntos: nunca um título sozinho no fim da página.
    garantir(15 + 15 + ALTURA_LINHA + 4)
    pg.retangulo(M, y, W, 15, { fill: ESCURO })
    pg.texto(`${titulo.toUpperCase()}  (${linhas.length})`, M + 6, y + 10.5, { tamanho: 8.5, negrito: true, cor: 1 })
    y += 15
    cabecaTabela(colunas)

    if (linhas.length === 0) {
      pg.retangulo(M, y, W, ALTURA_LINHA, { stroke: 0.6, espessura: 0.4 })
      pg.texto(vazio, M + 6, y + 11, { tamanho: 9, cor: 0.45 })
      y += ALTURA_LINHA
      return
    }

    linhas.forEach((linha, i) => {
      if (y + ALTURA_LINHA > LIMITE) {
        novaPagina()
        cabecaTabela(colunas) // continua a mesma tabela na página nova
      }
      if (i % 2 === 1) pg.retangulo(M, y, W, ALTURA_LINHA, { fill: ZEBRA })
      let x = M
      colunas.forEach((c, k) => {
        const w = W * c.frac
        pg.texto(linha[k] ?? '', c.alinhar === 'c' ? x + w / 2 : x + 5, y + 11, {
          tamanho: 9, alinhar: c.alinhar === 'c' ? 'c' : 'e', largura: w - 8,
        })
        x += w
      })
      pg.linha(M, y + ALTURA_LINHA, M + W, y + ALTURA_LINHA, 0.8, 0.3)
      y += ALTURA_LINHA
    })
    // Contorno da tabela: fecha a lateral sem desenhar caixa por linha.
    y += 0
  }

  const COLUNAS_ATLETA: Coluna[] = [
    { rotulo: 'Nº', frac: 0.07, alinhar: 'c' },
    { rotulo: 'Nome', frac: 0.43 },
    { rotulo: 'Nascimento', frac: 0.14 },
    { rotulo: 'CPF', frac: 0.18 },
    { rotulo: 'Posição', frac: 0.18 },
  ]
  const COLUNAS_COMISSAO: Coluna[] = [
    { rotulo: 'Nome', frac: 0.5 },
    { rotulo: 'Função', frac: 0.18 },
    { rotulo: 'Nascimento', frac: 0.14 },
    { rotulo: 'CPF', frac: 0.18 },
  ]

  cabecalho()

  const lista = teams.length ? teams : []
  lista.forEach((team, idx) => {
    // Cada time começa em página própria.
    if (idx > 0) novaPagina()
    const { atletas, comissao } = separarElenco(players, team.id)

    pg.texto(team.name, M, y + 14, { tamanho: 16, negrito: true, largura: W })
    y += 20
    const detalhes = [
      team.group ? `Grupo ${team.group}` : '',
      team.coach ? `Responsável: ${team.coach}` : '',
      `${atletas.length} atleta(s) · ${comissao.length} na comissão técnica`,
    ].filter(Boolean)
    pg.texto(detalhes.join('   ·   '), M, y + 8, { tamanho: 9, cor: 0.4, largura: W })
    y += 18

    tabela(
      'Atletas',
      COLUNAS_ATLETA,
      atletas.map((p) => [
        p.number != null ? String(p.number) : '',
        p.name,
        dataBr(p.birthdate),
        p.cpf ? formatCpf(p.cpf) : '',
        labelDaPosicao(p.position),
      ]),
      'Nenhum atleta inscrito.',
    )
    y += 12
    tabela(
      'Comissão técnica',
      COLUNAS_COMISSAO,
      comissao.map((p) => [p.name, labelDaPosicao(p.position), dataBr(p.birthdate), p.cpf ? formatCpf(p.cpf) : '']),
      'Nenhum membro da comissão técnica inscrito.',
    )
  })

  if (lista.length === 0) {
    pg.texto('Nenhum time inscrito.', M, y + 12, { tamanho: 10, cor: 0.45 })
  }

  // Rodapé de todas as páginas: quem emitiu e "página x de y".
  paginas.forEach((p, i) => {
    p.linha(M, A4_ALTURA - 34, M + W, A4_ALTURA - 34, 0.6, 0.4)
    p.texto(`Emitido em ${emitido} · Tabelaço`, M, A4_ALTURA - 22, { tamanho: 8, cor: 0.4 })
    p.texto(`Página ${i + 1} de ${paginas.length}`, M + W, A4_ALTURA - 22, { tamanho: 8, cor: 0.4, alinhar: 'd' })
  })

  return gerarPdfPaginas(paginas, `Relação de elenco - ${championship.name}`)
}

/** "Elenco - Categoria - Time.pdf" (sem caracteres proibidos em nome de arquivo). */
export function nomeArquivoElenco(categoryName: string | undefined, teamName?: string): string {
  const base = ['Elenco', categoryName, teamName || 'Todos os times']
    .filter(Boolean)
    .join(' - ')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `${base}.pdf`
}
