// ---------------------------------------------------------------------------
// Fases da tela de Partidas (src/lib/fasesPartidas.ts → agruparFases).
// ---------------------------------------------------------------------------
import { agruparFases, type SecaoDePartidas } from '../src/lib/fasesPartidas'
import { ok } from './ajuda'

let n = 0
const jogo = (phase: string, status: 'finished' | 'scheduled' | 'live', extra: Record<string, unknown> = {}) =>
  ({ id: 'm' + n++, championshipId: 'c', round: 1, phase, status, homeScore: null, awayScore: null, ...extra }) as any
const grupo = (key: string, title: string, status: 'finished' | 'scheduled' | 'live', stage = 1, qtd = 2): SecaoDePartidas => ({
  key, title, isKnockout: false, matches: Array.from({ length: qtd }, () => jogo('group', status, { stage })),
})
const mata = (phase: string, title: string, status: 'finished' | 'scheduled' | 'live', qtd = 2): SecaoDePartidas => ({
  key: phase, title, isKnockout: true, matches: Array.from({ length: qtd }, () => jogo(phase, status)),
})
const titulo = (e: number) => (e === 1 ? 'Fase de grupos' : `${e}ª fase de grupos`)
const estados = (f: ReturnType<typeof agruparFases>) => f.map((x) => `${x.titulo}:${x.estado}`).join(' | ')

// Grupos A e B encerrados + oitavas em andamento + quartas a definir
let f = agruparFases([
  grupo('gA', 'Grupo A', 'finished'), grupo('gB', 'Grupo B', 'finished'),
  mata('round_of_16', 'Oitavas de final', 'live'), mata('quarter', 'Quartas de final', 'scheduled'),
], titulo)
ok('grupos A e B viram UMA fase, "Fase de grupos"', f.length === 3 && f[0].titulo === 'Fase de grupos' && f[0].sections.length === 2)
ok('fase de grupos encerrada; oitavas em disputa; quartas a seguir',
  estados(f) === 'Fase de grupos:encerrada | Oitavas de final:atual | Quartas de final:futura')
ok('conta os jogos da fase (4 encerrados de 4; oitavas 0 de 2)', f[0].total === 4 && f[0].encerrados === 4 && f[1].total === 2 && f[1].encerrados === 0)

// Só existe UMA fase atual, e é a primeira que não terminou
f = agruparFases([
  grupo('gA', 'Grupo A', 'finished'), mata('quarter', 'Quartas de final', 'finished'),
  mata('semi', 'Semifinal', 'scheduled'), mata('final', 'Final', 'scheduled', 1),
], titulo)
ok('quartas encerradas → semifinal em disputa, final a seguir', estados(f) === 'Fase de grupos:encerrada | Quartas de final:encerrada | Semifinal:atual | Final:futura')
ok('exatamente uma fase "atual"', f.filter((x) => x.estado === 'atual').length === 1)

// Jogo parcialmente jogado: a fase continua em disputa
f = agruparFases([mata('semi', 'Semifinal', 'finished', 1), { ...mata('semi', 'Semifinal', 'scheduled', 1), key: 'semi2' }, mata('final', 'Final', 'scheduled', 1)], titulo)
ok('uma fase com um jogo encerrado e outro não ainda está em disputa', f.length === 3 && f[0].estado === 'encerrada' && f[1].estado === 'atual')
const parcial = agruparFases([{ key: 'q', title: 'Quartas de final', isKnockout: true, matches: [jogo('quarter', 'finished'), jogo('quarter', 'scheduled')] }, mata('semi', 'Semifinal', 'scheduled')], titulo)
ok('metade dos jogos encerrados: quartas atual (1 de 2)', parcial[0].estado === 'atual' && parcial[0].encerrados === 1 && parcial[0].total === 2)

// Várias fases de grupos
f = agruparFases([
  grupo('r1', 'Rodada 1', 'finished', 1), grupo('r2', 'Rodada 2', 'finished', 1),
  grupo('r3', '2ª fase · Rodada 3', 'live', 2), grupo('r4', '2ª fase · Rodada 4', 'scheduled', 2),
  mata('final', 'Final', 'scheduled', 1),
], titulo)
ok('duas fases de grupos: 1ª encerrada, 2ª em disputa, final a seguir',
  estados(f) === 'Fase de grupos:encerrada | 2ª fase de grupos:atual | Final:futura' && f[1].sections.length === 2)

// Campeonato inteiro encerrado: nenhuma fase "atual"
f = agruparFases([grupo('gA', 'Grupo A', 'finished'), mata('final', 'Final', 'finished', 1)], titulo)
ok('tudo encerrado: nenhuma fase "atual"', f.every((x) => x.estado === 'encerrada'))

// Só uma fase (liga)
f = agruparFases([grupo('r1', 'Rodada 1', 'finished'), grupo('r2', 'Rodada 2', 'scheduled')], titulo)
ok('liga/rodadas de uma fase só: uma fase com as duas rodadas', f.length === 1 && f[0].sections.length === 2 && f[0].estado === 'atual')

// Disputa de 3º depois da final
f = agruparFases([mata('semi', 'Semifinal', 'finished'), mata('final', 'Final', 'finished', 1), mata('third_place', 'Disputa de 3º lugar', 'scheduled', 1)], titulo)
ok('final encerrada e 3º lugar pendente: o 3º lugar é a fase em disputa', f[2].estado === 'atual' && f[1].estado === 'encerrada')
ok('sem seções: nenhuma fase', agruparFases([], titulo).length === 0)
