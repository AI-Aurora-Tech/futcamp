// ---------------------------------------------------------------------------
// Súmula da partida em PDF.
//
// Usa o mesmo gerador mínimo do regulamento (`pdf.ts`), desenhando as tabelas
// à mão: retângulos, linhas e texto em Helvetica. A súmula é impressa e vai
// para o campo, então cada seção de lances (gols, substituições e cartões)
// sai com pelo menos LINHAS_EM_BRANCO linhas para o mesário preencher à mão.
// O que já foi lançado no sistema ocupa as primeiras linhas.
// ---------------------------------------------------------------------------
import { porNome } from './ordem'
import { anexar, bytesDe, empacotarPdf, escaparWinAnsi, type ImagemPdf } from './pdf'
import {
  PHASE_LABELS,
  labelDaPosicao,
  type Category,
  type Championship,
  type Match,
  type MatchEvent,
  type Player,
  type Team,
} from '../types'

/** Linhas mínimas de cada seção de lances. */
export const LINHAS_EM_BRANCO = 5

// A4 retrato, em pontos.
const LARGURA = 595.28
const ALTURA = 841.89
const MARGEM = 28
const UTIL = LARGURA - MARGEM * 2
const RODAPE = 16

const LINHA = 13 // altura da linha de tabela
const FONTE = 7.5 // texto das tabelas

type Cor = [number, number, number]
const PRETO: Cor = [0, 0, 0]
const CINZA: Cor = [0.45, 0.45, 0.45]
const FUNDO_CAB: Cor = [0.92, 0.92, 0.92]
const AMARELO: Cor = [0.98, 0.8, 0.08]
const VERMELHO: Cor = [0.86, 0.15, 0.15]

/** Largura aproximada do texto em Helvetica (média por caractere). */
function largura(texto: string, tamanho: number, negrito = false): number {
  return texto.length * tamanho * (negrito ? 0.56 : 0.52)
}

/** Corta o texto com "…" para caber na largura. */
function caber(texto: string, max: number, tamanho: number, negrito = false): string {
  if (largura(texto, tamanho, negrito) <= max) return texto
  let t = texto
  while (t.length > 1 && largura(`${t}…`, tamanho, negrito) > max) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}

// ---------------------------------------------------------------------------
// Tela: acumula os comandos de desenho, página a página, com o cursor `y`
// descendo do topo. Coordenadas do PDF crescem de baixo para cima.
// ---------------------------------------------------------------------------
class Tela {
  paginas: number[][] = [[]]
  y = ALTURA - MARGEM

  private get atual(): number[] {
    return this.paginas[this.paginas.length - 1]
  }

  private cmd(s: string) {
    anexar(this.atual, bytesDe(s))
  }

  novaPagina() {
    this.paginas.push([])
    this.y = ALTURA - MARGEM
  }

  /** Garante `altura` livre antes do rodapé; senão, vira a página. */
  reservar(altura: number) {
    if (this.y - altura < MARGEM + RODAPE) this.novaPagina()
  }

  texto(x: number, y: number, t: string, tamanho = FONTE, negrito = false, cor: Cor = PRETO) {
    this.cmd(`BT /${negrito ? 'F2' : 'F1'} ${tamanho} Tf ${cor.join(' ')} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (`)
    anexar(this.atual, escaparWinAnsi(t))
    this.cmd(') Tj ET\n')
  }

  textoCentro(xc: number, y: number, t: string, tamanho = FONTE, negrito = false, cor: Cor = PRETO) {
    this.texto(xc - largura(t, tamanho, negrito) / 2, y, t, tamanho, negrito, cor)
  }

  /** Retângulo com topo em `topo` (coordenada PDF). */
  ret(x: number, topo: number, w: number, h: number, preencher?: Cor, contorno = true) {
    const y = topo - h
    if (preencher) this.cmd(`${preencher.join(' ')} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f\n`)
    if (contorno) this.cmd(`0.5 w 0.35 0.35 0.35 RG ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S\n`)
  }

