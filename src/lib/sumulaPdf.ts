// ---------------------------------------------------------------------------
// Súmula da partida em PDF.
//
// O botão "Baixar súmula" entregava um .html — que abre no navegador, mas não
// é o documento que o árbitro imprime, assina e arquiva. Aqui a súmula sai
// como PDF A4, com tabelas de verdade: elencos com campo de assinatura, gols,
// substituições, cartões, incidentes e as assinaturas no fim.
//
// jsPDF e a extensão de tabelas só são carregados no clique (import dinâmico):
// pesam mais do que o resto do app e só servem para este botão.
// ---------------------------------------------------------------------------
import { PHASE_LABELS, labelDaPosicao, type Category, type Championship, type Match, type MatchEvent, type Player, type Team } from '../types'
import { atletaDaCategoria, categoriaPadrao } from './categorias'

export interface DadosSumula {
  championship: Championship
  match: Match
  teams: Team[]
  players: Player[]
  events: MatchEvent[]
  category?: Category
}

// Cores (RGB) — preto e cinzas, para imprimir bem em qualquer impressora.
const PRETO: [number, number, number] = [17, 17, 17]
const CINZA_ESCURO: [number, number, number] = [70, 70, 70]
const CINZA: [number, number, number] = [120, 120, 120]
const CINZA_CLARO: [number, number, number] = [235, 235, 235]
const LINHA: [number, number, number] = [150, 150, 150]

const MARGEM = 12 // mm
const RODAPE = 12 // mm reservados no pé da página

/**
 * Helvetica (a fonte embutida no PDF) só cobre o alfabeto latino. Emoji e
 * símbolos fora dele viram lixo no arquivo, então saem antes.
 */
