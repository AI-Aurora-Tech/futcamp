// Limite de equipes do plano (src/lib/pricing.ts): vale POR CATEGORIA.
import { cabeMaisUmTime, limitePorCategoria } from '../src/lib/pricing'
import { timesDaCategoria } from '../src/lib/categorias'
import { ok } from './ajuda'

const semPrevistas = { categories: [{ id: 'sub10', name: 'Sub10' }, { id: 'sub12', name: 'Sub12' }] }
ok('limite: campeonato com categorias conta por categoria (mesmo sem equipes previstas)', limitePorCategoria(semPrevistas))
ok('limite: campeonato sem categorias conta o campeonato inteiro', !limitePorCategoria({ categories: [] }))

// Prata (32): 32 no Sub10 + 10 no Sub12 = 42 no campeonato, e ainda cabe no Sub12.
const times = [
  ...Array.from({ length: 32 }, (_, i) => ({ id: `a${i}`, categoryIds: ['sub10'] })),
  ...Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, categoryIds: ['sub12'] })),
] as never[]
ok('limite: Prata com 10 no Sub12 ainda aceita mais no Sub12', cabeMaisUmTime('prata', timesDaCategoria(times, 'sub12').length))
ok('limite: Prata com 32 no Sub10 não aceita mais no Sub10', !cabeMaisUmTime('prata', timesDaCategoria(times, 'sub10').length))

// Inscrições encerradas por categoria (src/lib/categorias.ts).
import { categoriaEncerrada } from '../src/lib/categorias'
const cats = [{ id: 'sub10' }, { id: 'sub12' }]
ok('encerradas: categoria na lista está encerrada', categoriaEncerrada(['sub10'], 'sub10', cats))
ok('encerradas: outra categoria segue aberta', !categoriaEncerrada(['sub10'], 'sub12', cats))
ok('encerradas: atleta sem categoria conta para a primeira', categoriaEncerrada(['sub10'], undefined, cats))
ok('encerradas: lista vazia não encerra nada', !categoriaEncerrada([], 'sub10', cats))