  /** Desenha uma imagem registrada no PDF; (x, y) é o canto inferior esquerdo. */
  imagem(nome: string, x: number, y: number, w: number, h: number) {
    this.cmd(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /${nome} Do Q\n`)
  }

  linha(x1: number, y1: number, x2: number, y2: number, espessura = 0.8) {
    this.cmd(`${espessura} w 0 0 0 RG ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S\n`)
  }
}

// ---------------------------------------------------------------------------
// Tabelas
// ---------------------------------------------------------------------------

/** Conteúdo de uma célula: texto simples ou desenho próprio. */
type Celula = string | ((t: Tela, x: number, topo: number, w: number) => void)

interface Coluna {
  titulo: string
  largura: number
  centro?: boolean
}

function faixa(t: Tela, x: number, w: number, titulo: string) {
  t.ret(x, t.y, w, 14, PRETO, false)
  t.texto(x + 5, t.y - 10, titulo, 9, true, [1, 1, 1])
  t.y -= 14
}

function cabecalho(t: Tela, x: number, colunas: Coluna[]) {
  let cx = x
  for (const c of colunas) {
    t.ret(cx, t.y, c.largura, LINHA, FUNDO_CAB)
    const txt = caber(c.titulo, c.largura - 6, FONTE, true)
    if (c.centro) t.textoCentro(cx + c.largura / 2, t.y - 9.3, txt, FONTE, true)
    else t.texto(cx + 3, t.y - 9.3, txt, FONTE, true)
    cx += c.largura
  }
  t.y -= LINHA
}

function linhaTabela(t: Tela, x: number, colunas: Coluna[], celulas: Celula[], fundo?: Cor) {
  let cx = x
  colunas.forEach((c, i) => {
    t.ret(cx, t.y, c.largura, LINHA, fundo)
    const cel = celulas[i]
    if (typeof cel === 'function') cel(t, cx, t.y, c.largura)
    else if (cel) {
      const txt = caber(cel, c.largura - 6, FONTE)
      if (c.centro) t.textoCentro(cx + c.largura / 2, t.y - 9.3, txt)
      else t.texto(cx + 3, t.y - 9.3, txt)
    }
    cx += c.largura
  })
  t.y -= LINHA
}

/**
 * Tabela de largura total com título; quebra de página repete a faixa e o
 * cabeçalho. `minLinhas` completa com linhas em branco.
 */
function tabela(
  t: Tela,
  titulo: string,
  colunas: Coluna[],
  linhas: Celula[][],
  minLinhas = 0,
  vazia: () => Celula[] = () => colunas.map(() => ''),
) {
  const todas = [...linhas]
  while (todas.length < minLinhas) todas.push(vazia())
  const w = colunas.reduce((s, c) => s + c.largura, 0)

  t.y -= 8
  // Título, cabeçalho e ao menos duas linhas juntos — nada de título órfão.
  t.reservar(14 + LINHA * 3)
  faixa(t, MARGEM, w, titulo)
  cabecalho(t, MARGEM, colunas)
  for (const l of todas) {
    if (t.y - LINHA < MARGEM + RODAPE) {
      t.novaPagina()
      faixa(t, MARGEM, w, `${titulo} (continuação)`)
      cabecalho(t, MARGEM, colunas)
    }
    linhaTabela(t, MARGEM, colunas, l)
  }
}

/** Colunas proporcionais a pesos, somando `total`. */
function colunas(total: number, defs: [string, number, boolean?][]): Coluna[] {
  const soma = defs.reduce((s, d) => s + d[1], 0)
  return defs.map(([titulo, peso, centro]) => ({ titulo, largura: (total * peso) / soma, centro }))
}

// ---------------------------------------------------------------------------
// Súmula
// ---------------------------------------------------------------------------

function fmtData(iso?: string): string {
  if (!iso) return '__/__/____  __:__'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const fmtCpf = (cpf?: string) => {
  const d = (cpf ?? '').replace(/\D/g, '')
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : d
}

const minuto = (e: MatchEvent) => (e.minute != null ? `${e.minute}'` : '')

/** Quadradinho de marcar, preenchido com a cor quando `marcado`. */
function marcador(t: Tela, x: number, topo: number, rotulo: string, cor: Cor, marcado: boolean) {
  const lado = 7
  t.ret(x, topo - 3, lado, lado, marcado ? cor : undefined)
  t.texto(x + lado + 2, topo - 9.3, rotulo, FONTE)
}

export interface SumulaParams {
  championship: Championship
  match: Match
  teams: Team[]
  players: Player[]
  events: MatchEvent[]
  category?: Category
  /** Logo do campeonato já em JPEG (ver `logoParaJpeg`). */
  logo?: Omit<ImagemPdf, 'nome'>
}

/** Monta o PDF da súmula e devolve os bytes. */
export function gerarSumulaPdf(params: SumulaParams): Uint8Array {
  const { championship, match, teams, players, events, category, logo } = params
  const home = teams.find((t) => t.id === match.homeTeamId)
  const away = teams.find((t) => t.id === match.awayTeamId)
  const doTime = (teamId?: string) =>
    teamId
      ? players.filter(
          (p) => p.teamId === teamId && (!category || (p.categoryId || category.id) === category.id),
        )
      : []
  const pNome = new Map(players.map((p) => [p.id, p.name] as const))
  const pNum = new Map(players.map((p) => [p.id, p.number] as const))
  const tNome = (id: string) => {
    const tm = teams.find((x) => x.id === id)
    return tm?.shortName || tm?.name || ''
  }
  const num = (id?: string) => (id && pNum.get(id) != null ? String(pNum.get(id)) : '')
  const nome = (id?: string) => (id ? pNome.get(id) ?? '' : '')
  const comNum = (id?: string) => [num(id), nome(id)].filter(Boolean).join(' ')

  const ev = events
    .filter((e) => e.matchId === match.id)
    .slice()
    .sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999))

  const t = new Tela()

  // --- Cabeçalho --------------------------------------------------------
  // Logo à esquerda, num quadrado de 40 pt, sem distorcer a proporção.
  let xTitulo = MARGEM
  if (logo) {
    const lado = 40
    const escala = Math.min(lado / logo.largura, lado / logo.altura)
    const w = logo.largura * escala
    const h = logo.altura * escala
    const x = MARGEM + (lado - w) / 2
    const y = t.y - 2 - lado + (lado - h) / 2
    t.imagem('Logo', x, y, w, h)
    xTitulo = MARGEM + lado + 8
  }
  t.texto(xTitulo, t.y - 14, caber(championship.name, UTIL * 0.55 - (xTitulo - MARGEM), 14, true), 14, true)
  t.texto(xTitulo, t.y - 27, `Súmula da partida${category ? ` — ${category.name}` : ''}`, 9, false, CINZA)

  const placar =
    match.homeScore != null && match.awayScore != null ? `${match.homeScore}  x  ${match.awayScore}` : '____  x  ____'
  const xc = MARGEM + UTIL * 0.78
  t.textoCentro(xc, t.y - 12, caber(`${home?.name ?? 'A definir'} x ${away?.name ?? 'A definir'}`, UTIL * 0.42, 10, true), 10, true)
  t.textoCentro(xc, t.y - 30, placar, 16, true)
  if (match.penaltyHome != null && match.penaltyAway != null) {
    t.textoCentro(xc, t.y - 40, `${match.penaltyHome} x ${match.penaltyAway} nos pênaltis`, 7.5, true, CINZA)
  }
  t.y -= 46
  t.linha(MARGEM, t.y, MARGEM + UTIL, t.y, 1.2)
  t.y -= 13

  const fase = match.phase === 'group' ? `Rodada ${match.round}` : PHASE_LABELS[match.phase]
  const arbitro = (championship.referees ?? []).find((r) => r.id === match.refereeId)?.name ?? ''
  const meta: [string, string][] = [
    ['Fase', fase],
    ['Data/hora', fmtData(match.scheduledAt)],
    ['Local', match.venue || '_________________'],
    ['Árbitro', arbitro || '_________________'],
  ]
  let mx = MARGEM
  const passo = UTIL / meta.length
  for (const [rot, val] of meta) {
    t.texto(mx, t.y, `${rot}:`, 8, true)
    t.texto(mx + largura(`${rot}: `, 8, true), t.y, caber(val, passo - largura(`${rot}: `, 8, true) - 6, 8), 8)
    mx += passo
  }
  t.y -= 6

  // --- Escalações, lado a lado -----------------------------------------
  const gap = 10
  const meia = (UTIL - gap) / 2
  const colsElenco = colunas(meia, [['Nº', 1.1, true], ['Nome', 5.6], ['CPF', 4.1], ['Posição', 2.9], ['Assinatura', 3.5]])
  const linhasElenco = (lista: Player[]): { celulas: Celula[]; secao?: boolean }[] => {
    const atletas = lista.filter((p) => (p.role ?? 'atleta') === 'atleta').sort(porNome)
    const comissao = lista.filter((p) => p.role === 'comissao').sort(porNome)
    const linha = (p: Player): Celula[] => [
      p.number != null ? String(p.number) : '',
      p.name,
      fmtCpf(p.cpf),
      labelDaPosicao(p.position) || '',
      '',
    ]
    const out: { celulas: Celula[]; secao?: boolean }[] = atletas.map((p) => ({ celulas: linha(p) }))
    if (comissao.length) {
      out.push({ celulas: ['', 'Comissão técnica', '', '', ''], secao: true })
      out.push(...comissao.map((p) => ({ celulas: linha(p) })))
    }
    if (!out.length) out.push({ celulas: ['', 'Sem atletas inscritos.', '', '', ''] })
    return out
  }
  const lados = [
    { x: MARGEM, titulo: home?.name ?? 'Mandante', linhas: linhasElenco(doTime(home?.id)) },
    { x: MARGEM + meia + gap, titulo: away?.name ?? 'Visitante', linhas: linhasElenco(doTime(away?.id)) },
  ]
  t.y -= 8
  t.reservar(14 + LINHA * 3)
  const topoElenco = t.y
  const cabecalhoElenco = (titulo: string, x: number, topo: number) => {
    t.y = topo
    faixa(t, x, meia, caber(titulo, meia - 10, 9, true))
    cabecalho(t, x, colsElenco)
  }
  // As duas colunas descem juntas, linha a linha, e viram a página juntas.
  cabecalhoElenco(lados[0].titulo, lados[0].x, topoElenco)
  cabecalhoElenco(lados[1].titulo, lados[1].x, topoElenco)
  const total = Math.max(lados[0].linhas.length, lados[1].linhas.length)
  for (let i = 0; i < total; i++) {
    if (t.y - LINHA < MARGEM + RODAPE) {
      t.novaPagina()
      const topo = t.y
      cabecalhoElenco(`${lados[0].titulo} (continuação)`, lados[0].x, topo)
      cabecalhoElenco(`${lados[1].titulo} (continuação)`, lados[1].x, topo)
    }
    const y = t.y
    for (const lado of lados) {
      t.y = y
      const l = lado.linhas[i]
      if (l) linhaTabela(t, lado.x, colsElenco, l.celulas, l.secao ? FUNDO_CAB : undefined)
    }
    t.y = y - LINHA
  }

  // --- Gols ----------------------------------------------------------------
  const gols = ev.filter((e) => e.type === 'goal' || e.type === 'own_goal')
  tabela(
    t,
    'GOLS',
    colunas(UTIL, [['Min', 1, true], ['Nº', 1, true], ['Atleta', 8], ['Time', 4], ['Contra?', 1.6, true]]),
    gols.map((e) => [minuto(e), num(e.playerId), nome(e.playerId), tNome(e.teamId), e.type === 'own_goal' ? 'Sim' : '']),
    LINHAS_EM_BRANCO,
  )

  // --- Substituições -------------------------------------------------------
  const subs = ev.filter((e) => e.type === 'substitution')
  tabela(
    t,
    'SUBSTITUIÇÕES',
    colunas(UTIL, [['Min', 1, true], ['Time', 3.5], ['Saiu (nº e nome)', 6.5], ['Entrou (nº e nome)', 6.5]]),
    subs.map((e) => [minuto(e), tNome(e.teamId), comNum(e.playerId), comNum(e.playerInId)]),
    LINHAS_EM_BRANCO,
  )

  // --- Cartões -------------------------------------------------------------
  const cartoes = ev.filter((e) => e.type === 'yellow_card' || e.type === 'red_card')
  const tipoCartao =
    (amarelo: boolean, vermelho: boolean): Celula =>
    (tt, x, topo, w) => {
      const meio = x + w / 2
      marcador(tt, meio - 38, topo, 'Amarelo', AMARELO, amarelo)
      marcador(tt, meio + 6, topo, 'Vermelho', VERMELHO, vermelho)
    }
  tabela(
    t,
    'CARTÕES (AMARELO / VERMELHO)',
    colunas(UTIL, [['Min', 1, true], ['Nº', 1, true], ['Atleta', 6.5], ['Time', 3.3], ['Cartão', 4.3, true], ['Motivo', 4]]),
    cartoes.map((e) => [
      minuto(e),
      num(e.playerId),
      nome(e.playerId),
      tNome(e.teamId),
      tipoCartao(e.type === 'yellow_card', e.type === 'red_card'),
      e.detail ?? '',
    ]),
    LINHAS_EM_BRANCO,
    // Linha em branco também leva os quadradinhos, para marcar à caneta.
    () => ['', '', '', '', tipoCartao(false, false), ''],
  )

  // --- Relato de incidentes -----------------------------------------------
  t.y -= 8
  const alturaRelato = 58
  t.reservar(14 + alturaRelato)
  faixa(t, MARGEM, UTIL, 'RELATO DE INCIDENTES')
  t.ret(MARGEM, t.y, UTIL, alturaRelato)
  const relato = (match.incidents ?? '').split(/\n/).flatMap((p) => quebrarLinhas(p, UTIL - 10, 8))
  relato.slice(0, 5).forEach((l, i) => t.texto(MARGEM + 5, t.y - 11 - i * 10.5, l, 8))
  t.y -= alturaRelato

  // --- Assinaturas ------------------------------------------------------------
  t.reservar(44)
  t.y -= 34
  const assin = ['Árbitro', 'Capitão / responsável — mandante', 'Capitão / responsável — visitante']
  const wAss = (UTIL - 2 * 20) / 3
  assin.forEach((rot, i) => {
    const x = MARGEM + i * (wAss + 20)
    t.linha(x, t.y, x + wAss, t.y, 0.8)
    t.textoCentro(x + wAss / 2, t.y - 10, rot, 7.5)
    if (i === 0 && arbitro) t.textoCentro(x + wAss / 2, t.y - 19, arbitro, 7, false, CINZA)
  })

  // Rodapé com a paginação.
  const n = t.paginas.length
  const titulo = `Súmula — ${home?.name ?? 'Mandante'} x ${away?.name ?? 'Visitante'}`
  t.paginas.forEach((partes, i) => {
    anexar(partes, bytesDe(`BT /F1 7 Tf ${CINZA.join(' ')} rg 1 0 0 1 ${MARGEM} ${MARGEM - 4} Tm (`))
    anexar(partes, escaparWinAnsi(`${championship.name} · ${titulo} · Página ${i + 1} de ${n}`))
    anexar(partes, bytesDe(') Tj ET\n'))
  })

  return empacotarPdf(t.paginas, titulo, LARGURA, ALTURA, logo ? [{ nome: 'Logo', ...logo }] : [])
}

function quebrarLinhas(texto: string, max: number, tamanho: number): string[] {
  const palavras = texto.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let atual = ''
  for (const p of palavras) {
    const tent = atual ? `${atual} ${p}` : p
    if (largura(tent, tamanho) <= max || !atual) atual = tent
    else {
      out.push(atual)
      atual = p
    }
  }
  if (atual) out.push(atual)
  return out
}

/** Nome do arquivo: sumula-MAN-x-VIS.pdf */
export function nomeArquivoSumula(home?: Team, away?: Team): string {
  const slug = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
  return `sumula-${slug(home?.shortName || home?.name || 'mandante')}-x-${slug(away?.shortName || away?.name || 'visitante')}.pdf`
}
