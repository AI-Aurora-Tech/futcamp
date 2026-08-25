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

/** Baixa a súmula como arquivo .html. */
export function downloadSumula(filename: string, html: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
