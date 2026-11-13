// Prazo de inscrição (src/lib/matchWindow.ts): 0 = inscrições abertas sempre.
import { matchRegistrationClosed, registrationLockForTeam } from '../src/lib/matchWindow'
import { ok } from './ajuda'

const agora = new Date('2026-11-07T12:00:00Z')
const jogo = (horas: number, round = 1) =>
  ({
    id: `m${horas}`,
    championshipId: 'c',
    round,
    phase: 'league',
    homeTeamId: 't1',
    awayTeamId: 't2',
    homeScore: null,
    awayScore: null,
    status: 'scheduled',
    scheduledAt: new Date(agora.getTime() + horas * 3600_000).toISOString(),
    createdAt: '',
  }) as any

ok('prazo 0: jogo daqui a 1 hora não trava', !registrationLockForTeam('t1', [jogo(1)], 0, [], agora).locked)
ok('prazo 0: jogo que já passou da hora não trava', !registrationLockForTeam('t1', [jogo(-2)], 0, [], agora).locked)
ok('prazo 0: rodada encerrada à mão trava', registrationLockForTeam('t1', [jogo(48)], 0, [1], agora).reason === 'manual')
ok('prazo 0: rodada encerrada reabre para o time quando o jogo dele termina', !registrationLockForTeam('t1', [{ ...jogo(48), status: 'finished' }], 0, [1], agora).locked)
ok('prazo 3 h: jogo daqui a 1 hora trava', registrationLockForTeam('t1', [jogo(1)], 3, [], agora).locked)
ok('prazo 3 h: jogo daqui a 5 horas não trava', !registrationLockForTeam('t1', [jogo(5)], 3, [], agora).locked)
ok('prazo 3 h: rodada encerrada à mão trava', registrationLockForTeam('t1', [jogo(48)], 3, [1], agora).reason === 'manual')
ok('súmula, prazo 0: rodada encerrada à mão fecha', matchRegistrationClosed(jogo(1), 0, [1], agora))
ok('súmula, prazo 0: jogo agendado sem rodada encerrada segue aberto', !matchRegistrationClosed(jogo(1), 0, [], agora))
ok('súmula, prazo 0: jogo em andamento fecha', matchRegistrationClosed({ ...jogo(0), status: 'live' }, 0, [], agora))
