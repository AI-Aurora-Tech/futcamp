// O mata-mata de cada categoria segue a configuração DA CATEGORIA
// (src/lib/categorias.ts → competicaoDaCategoria; src/lib/knockout.ts).
import { competicaoDaCategoria, elencoDeTimes, partidasDaCategoria } from '../src/lib/categorias'
import { hasKnockoutStage, planKnockout, resolveBracketTeams } from '../src/lib/knockout'
import { generateRoundRobin } from '../src/lib/fixtures'
import { classificacaoEncerrada } from '../src/lib/tabela'
import { ok } from './ajuda'

// Campeonato: grupos + mata-mata; cada categoria com a sua estrutura.
const camp: any = {
  id: 'c', format: 'groups_knockout', numGroups: 2, advancePerGroup: 2, thirdPlace: false,
  pointsWin: 3, pointsDraw: 1, doubleRound: false,
  categories: [
    // Sub10: 2 grupos, 2 classificados por grupo, com disputa de 3º lugar.
    { id: 'sub10', name: 'Sub10', numGroups: 2, advancePerGroup: 2, thirdPlace: true },
    // Sub14: 3 grupos, classificação GERAL, 8 classificados, sem 3º lugar.
    { id: 'sub14', name: 'Sub14', numGroups: 3, generalStanding: true, leagueQualifiers: 8, thirdPlace: false },
  ],
}

// Times: no Sub10 grupos A/B (4 cada); no Sub14 grupos A/B/C (4 cada).
const times: any[] = []
const add = (cat: string, prefixo: string, grupos: string[]) => {
  for (const g of grupos) for (let i = 1; i <= 4; i++) {
    times.push({ id: `${prefixo}${g}${i}`, name: `${prefixo}${g}${i}`, championshipId: 'c', categoryIds: [cat], groupByCategory: { [cat]: g }, group: g })
  }
}
add('sub10', 'x', ['A', 'B'])
add('sub14', 'y', ['A', 'B', 'C'])

// Todos contra todos em cada grupo, todos encerrados: o time de número menor vence.
let n = 0
const jogos: any[] = []
for (const cat of ['sub10', 'sub14']) {
  const daCat = times.filter((t) => t.categoryIds.includes(cat))
  const grupos = [...new Set(daCat.map((t) => t.groupByCategory[cat]))]
  for (const g of grupos) {
    const ids = daCat.filter((t) => t.groupByCategory[cat] === g).map((t) => t.id)
    for (const f of generateRoundRobin(ids)) {
      const [h, a] = [f.homeTeamId!, f.awayTeamId!]
      const hv = Number(h.slice(-1)) < Number(a.slice(-1))
      jogos.push({ id: `m${n++}`, championshipId: 'c', categoryId: cat, round: f.round, phase: 'group', stage: 1, group: g,
        homeTeamId: h, awayTeamId: a, homeScore: hv ? 2 : 0, awayScore: hv ? 0 : 2, status: 'finished' })
    }
  }
}

function mataMata(cat: string) {
  const comp = competicaoDaCategoria(camp, cat)
  const tms = elencoDeTimes(times, cat)
  const ms = partidasDaCategoria(jogos, cat, 'sub10')
  const pares = resolveBracketTeams(comp, tms, ms)
  return { comp, tms, ms, pares, plano: planKnockout(pares, comp.thirdPlace) }
}

const s10 = mataMata('sub10')
ok('Sub10: fase de grupos encerrada (todos os confrontos jogados)', classificacaoEncerrada(s10.comp, s10.tms, s10.ms, 'sub10'))
ok('Sub10: tem mata-mata', hasKnockoutStage(s10.comp))
ok('Sub10: 2 por grupo × 2 grupos = semifinal com 2 jogos', s10.plano.filter((p) => p.phase === 'semi').length === 2)
ok('Sub10: cruzamento 1ºA × 2ºB e 1ºB × 2ºA', JSON.stringify(s10.pares) === JSON.stringify([{ home: 'xA1', away: 'xB2' }, { home: 'xB1', away: 'xA2' }]))
ok('Sub10: disputa de 3º lugar (configuração da categoria)', s10.plano.some((p) => p.phase === 'third_place'))
ok('Sub10: só times do Sub10 no mata-mata', s10.pares.every((p) => [p.home, p.away].every((id) => !id || id.startsWith('x'))))

const s14 = mataMata('sub14')
ok('Sub14: fase de grupos encerrada', classificacaoEncerrada(s14.comp, s14.tms, s14.ms, 'sub14'))
ok('Sub14: classificação geral com 8 classificados = quartas com 4 jogos', s14.plano.filter((p) => p.phase === 'quarter').length === 4)
ok('Sub14: sem disputa de 3º lugar (configuração da categoria)', !s14.plano.some((p) => p.phase === 'third_place'))
ok('Sub14: só times do Sub14 no mata-mata', s14.pares.every((p) => [p.home, p.away].every((id) => !id || id.startsWith('y'))))
ok('Sub14: 8 times diferentes nas quartas', new Set(s14.pares.flatMap((p) => [p.home, p.away])).size === 8)
