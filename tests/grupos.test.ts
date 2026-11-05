// Times por grupo na aba Times (src/lib/gruposDosTimes.ts).
import { agruparTimesPorGrupo } from '../src/lib/gruposDosTimes'
import { ok } from './ajuda'

const t = (name: string, group?: string) => ({ id: name, name, group }) as any
const times = [t('Zebra', 'B'), t('Águia', 'A'), t('Bravos', 'A'), t('Solto'), t('Fantasma', 'Z')]
const r = agruparTimesPorGrupo(times, ['A', 'B', 'C'])

ok('grupos na ordem A, B, C e depois "sem grupo"', r.map((s) => s.grupo ?? '-').join('') === 'ABC-')
ok('times de cada grupo em ordem alfabética', r[0].times.map((x) => x.name).join() === 'Águia,Bravos')
ok('grupo vazio aparece quando pedido', r[2].times.length === 0)
ok('sem grupo junta quem não tem grupo e quem tem grupo que não existe', r[3].times.map((x) => x.name).join() === 'Fantasma,Solto')
ok('na busca, só os grupos com time', agruparTimesPorGrupo(times, ['A', 'B', 'C'], false).map((s) => s.grupo ?? '-').join('') === 'AB-')
ok('sem times, só os grupos vazios', agruparTimesPorGrupo([], ['A', 'B']).length === 2)