function limpo(texto: unknown): string {
  return String(texto ?? '')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function maiuscula(t: string): string {
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t
}

function cpfFormatado(cpf?: string): string {
  const d = (cpf ?? '').replace(/\D/g, '')
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : d
}

function dataHora(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return limpo(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function porNumeroENome(a: Player, b: Player): number {
  return (a.number ?? 999) - (b.number ?? 999) || a.name.localeCompare(b.name, 'pt-BR')
}

/** Nome do arquivo: "sumula-leoes-x-tigres-sub-17.pdf". */
export function nomeDoArquivoSumula(d: DadosSumula): string {
  const home = d.teams.find((t) => t.id === d.match.homeTeamId)
  const away = d.teams.find((t) => t.id === d.match.awayTeamId)
  const partes = [
    'sumula',
    home?.shortName || home?.name || 'mandante',
    'x',
    away?.shortName || away?.name || 'visitante',
    d.category?.name ?? '',
  ]
  const slug = partes
    .filter(Boolean)
    .join('-')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'sumula'}.pdf`
}

/** Gera o PDF da súmula e devolve os bytes (separado do download para testar). */
export async function gerarSumulaPdf(d: DadosSumula): Promise<ArrayBuffer> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])

  const { championship, match, teams, players, events } = d
  const category = d.category
  const padrao = categoriaPadrao(championship)
  const home = teams.find((t) => t.id === match.homeTeamId)
  const away = teams.find((t) => t.id === match.awayTeamId)
  const doTime = (teamId?: string) =>
    teamId
      ? players.filter((p) => p.teamId === teamId && atletaDaCategoria(p.categoryId, category?.id, padrao))
      : []

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const largura = doc.internal.pageSize.getWidth()
  const altura = doc.internal.pageSize.getHeight()
  const util = largura - MARGEM * 2
  const fimY = () => (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? MARGEM

  /** Garante espaço na página; se não houver, abre outra. */
  const espaco = (y: number, precisa: number): number => {
    if (y + precisa <= altura - RODAPE - 4) return y
    doc.addPage()
    return MARGEM
  }

  /** Faixa preta com o título da seção. */
  const secao = (titulo: string, y: number): number => {
    y = espaco(y, 18)
    doc.setFillColor(...PRETO)
    doc.rect(MARGEM, y, util, 6.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(255, 255, 255)
    doc.text(limpo(titulo).toUpperCase(), MARGEM + 2.5, y + 4.5)
    doc.setTextColor(...PRETO)
    return y + 6.5
  }

  const estiloTabela = {
    theme: 'grid' as const,
    // Uma linha nunca é partida entre duas páginas.
    rowPageBreak: 'avoid' as const,
    margin: { left: MARGEM, right: MARGEM, bottom: RODAPE + 4 },
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 1.6,
      lineColor: LINHA,
      lineWidth: 0.15,
      textColor: PRETO,
      valign: 'middle' as const,
    },
    headStyles: { fillColor: CINZA_CLARO, textColor: PRETO, fontStyle: 'bold' as const },
  }

  // -------------------------------------------------------------------------
  // Cabeçalho: logo + campeonato à esquerda, "SÚMULA" à direita.
  // -------------------------------------------------------------------------
  let y = MARGEM
  let xTitulo = MARGEM
  const logo = championship.logo ?? ''
  const formatoLogo = /^data:image\/png/i.test(logo) ? 'PNG' : /^data:image\/jpe?g/i.test(logo) ? 'JPEG' : null
  if (formatoLogo) {
    try {
      doc.addImage(logo, formatoLogo, MARGEM, y, 16, 16)
      xTitulo = MARGEM + 19
    } catch {
      /* logo ilegível: segue sem ela */
    }
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  const nomeCamp = doc.splitTextToSize(limpo(`${championship.name} ${championship.season ?? ''}`), util - (xTitulo - MARGEM) - 45)
  doc.text(nomeCamp.slice(0, 2), xTitulo, y + 6)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(...CINZA_ESCURO)
  doc.text(limpo(`Súmula da partida${category ? ` - ${category.name}` : ''}`), xTitulo, y + 6 + nomeCamp.slice(0, 2).length * 5.5)
  doc.setTextColor(...PRETO)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('SÚMULA', largura - MARGEM, y + 7, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...CINZA)
  doc.text('Documento oficial da partida', largura - MARGEM, y + 11.5, { align: 'right' })
  doc.setTextColor(...PRETO)

  y += 20
  doc.setDrawColor(...PRETO)
  doc.setLineWidth(0.6)
  doc.line(MARGEM, y, largura - MARGEM, y)
  y += 5

  // -------------------------------------------------------------------------
  // Placar.
  // -------------------------------------------------------------------------
  const temPlacar = match.homeScore != null && match.awayScore != null
  const placar = temPlacar ? `${match.homeScore}  x  ${match.awayScore}` : '____  x  ____'
  const penaltis =
    match.penaltyHome != null && match.penaltyAway != null
      ? `Pênaltis: ${match.penaltyHome} x ${match.penaltyAway}`
      : ''
  const alturaPlacar = penaltis ? 24 : 20
  doc.setDrawColor(...LINHA)
  doc.setLineWidth(0.3)
  doc.setFillColor(248, 248, 248)
  doc.roundedRect(MARGEM, y, util, alturaPlacar, 2, 2, 'FD')
  const colTime = (util - 40) / 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  const nomeHome = doc.splitTextToSize(limpo(home?.name ?? 'Mandante'), colTime - 6).slice(0, 2)
  const nomeAway = doc.splitTextToSize(limpo(away?.name ?? 'Visitante'), colTime - 6).slice(0, 2)
  const meio = y + alturaPlacar / 2 - (penaltis ? 2 : 0)
  doc.text(nomeHome, MARGEM + colTime / 2, meio - (nomeHome.length - 1) * 2.5 + 1.5, { align: 'center' })
  doc.text(nomeAway, largura - MARGEM - colTime / 2, meio - (nomeAway.length - 1) * 2.5 + 1.5, { align: 'center' })
  doc.setFontSize(20)
  doc.text(placar, largura / 2, meio + 2.5, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...CINZA)
  doc.text('MANDANTE', MARGEM + colTime / 2, y + 4.5, { align: 'center' })
  doc.text('VISITANTE', largura - MARGEM - colTime / 2, y + 4.5, { align: 'center' })
  doc.setTextColor(...PRETO)
  if (penaltis) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text(penaltis, largura / 2, y + alturaPlacar - 3.5, { align: 'center' })
  }
  y += alturaPlacar + 4

  // -------------------------------------------------------------------------
  // Dados da partida.
  // -------------------------------------------------------------------------
  const fase = match.phase === 'group' ? `Rodada ${match.round}` : PHASE_LABELS[match.phase] ?? ''
  const arbitro = (championship.referees ?? []).find((r) => r.id === match.refereeId)?.name ?? ''
  const situacao = match.status === 'finished' ? 'Encerrada' : match.status === 'live' ? 'Ao vivo' : 'Agendada'
  autoTable(doc, {
    ...estiloTabela,
    startY: y,
    body: [
      [
        { content: 'Fase', styles: { fontStyle: 'bold', fillColor: CINZA_CLARO } },
        limpo(fase),
        { content: 'Data/hora', styles: { fontStyle: 'bold', fillColor: CINZA_CLARO } },
        dataHora(match.scheduledAt),
      ],
      [
        { content: 'Local', styles: { fontStyle: 'bold', fillColor: CINZA_CLARO } },
        limpo(match.venue),
        { content: 'Árbitro', styles: { fontStyle: 'bold', fillColor: CINZA_CLARO } },
        limpo(arbitro),
      ],
      [
        { content: 'Categoria', styles: { fontStyle: 'bold', fillColor: CINZA_CLARO } },
        limpo(category?.name ?? ''),
        { content: 'Situação', styles: { fontStyle: 'bold', fillColor: CINZA_CLARO } },
        situacao,
      ],
    ],
    columnStyles: { 0: { cellWidth: 22 }, 2: { cellWidth: 22 } },
    styles: { ...estiloTabela.styles, fontSize: 9, minCellHeight: 7 },
  })
  y = fimY() + 6

  // -------------------------------------------------------------------------
  // Elencos, um time por vez, com campo de assinatura.
  // -------------------------------------------------------------------------
  const elenco = (time: Team | undefined, rotulo: string) => {
    const lista = doTime(time?.id)
    const atletas = lista.filter((p) => (p.role ?? 'atleta') === 'atleta').sort(porNumeroENome)
    const comissao = lista.filter((p) => p.role === 'comissao').sort(porNumeroENome)
    y = espaco(y, 30)

    const linha = (p: Player) => [
      p.number != null ? String(p.number) : '',
      limpo(p.name),
      cpfFormatado(p.cpf),
      maiuscula(limpo(labelDaPosicao(p.position))),
      '',
    ]
    const corpo: unknown[][] = atletas.map(linha)
    if (!atletas.length) {
      corpo.push([{ content: 'Sem atletas inscritos.', colSpan: 5, styles: { halign: 'center', textColor: CINZA, fontStyle: 'italic' } }])
    }
    if (comissao.length) {
      corpo.push([{ content: 'Comissão técnica', colSpan: 5, styles: { fontStyle: 'bold', fillColor: CINZA_CLARO } }])
      corpo.push(...comissao.map(linha))
    }

    autoTable(doc, {
      ...estiloTabela,
      startY: y,
      // A faixa com o nome do time faz parte do cabeçalho: repete em cada
      // página quando o elenco continua na seguinte.
      head: [
        [
          {
            content: limpo(`${rotulo}: ${time?.name ?? 'A definir'}`).toUpperCase(),
            colSpan: 5,
            styles: { fillColor: PRETO, textColor: [255, 255, 255], fontSize: 9.5, cellPadding: { top: 1.8, bottom: 1.8, left: 2.5, right: 2 } },
          },
        ],
        ['Nº', 'Nome', 'CPF', 'Posição', 'Assinatura'],
      ] as never,
      body: corpo as never,
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        2: { cellWidth: 30 },
        3: { cellWidth: 26 },
        4: { cellWidth: 46 },
      },
      bodyStyles: { minCellHeight: 7 },
    })
    y = fimY() + 6
  }
  elenco(home, 'Mandante')
  elenco(away, 'Visitante')

  // -------------------------------------------------------------------------
  // Lances.
  // -------------------------------------------------------------------------
  const daPartida = events.filter((e) => e.matchId === match.id)
  const nomeAtleta = (id?: string) => {
    const p = players.find((x) => x.id === id)
    if (!p) return ''
    return limpo(p.number != null ? `${p.number} - ${p.name}` : p.name)
  }
  const nomeTime = (id: string) => {
    const t = teams.find((x) => x.id === id)
    return limpo(t?.shortName || t?.name || '')
  }
  const minuto = (e: MatchEvent) => (e.minute != null ? `${e.minute}'` : '')
  const ordenar = (lista: MatchEvent[]) => lista.slice().sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999))
  const vazio = (colunas: number) => [
    [{ content: 'Nenhum registro.', colSpan: colunas, styles: { halign: 'center', textColor: CINZA, fontStyle: 'italic' } }],
  ]

  // Antes do fim do jogo a súmula vai para o árbitro preencher à mão: as
  // tabelas sem lançamento saem com linhas em branco para escrever.
  const encerrada = match.status === 'finished'
  const tabelaLances = (
    titulo: string,
    head: string[],
    linhas: unknown[][],
    larguras: Record<number, number>,
    emBranco = 4,
  ) => {
    y = secao(titulo, y)
    const corpo = linhas.length
      ? linhas
      : encerrada
        ? vazio(head.length)
        : Array.from({ length: emBranco }, () => head.map(() => ''))
    autoTable(doc, {
      ...estiloTabela,
      startY: y,
      head: [head],
      body: corpo as never,
      bodyStyles: { minCellHeight: 7 },
      columnStyles: Object.fromEntries(
        Object.entries(larguras).map(([k, w]) => [k, { cellWidth: w, ...(k === '0' ? { halign: 'center' } : {}) }]),
      ),
    })
    y = fimY() + 6
  }

  const gols = ordenar(daPartida.filter((e) => e.type === 'goal' || e.type === 'own_goal'))
  tabelaLances(
    'Gols',
    ['Min', 'Autor', 'Time'],
    gols.map((e) => [minuto(e), `${nomeAtleta(e.playerId) || '(não informado)'}${e.type === 'own_goal' ? ' (gol contra)' : ''}`, nomeTime(e.teamId)]),
    { 0: 14, 2: 50 },
    6,
  )

  const subs = ordenar(daPartida.filter((e) => e.type === 'substitution'))
  tabelaLances(
    'Substituições',
    ['Min', 'Saiu', 'Entrou', 'Time'],
    subs.map((e) => [minuto(e), nomeAtleta(e.playerId) || '-', nomeAtleta(e.playerInId) || '-', nomeTime(e.teamId)]),
    { 0: 14, 3: 50 },
    6,
  )

  const amarelos = ordenar(daPartida.filter((e) => e.type === 'yellow_card'))
  tabelaLances(
    'Cartões amarelos',
    ['Min', 'Atleta', 'Time'],
    amarelos.map((e) => [minuto(e), nomeAtleta(e.playerId) || '(não informado)', nomeTime(e.teamId)]),
    { 0: 14, 2: 50 },
  )

  const vermelhos = ordenar(daPartida.filter((e) => e.type === 'red_card'))
  tabelaLances(
    'Cartões vermelhos / expulsões',
    ['Min', 'Atleta', 'Motivo', 'Time'],
    vermelhos.map((e) => [minuto(e), nomeAtleta(e.playerId) || '(não informado)', limpo(e.detail) || '-', nomeTime(e.teamId)]),
    { 0: 14, 3: 50 },
  )

  // -------------------------------------------------------------------------
  // Relato de incidentes.
  // -------------------------------------------------------------------------
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  const relato = (match.incidents ?? '')
    .split('\n')
    .map(limpo)
    .join('\n')
    .trim()
  const linhasRelato: string[] = relato ? doc.splitTextToSize(relato, util - 6) : []
  const alturaRelato = Math.max(match.status === 'finished' ? 22 : 34, linhasRelato.length * 4.2 + 6)
  // Relato e assinaturas andam juntos: as assinaturas nunca ficam sozinhas
  // numa página. Relato muito longo quebra de página do jeito dele.
  const ASSINATURAS = 28 // espaço antes + linha + nomes
  if (alturaRelato <= 60) y = espaco(y, 6.5 + alturaRelato + 6 + ASSINATURAS)
  y = secao('Relato de incidentes', y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  y = espaco(y, Math.min(alturaRelato, 60))
  doc.setDrawColor(...LINHA)
  doc.setLineWidth(0.15)
  if (linhasRelato.length) {
    // Relato longo: quebra de página no meio do texto, sem cortar linhas.
    let i = 0
    while (i < linhasRelato.length) {
      const cabem = Math.max(1, Math.floor((altura - RODAPE - 4 - y - 6) / 4.2))
      const bloco = linhasRelato.slice(i, i + cabem)
      const h = bloco.length * 4.2 + 6
      doc.rect(MARGEM, y, util, h)
      doc.text(bloco, MARGEM + 3, y + 5)
      i += bloco.length
      y += h
      if (i < linhasRelato.length) {
        doc.addPage()
        y = MARGEM
      }
    }
  } else {
    doc.rect(MARGEM, y, util, alturaRelato)
    // Jogo encerrado sem relato: diz isso. Antes do jogo: caixa em branco.
    if (match.status === 'finished') {
      doc.setTextColor(...CINZA)
      doc.text('Sem incidentes registrados.', MARGEM + 3, y + 5)
      doc.setTextColor(...PRETO)
    }
    y += alturaRelato
  }
  y += 6

  // -------------------------------------------------------------------------
  // Assinaturas.
  // -------------------------------------------------------------------------
  // 12 mm em branco para a assinatura + linha + nome embaixo.
  y = espaco(y, 22)
  y += 12
  const colAss = (util - 16) / 3
  const assinaturas: [string, string][] = [
    ['Árbitro', limpo(arbitro)],
    ['Responsável - mandante', limpo(home?.name ?? '')],
    ['Responsável - visitante', limpo(away?.name ?? '')],
  ]
  doc.setDrawColor(...PRETO)
  doc.setLineWidth(0.3)
  assinaturas.forEach(([rotulo, nome], i) => {
    const x = MARGEM + i * (colAss + 8)
    doc.line(x, y, x + colAss, y)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text(rotulo, x + colAss / 2, y + 4, { align: 'center' })
    if (nome) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...CINZA_ESCURO)
      doc.text(doc.splitTextToSize(nome, colAss)[0], x + colAss / 2, y + 8, { align: 'center' })
      doc.setTextColor(...PRETO)
    }
  })

  // -------------------------------------------------------------------------
  // Rodapé em todas as páginas.
  // -------------------------------------------------------------------------
  const total = doc.getNumberOfPages()
  const geradoEm = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const jogo = limpo(`${home?.name ?? 'Mandante'} x ${away?.name ?? 'Visitante'}`)
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    doc.setDrawColor(...LINHA)
    doc.setLineWidth(0.2)
    doc.line(MARGEM, altura - RODAPE, largura - MARGEM, altura - RODAPE)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...CINZA)
    doc.text(doc.splitTextToSize(`Súmula - ${jogo} · gerada em ${geradoEm}`, util - 30)[0], MARGEM, altura - RODAPE + 4.5)
    doc.text(`Página ${p} de ${total}`, largura - MARGEM, altura - RODAPE + 4.5, { align: 'right' })
  }
  doc.setTextColor(...PRETO)

  doc.setProperties({ title: limpo(`Súmula - ${jogo}`), creator: 'Tabelaço' })
  return doc.output('arraybuffer')
}

/** Gera a súmula em PDF e dispara o download. */
export async function baixarSumulaPdf(d: DadosSumula): Promise<void> {
  const bytes = await gerarSumulaPdf(d)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nomeDoArquivoSumula(d)
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Espera o navegador começar o download antes de soltar o objeto.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
