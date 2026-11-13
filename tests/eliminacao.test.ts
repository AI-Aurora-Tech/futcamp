// ---------------------------------------------------------------------------
// Regras de "quem já está eliminado" (src/lib/eliminacao.ts → timesForaDaDisputa).
//
// Rodar:  npm run test:regras   (roda todos os arquivos de tests/)
// ---------------------------------------------------------------------------
import { timesForaDaDisputa, WO_ELIMINACAO } from '../src/lib/eliminacao'
import { ok } from './ajuda'
const T = (id: string) => ({ id, name: id.toUpperCase(), championshipId: 'c' } as any)
const times = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map(T)
const camp: any = { id: 'c', format: 'groups_knockout', categories: [], autoKnockout: true }
let n = 0
const J = (o: any) => ({ id: 'm' + n++, championshipId: 'c', round: 1, status: 'scheduled', homeScore: null, awayScore: null, ...o })
const fim = (phase: string, h: string, a: string, hs: number, as: number, extra: any = {}) => J({ phase, homeTeamId: h, awayTeamId: a, homeScore: hs, awayScore: as, status: 'finished', ...extra })
const fora = (matches: any[], fase: any, c: any = camp) => timesForaDaDisputa({ championship: c, teams: times, matches, fase })
const lista = (s: Set<string>) => [...s].sort().join(',')

ok('fase de grupos: ninguém é bloqueado', fora([fim('group', 'a', 'b', 0, 3, { incidents: WO_ELIMINACAO + ': A' })], 'group').size === 0)

// Eliminada por W.O. (derrota 0x3 com a marca)
const wo = fim('group', 'a', 'b', 0, 3, { incidents: WO_ELIMINACAO + ': A (derrota por 3 × 0).' })
ok('eliminada por W.O. não pode entrar nas quartas', fora([wo], 'quarter').has('a') && !fora([wo], 'quarter').has('b'))

// Mata-mata em andamento: 8 times nas quartas (a..h); i ficou fora da fase de grupos
const quartas = [fim('quarter', 'a', 'b', 2, 0), fim('quarter', 'c', 'd', 0, 1), J({ phase: 'quarter', homeTeamId: 'e', awayTeamId: 'f' }), J({ phase: 'quarter', homeTeamId: 'g', awayTeamId: 'h' })]
const f1 = fora(quartas, 'semi')
ok('perdeu nas quartas (encerrada) → fora: b, c', f1.has('b') && f1.has('c') && !f1.has('a') && !f1.has('d'))
ok('jogo ainda não encerrado não elimina ninguém (e, f, g, h)', !['e', 'f', 'g', 'h'].some((x) => f1.has(x)))
ok('quem não entrou no chaveamento montado pela classificação → fora: i', f1.has('i'))

// Semifinais encerradas: a x d e e x g
const semis = [...quartas, fim('semi', 'a', 'd', 1, 0), fim('semi', 'e', 'g', 0, 2)]
const final = fora(semis, 'final')
ok('final: perdedores das semifinais (d, e) estão fora', final.has('d') && final.has('e') && !final.has('a') && !final.has('g'))
const terceiro = fora(semis, 'third_place')
ok('3º lugar: só os perdedores das semifinais (d, e) podem entrar', !terceiro.has('d') && !terceiro.has('e'))
ok('  e todos os outros ficam de fora', ['a', 'b', 'c', 'f', 'g', 'h', 'i'].every((x) => terceiro.has(x)))
const semiPendente = fora([...quartas, fim('semi', 'a', 'd', 1, 0), J({ phase: 'semi', homeTeamId: 'e', awayTeamId: 'g' })], 'third_place')
ok('3º lugar com semifinal pendente: não trava ninguém por engano (só os que já perderam)', !semiPendente.has('a') && !semiPendente.has('d') && semiPendente.has('b'))

// Empate sem classificado definido: ninguém é eliminado ainda
const empate = fora([fim('quarter', 'a', 'b', 1, 1), J({ phase: 'quarter', homeTeamId: 'c', awayTeamId: 'd' })], 'semi')
ok('empate sem classificado definido não elimina ninguém (a, b)', !empate.has('a') && !empate.has('b'))
// ...mas decidido nos pênaltis, sim
ok('decidido nos pênaltis: o perdedor sai', fora([fim('quarter', 'a', 'b', 1, 1, { penaltyHome: 3, penaltyAway: 5 })], 'semi').has('a'))

// Quando "não aparece no chaveamento" não prova nada
const manual = { ...camp, autoKnockout: false }
ok('montagem à mão: quem não está no chaveamento NÃO é bloqueado', !fora(quartas, 'semi', manual).has('i'))
const escalonado = { ...camp, format: 'league', leagueEntries: [{ from: 1, to: 2, phase: 'semi' }] }
ok('entrada escalonada: quem não está no chaveamento NÃO é bloqueado', !fora(quartas, 'semi', escalonado).has('i'))
ok('sem mata-mata criado ainda: só W.O. e perdedores contam (i livre)', !fora([wo], 'quarter').has('i'))

// Jogo novo com time já eliminado nasce com W.O. (aplicarWoSeEliminado)
import { aplicarWoSeEliminado } from '../src/lib/eliminacao'
const nome = (id: string) => id.toUpperCase()
const jaEliminado = [fim('group', 'a', 'b', 0, 3, { incidents: WO_ELIMINACAO + ': A (derrota por 3 × 0).' })]
const novo = (h: string, a: string, extra: any = {}) => ({ championshipId: 'c', round: 3, phase: 'group', status: 'scheduled', homeTeamId: h, awayTeamId: a, homeScore: null, awayScore: null, ...extra }) as any
const r1 = aplicarWoSeEliminado(novo('c', 'a'), jaEliminado, nome)
ok('jogo novo contra eliminado (fora de casa): 3 × 0 para o mandante, encerrado', r1.status === 'finished' && r1.homeScore === 3 && r1.awayScore === 0 && r1.incidents.includes(WO_ELIMINACAO))
const r2 = aplicarWoSeEliminado(novo('a', 'd'), jaEliminado, nome)
ok('jogo novo com eliminado em casa: 0 × 3', r2.homeScore === 0 && r2.awayScore === 3)
ok('jogo novo sem eliminado fica como está', aplicarWoSeEliminado(novo('c', 'd'), jaEliminado, nome).status === 'scheduled')
const r3 = aplicarWoSeEliminado(novo('a', 'e', { phase: 'quarter' }), jaEliminado, nome)
ok('mata-mata: adversário do eliminado é o classificado', r3.winnerTeamId === 'e')
ok('eliminado em outra categoria não conta', aplicarWoSeEliminado(novo('a', 'd', { categoryId: 'sub12' }), jaEliminado, nome).status === 'scheduled')
ok('jogo já encerrado não muda', aplicarWoSeEliminado({ ...novo('a', 'd'), status: 'finished', homeScore: 2, awayScore: 1 }, jaEliminado, nome).homeScore === 2)
