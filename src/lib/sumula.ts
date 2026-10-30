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
import { A4_ALTURA, A4_LARGURA, Pagina, gerarPdfPaginas, larguraDe } from './pdfDesenho'

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

function fmtDate(iso?: string): string {
  if (!iso) return '____/____/______'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return esc(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function rosterRows(players: Player[]): string {
  const athletes = players.filter((p) => (p.role ?? 'atleta') === 'atleta').sort((a, b) => (a.number ?? 99) - (b.number ?? 99))
  const staff = players.filter((p) => p.role === 'comissao')
  const posLabel = (p: Player) => labelDaPosicao(p.position)
  const line = (p: Player) =>
    `<tr><td class="num">${esc(p.number ?? '')}</td><td>${esc(p.name)}</td><td>${esc(p.cpf ? p.cpf.replace(/\D/g, '').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : '')}</td><td>${esc(posLabel(p))}</td><td class="sign"></td></tr>`
  let html = athletes.map(line).join('')
  if (staff.length) {
    html += `<tr class="sec"><td colspan="5">Comissão técnica</td></tr>` + staff.map(line).join('')
  }
  return html || `<tr><td colspan="5" class="empty">Sem atletas inscritos.</td></tr>`
}

interface Lookups {
  pName: Map<string, string>
  pNum: Map<string, number | undefined>
  tName: Map<string, string>
}

function withNum(id: string | undefined, l: Lookups): string {
  if (!id) return ''
  const num = l.pNum.get(id)
  const name = l.pName.get(id) ?? ''
  return num != null ? `#${num} ${name}` : name
}

const min = (e: MatchEvent) => (e.minute != null ? `${e.minute}'` : '')

function sectionRows(
  events: MatchEvent[],
  cols: number,
  render: (e: MatchEvent) => string,
): string {
  if (!events.length) return `<tr><td colspan="${cols}" class="empty">—</td></tr>`
  return events
    .slice()
    .sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999))
    .map(render)
    .join('')
}

/** Monta o documento HTML completo da súmula de uma partida. */
export function buildSumulaHtml(params: {
  championship: Championship
  match: Match
  teams: Team[]
  players: Player[]
  events: MatchEvent[]
  category?: Category
}): string {
  const { championship, match, teams, players, events, category } = params
  const home = teams.find((t) => t.id === match.homeTeamId)
  const away = teams.find((t) => t.id === match.awayTeamId)
  const inCat = (teamId: string) =>
    players.filter((p) => p.teamId === teamId && (!category || p.categoryId === category.id))
  const homePlayers = home ? inCat(home.id) : []
  const awayPlayers = away ? inCat(away.id) : []
  const ev = events.filter((e) => e.matchId === match.id)
  const l: Lookups = {
    pName: new Map(players.map((p) => [p.id, p.name] as const)),
    pNum: new Map(players.map((p) => [p.id, p.number] as const)),
    tName: new Map(teams.map((t) => [t.id, t.shortName || t.name] as const)),
  }
  const goals = ev.filter((e) => e.type === 'goal' || e.type === 'own_goal')
  const subs = ev.filter((e) => e.type === 'substitution')
  const yellows = ev.filter((e) => e.type === 'yellow_card')
  const reds = ev.filter((e) => e.type === 'red_card')

  const goalsHtml = sectionRows(goals, 3, (e) =>
    `<tr><td class="num">${esc(min(e))}</td><td>${withNum(e.playerId, l) ? esc(withNum(e.playerId, l)) : '<span class="muted">(não informado)</span>'}${e.type === 'own_goal' ? ' <b>(contra)</b>' : ''}</td><td>${esc(l.tName.get(e.teamId) ?? '')}</td></tr>`)
  const subsHtml = sectionRows(subs, 3, (e) =>
    `<tr><td class="num">${esc(min(e))}</td><td><span class="out">▼ ${esc(withNum(e.playerId, l) || '—')}</span><br><span class="in">▲ ${esc(withNum(e.playerInId, l) || '—')}</span></td><td>${esc(l.tName.get(e.teamId) ?? '')}</td></tr>`)
  const yellowsHtml = sectionRows(yellows, 3, (e) =>
    `<tr><td class="num">${esc(min(e))}</td><td>${esc(withNum(e.playerId, l) || '(não informado)')}</td><td>${esc(l.tName.get(e.teamId) ?? '')}</td></tr>`)
  const redsHtml = sectionRows(reds, 4, (e) =>
    `<tr><td class="num">${esc(min(e))}</td><td>${esc(l.pName.get(e.playerId ?? '') || '(não informado)')}</td><td>${esc(e.detail || '—')}</td><td>${esc(l.tName.get(e.teamId) ?? '')}</td></tr>`)

  const score =
    match.homeScore != null && match.awayScore != null ? `${match.homeScore} x ${match.awayScore}` : '____ x ____'
  const penalties =
    match.penaltyHome != null && match.penaltyAway != null
      ? `${match.penaltyHome} x ${match.penaltyAway} nos pênaltis`
      : ''
  const phaseOrRound = match.phase === 'group' ? `Rodada ${match.round}` : PHASE_LABELS[match.phase]
  const refereeName = (championship.referees ?? []).find((r) => r.id === match.refereeId)?.name ?? ''

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Súmula — ${esc(home?.name ?? '')} x ${esc(away?.name ?? '')}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 24px; font-size: 12px; }
  h1 { font-size: 18px; margin: 0; }
  .muted { color: #555; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 12px; }
  .score { text-align: center; }
  .score .teams { font-size: 16px; font-weight: bold; }
  .score .num { font-size: 26px; font-weight: bold; }
  .score .pens { font-size: 11px; font-weight: bold; color: #555; }
  .meta { margin: 8px 0 16px; display: flex; gap: 24px; flex-wrap: wrap; }
  .meta div { font-size: 12px; }
  .cols { display: flex; gap: 16px; }
  .col { flex: 1; }
  h2 { font-size: 13px; background: #111; color: #fff; padding: 4px 8px; margin: 0 0 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th, td { border: 1px solid #999; padding: 3px 6px; text-align: left; }
  th { background: #eee; }
  td.num { width: 34px; text-align: center; }
  td.sign { width: 90px; }
  tr.sec td { background: #ddd; font-weight: bold; }
  td.empty { text-align: center; color: #777; font-style: italic; }
  .out { color: #b91c1c; font-weight: bold; }
  .in { color: #166534; font-weight: bold; }
  .incidents { border: 1px solid #999; min-height: 56px; padding: 8px; white-space: pre-wrap; }
  .signs { display: flex; gap: 24px; margin-top: 28px; }
  .signs div { flex: 1; border-top: 1px solid #111; padding-top: 4px; text-align: center; }
  @media print { body { margin: 10mm; } .noprint { display: none; } }
  .noprint { margin-bottom: 12px; }
  .btn { padding: 8px 14px; border: none; border-radius: 6px; background: #16a34a; color: #fff; font-weight: bold; cursor: pointer; }
</style></head><body>
<div class="noprint"><button class="btn" onclick="window.print()">🖨️ Imprimir / Salvar em PDF</button></div>
<div class="head">
  <div>
    <h1>${championship.logo && /^(data:|https?:)/.test(championship.logo) ? `<img src="${esc(championship.logo)}" style="height:28px;vertical-align:middle;border-radius:4px;margin-right:6px">` : esc(championship.logo ?? '')} ${esc(championship.name)}</h1>
    <div class="muted">Súmula da partida${category ? ' — ' + esc(category.name) : ''}</div>
  </div>
  <div class="score">
    <div class="teams">${esc(home?.name ?? 'A definir')} x ${esc(away?.name ?? 'A definir')}</div>
    <div class="num">${esc(score)}</div>
    ${penalties ? `<div class="pens">${esc(penalties)}</div>` : ''}
  </div>
</div>
<div class="meta">
  <div><b>Fase:</b> ${esc(phaseOrRound)}</div>
  <div><b>Data/hora:</b> ${fmtDate(match.scheduledAt)}</div>
  <div><b>Local:</b> ${esc(match.venue ?? '__________________')}</div>
  <div><b>Árbitro:</b> ${esc(refereeName || '__________________')}</div>
  <div><b>Situação:</b> ${match.status === 'finished' ? 'Encerrada' : match.status === 'live' ? 'Ao vivo' : 'Agendada'}</div>
</div>
<div class="cols">
  <div class="col">
    <h2>${esc(home?.name ?? 'Mandante')}</h2>
    <table><thead><tr><th>#</th><th>Nome</th><th>CPF</th><th>Posição</th><th>Assin.</th></tr></thead>
    <tbody>${rosterRows(homePlayers)}</tbody></table>
  </div>
  <div class="col">
    <h2>${esc(away?.name ?? 'Visitante')}</h2>
    <table><thead><tr><th>#</th><th>Nome</th><th>CPF</th><th>Posição</th><th>Assin.</th></tr></thead>
    <tbody>${rosterRows(awayPlayers)}</tbody></table>
  </div>
</div>
<h2>⚽ Gols marcados</h2>
<table><thead><tr><th>Min</th><th>Autor (nº e nome)</th><th>Time</th></tr></thead>
<tbody>${goalsHtml}</tbody></table>

<h2>🔁 Substituições</h2>
<table><thead><tr><th>Min</th><th>Saiu / Entrou</th><th>Time</th></tr></thead>
<tbody>${subsHtml}</tbody></table>

<div class="cols">
  <div class="col">
    <h2>🟨 Cartões amarelos</h2>
    <table><thead><tr><th>Min</th><th>Atleta (nº e nome)</th><th>Time</th></tr></thead>
    <tbody>${yellowsHtml}</tbody></table>
  </div>
  <div class="col">
    <h2>🟥 Cartões vermelhos / expulsões</h2>
    <table><thead><tr><th>Min</th><th>Infrator</th><th>Motivo</th><th>Time</th></tr></thead>
    <tbody>${redsHtml}</tbody></table>
  </div>
</div>

<h2>📝 Relato de incidentes</h2>
<div class="incidents">${match.incidents ? esc(match.incidents).replace(/\n/g, '<br>') : '<span class="muted">Sem incidentes registrados (atrasos, segurança, conduta de torcidas).</span>'}</div>

<div class="signs">
  <div>Árbitro${refereeName ? `<br><span class="muted">${esc(refereeName)}</span>` : ''}</div><div>Mandante</div><div>Visitante</div>
</div>
</body></html>`
}

/** Abre a súmula numa nova janela pronta para impressão/PDF. */
export function openSumula(html: string): void {
  const w = window.open('', '_blank')
  if (!w) return
  w.document.open()
  w.document.write(html)
  w.document.close()
}

/** Nome do arquivo: "Categoria - Mandante x Visitante.pdf" (sem caracteres proibidos). */
export function nomeArquivoSumula(categoryName: string | undefined, home?: string, away?: string): string {
  const base = [categoryName, `${home || 'Mandante'} x ${away || 'Visitante'}`]
    .filter(Boolean)
    .join(' - ')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `${base}.pdf`
}

/** Monta a súmula em PDF, com layout de formulário (tabelas, caixas e assinaturas). */
export function buildSumulaPdf(params: {
  championship: Championship
  match: Match
  teams: Team[]
  players: Player[]
  events: MatchEvent[]
  category?: Category
}): Uint8Array {
  const { championship, match, teams, players, events, category } = params
  const home = teams.find((t) => t.id === match.homeTeamId)
  const away = teams.find((t) => t.id === match.awayTeamId)
  const ev = events.filter((e) => e.matchId === match.id)
  const pById = new Map(players.map((p) => [p.id, p] as const))
  const tName = (id: string) => {
    const t = teams.find((x) => x.id === id)
    return t?.shortName || t?.name || ''
  }
  const who = (id?: string) => {
    const p = id ? pById.get(id) : undefined
    return p ? (p.number != null ? `${p.number} - ${p.name}` : p.name) : '(não informado)'
  }
  const byMinute = (a: MatchEvent, b: MatchEvent) => (a.minute ?? 999) - (b.minute ?? 999)
  const mm = (e: MatchEvent) => (e.minute != null ? `${e.minute}'` : '')

  const M = 28
  const W = A4_LARGURA - M * 2
  const LIMITE = A4_ALTURA - 32
  const ESCURO = 0.12
  const CINZA = 0.9
  const paginas: Pagina[] = []
  let pg = new Pagina()
  let y = M
  paginas.push(pg)

  const novaPagina = () => {
    pg = new Pagina()
    paginas.push(pg)
    y = M
  }
  const garantir = (h: number) => {
    if (y + h > LIMITE) novaPagina()
  }
  /** Faixa escura com o título de uma seção. */
  const secao = (titulo: string, x = M, w = W) => {
    pg.retangulo(x, y, w, 15, { fill: ESCURO })
    pg.texto(titulo.toUpperCase(), x + 6, y + 10.5, { tamanho: 8.5, negrito: true, cor: 1 })
  }

  // Cabeçalho -----------------------------------------------------------
  pg.retangulo(M, y, W, 46, { stroke: 0, espessura: 1 })
  pg.texto(championship.name, M + 10, y + 21, { tamanho: 15, negrito: true, largura: W - 190 })
  pg.texto(
    [category?.name, championship.season].filter(Boolean).join(' - ') || 'Campeonato',
    M + 10,
    y + 38,
    { tamanho: 9.5, cor: 0.35, largura: W - 190 },
  )
  pg.texto('SÚMULA DE JOGO', M + W - 10, y + 30, { tamanho: 16, negrito: true, alinhar: 'd' })
  y += 56

  // Confronto -----------------------------------------------------------
  const placar = match.homeScore != null && match.awayScore != null ? `${match.homeScore}   x   ${match.awayScore}` : '___   x   ___'
  pg.retangulo(M, y, W, 52, { stroke: 0, espessura: 1 })
  const metade = (W - 120) / 2
  pg.texto(home?.name ?? 'A definir', M + metade / 2, y + 22, { tamanho: 13, negrito: true, alinhar: 'c', largura: metade - 10 })
  pg.texto('MANDANTE', M + metade / 2, y + 38, { tamanho: 7.5, cor: 0.45, alinhar: 'c' })
  pg.texto(placar, M + W / 2, y + 28, { tamanho: 20, negrito: true, alinhar: 'c' })
  if (match.penaltyHome != null && match.penaltyAway != null) {
    pg.texto(`${match.penaltyHome} x ${match.penaltyAway} nos pênaltis`, M + W / 2, y + 44, { tamanho: 7.5, negrito: true, cor: 0.4, alinhar: 'c' })
  }
  pg.texto(away?.name ?? 'A definir', M + W - metade / 2, y + 22, { tamanho: 13, negrito: true, alinhar: 'c', largura: metade - 10 })
  pg.texto('VISITANTE', M + W - metade / 2, y + 38, { tamanho: 7.5, cor: 0.45, alinhar: 'c' })
  y += 52

  // Dados da partida (campos rotulados) ----------------------------------
  const refereeName = (championship.referees ?? []).find((r) => r.id === match.refereeId)?.name ?? ''
  const phase = match.phase === 'group' ? `Rodada ${match.round}` : PHASE_LABELS[match.phase]
  const situacao = match.status === 'finished' ? 'Encerrada' : match.status === 'live' ? 'Ao vivo' : 'Agendada'
  const campos: [string, string, number][] = [
    ['FASE', phase, 0.18],
    ['DATA / HORA', match.scheduledAt ? fmtDatePlain(match.scheduledAt) : '', 0.24],
    ['LOCAL', match.venue ?? '', 0.3],
    ['ÁRBITRO', refereeName, 0.28],
  ]
  let cx = M
  for (const [rotulo, valor, frac] of campos) {
    const w = W * frac
    pg.retangulo(cx, y, w, 30, { stroke: 0, espessura: 0.6 })
    pg.texto(rotulo, cx + 5, y + 9, { tamanho: 6.5, negrito: true, cor: 0.4 })
    pg.texto(valor, cx + 5, y + 23, { tamanho: 9.5, largura: w - 10 })
    cx += w
  }
  y += 30
  pg.texto(`Situação: ${situacao}`, M + W, y + 11, { tamanho: 7.5, cor: 0.4, alinhar: 'd' })
  y += 18

  // Elencos (lado a lado) -------------------------------------------------
  const elenco = (team?: Team) => {
    if (!team) return []
    const list = players.filter((p) => p.teamId === team.id && (!category || p.categoryId === category.id))
    const atletas = list.filter((p) => (p.role ?? 'atleta') === 'atleta').sort((a, b) => (a.number ?? 99) - (b.number ?? 99))
    const comissao = list.filter((p) => p.role === 'comissao')
    return [...atletas.map((p) => ({ p, staff: false })), ...comissao.map((p) => ({ p, staff: true }))]
  }
  const casa = elenco(home)
  const fora = elenco(away)
  const linhasElenco = Math.max(16, casa.length, fora.length)
  const gap = 10
  const colW = (W - gap) / 2
  const RH = 13
  const colunas = [colW * 0.1, colW * 0.46, colW * 0.18, colW * 0.26] // nº, nome, posição, assinatura
  const cabecalhos = ['Nº', 'Atleta / comissão', 'Posição', 'Assinatura']

  const tabelaElenco = (x: number, nome: string, lista: ReturnType<typeof elenco>, de: number, ate: number, y0: number) => {
    secao(nome, x, colW)
    let yy = y0 + 15
    pg.retangulo(x, yy, colW, 13, { fill: CINZA, stroke: 0.5 })
    let tx = x
    colunas.forEach((cw, i) => {
      pg.texto(cabecalhos[i], tx + 4, yy + 9, { tamanho: 7, negrito: true })
      tx += cw
    })
    yy += 13
    for (let i = de; i < ate; i++) {
      const item = lista[i]
      pg.retangulo(x, yy, colW, RH, { stroke: 0.55, espessura: 0.4, fill: item?.staff ? 0.96 : undefined })
      if (item) {
        const { p } = item
        pg.texto(p.number != null ? String(p.number) : item.staff ? 'CT' : '', x + colunas[0] / 2, yy + 10, { tamanho: 8, negrito: true, alinhar: 'c' })
        pg.texto(p.name, x + colunas[0] + 4, yy + 10, { tamanho: 8, largura: colunas[1] - 8 })
        pg.texto(item.staff ? 'Comissão' : labelDaPosicao(p.position), x + colunas[0] + colunas[1] + 4, yy + 10, { tamanho: 7, cor: 0.35, largura: colunas[2] - 8 })
      }
      let vx = x
      for (const cw of colunas.slice(0, -1)) {
        vx += cw
        pg.linha(vx, yy, vx, yy + RH, 0.55, 0.4)
      }
      yy += RH
    }
  }
  let feitas = 0
  while (feitas < linhasElenco) {
    const cabe = Math.floor((LIMITE - y - 28) / RH)
    if (cabe < 4) {
      novaPagina()
      continue
    }
    const ate = Math.min(linhasElenco, feitas + cabe)
    tabelaElenco(M, `Mandante - ${home?.name ?? ''}`, casa, feitas, ate, y)
    tabelaElenco(M + colW + gap, `Visitante - ${away?.name ?? ''}`, fora, feitas, ate, y)
    y += 28 + (ate - feitas) * RH + 6
    feitas = ate
  }

  // Tabelas de ocorrências --------------------------------------------------
  const ocorrencias = (
    titulo: string,
    cols: { nome: string; frac: number }[],
    linhas: string[][],
    minimo: number,
    x = M,
    w = W,
  ) => {
    const n = Math.max(minimo, linhas.length)
    garantir(15 + 13 + n * RH + 8)
    secao(titulo, x, w)
    let yy = y + 15
    pg.retangulo(x, yy, w, 13, { fill: CINZA, stroke: 0.5 })
    let tx = x
    for (const c of cols) {
      pg.texto(c.nome, tx + 4, yy + 9, { tamanho: 7, negrito: true })
      tx += w * c.frac
    }
    yy += 13
    for (let i = 0; i < n; i++) {
      pg.retangulo(x, yy, w, RH, { stroke: 0.55, espessura: 0.4 })
      let cxx = x
      cols.forEach((c, k) => {
        const cw = w * c.frac
        if (linhas[i]?.[k]) pg.texto(linhas[i][k], cxx + 4, yy + 10, { tamanho: 8, largura: cw - 8 })
        if (k > 0) pg.linha(cxx, yy, cxx, yy + RH, 0.55, 0.4)
        cxx += cw
      })
      yy += RH
    }
    return 15 + 13 + n * RH
  }

  const gols = ev.filter((e) => e.type === 'goal' || e.type === 'own_goal').sort(byMinute)
    .map((e) => [mm(e), who(e.playerId) + (e.type === 'own_goal' ? ' (contra)' : ''), tName(e.teamId)])
  y += ocorrencias('Gols marcados', [{ nome: 'Min', frac: 0.1 }, { nome: 'Atleta (nº e nome)', frac: 0.6 }, { nome: 'Equipe', frac: 0.3 }], gols, 3) + 6

  const amarelos = ev.filter((e) => e.type === 'yellow_card').sort(byMinute).map((e) => [mm(e), who(e.playerId), tName(e.teamId)])
  const vermelhos = ev.filter((e) => e.type === 'red_card').sort(byMinute)
    .map((e) => [mm(e), who(e.playerId), tName(e.teamId), e.detail ?? ''])
  const nCart = Math.max(3, amarelos.length, vermelhos.length)
  garantir(15 + 13 + nCart * RH + 8)
  const hA = ocorrencias('Cartões amarelos', [{ nome: 'Min', frac: 0.14 }, { nome: 'Atleta', frac: 0.56 }, { nome: 'Equipe', frac: 0.3 }], amarelos, nCart, M, colW)
  ocorrencias('Cartões vermelhos / expulsões', [{ nome: 'Min', frac: 0.12 }, { nome: 'Atleta', frac: 0.4 }, { nome: 'Equipe', frac: 0.24 }, { nome: 'Motivo', frac: 0.24 }], vermelhos, nCart, M + colW + gap, colW)
  y += hA + 6

  const subs = ev.filter((e) => e.type === 'substitution').sort(byMinute)
    .map((e) => [mm(e), who(e.playerId), who(e.playerInId), tName(e.teamId)])
  y += ocorrencias('Substituições', [{ nome: 'Min', frac: 0.1 }, { nome: 'Sai', frac: 0.35 }, { nome: 'Entra', frac: 0.35 }, { nome: 'Equipe', frac: 0.2 }], subs, 3) + 6

  // Incidentes e assinaturas -----------------------------------------------
  garantir(15 + 36 + 22 + 12)
  secao('Relato de incidentes')
  pg.retangulo(M, y + 15, W, 36, { stroke: 0.5, espessura: 0.5 })
  const relato = match.incidents ?? ''
  const palavras = relato.split(/\s+/).filter(Boolean)
  let lin = ''
  let ly = y + 27
  for (const w of palavras) {
    const t = lin ? `${lin} ${w}` : w
    if (larguraDe(t, 8.5) > W - 12 && lin) {
      pg.texto(lin, M + 6, ly, { tamanho: 8.5 })
      ly += 11
      lin = w
      if (ly > y + 15 + 32) break
    } else lin = t
  }
  if (lin && ly <= y + 15 + 32) pg.texto(lin, M + 6, ly, { tamanho: 8.5 })
  y += 15 + 36 + 22

  const assin = ['Árbitro', 'Capitão / responsável - mandante', 'Capitão / responsável - visitante']
  const aw = (W - 20 * 2) / 3
  assin.forEach((rotulo, i) => {
    const ax = M + i * (aw + 20)
    pg.linha(ax, y, ax + aw, y, 0, 0.7)
    pg.texto(rotulo, ax + aw / 2, y + 10, { tamanho: 7.5, cor: 0.35, alinhar: 'c', largura: aw })
    if (i === 0 && refereeName) pg.texto(refereeName, ax + aw / 2, y - 4, { tamanho: 8.5, alinhar: 'c', largura: aw })
  })

  // Rodapé em todas as páginas
  paginas.forEach((p, i) => {
    p.texto(`${championship.name} - ${home?.name ?? ''} x ${away?.name ?? ''}`, M, A4_ALTURA - 18, { tamanho: 7, cor: 0.45, largura: W - 80 })
    p.texto(`Página ${i + 1} de ${paginas.length}`, M + W, A4_ALTURA - 18, { tamanho: 7, cor: 0.45, alinhar: 'd' })
  })

  return gerarPdfPaginas(paginas, `Súmula - ${home?.name ?? ''} x ${away?.name ?? ''}`)
}

function fmtDatePlain(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
