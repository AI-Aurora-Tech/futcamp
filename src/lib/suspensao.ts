// ---------------------------------------------------------------------------
// Suspensão automática: quem NÃO pode receber presença nesta partida.
//
// A aba de estatísticas já mostrava um alerta de "suspensos" — mas era só
// aviso, e a mesa podia escalar assim mesmo. Aqui a regra vira trava: o atleta
// suspenso não aparece disponível na escalação da partida em que cumpre a
// suspensão.
//
// A diferença em relação ao alerta é o RECORTE DO TEMPO. O alerta pergunta
// "quem está suspenso agora?"; aqui a pergunta é "quem estava suspenso NAQUELA
// partida?" — o que exige olhar só o que aconteceu antes dela. Sem isso, abrir
// a súmula de um jogo antigo mostraria o elenco travado por cartões que o
// atleta só levou depois.
//
// Como a punição é contada:
//
//   • as partidas de cada time entram numa fila, na ordem em que são jogadas;
//   • o gatilho (3º amarelo, ou o vermelho) acontece numa partida da fila;
//   • a suspensão cai sobre a PARTIDA SEGUINTE daquele time.
//
// Cumprir é passar por essa partida seguinte. Por isso o 6º amarelo suspende
// de novo, e o 4º e o 5º não: só os múltiplos do limite disparam.
// ---------------------------------------------------------------------------
import { limiteAmarelos, amareloAcumula } from './regras'
import type { Category, Match, MatchEvent, Player } from '../types'

export interface Suspensao {
  playerId: string
  /** Frase curta para a tela: "3º amarelo", "cartão vermelho". */
  motivo: string
}

/**
 * Ordem em que as partidas de um time acontecem: rodada, depois data marcada
 * (ou criação, quando não há data). É a mesma ordem que o resto do app usa.
 */
function ordemDaPartida(m: Match): [number, string] {
  return [m.round ?? 0, m.scheduledAt ?? m.createdAt ?? '']
}

function comparar(a: Match, b: Match): number {
  const [ra, da] = ordemDaPartida(a)
  const [rb, db] = ordemDaPartida(b)
  if (ra !== rb) return ra - rb
  return da < db ? -1 : da > db ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** As partidas de um time, na ordem de disputa. */
export function partidasDoTime(matches: Match[], teamId: string): Match[] {
  return matches
    .filter((m) => m.homeTeamId === teamId || m.awayTeamId === teamId)
    .slice()
    .sort(comparar)
}

/**
 * Quem, entre os atletas dos dois times, está suspenso NESTA partida.
 *
 * Devolve um mapa `playerId → motivo`. Atleta ausente do mapa está liberado.
 */
export function suspensosNaPartida(params: {
  match: Match
  /** Todas as partidas do campeonato (qualquer situação). */
  matches: Match[]
  events: MatchEvent[]
  players: Player[]
  /** Categorias — definem quantos amarelos suspendem e se acumulam. */
  categories?: Category[]
}): Map<string, Suspensao> {
  const { match, matches, events, players, categories = [] } = params
  const fora = new Map<string, Suspensao>()

  const catById = new Map(categories.map((c) => [c.id, c] as const))
  const times = [match.homeTeamId, match.awayTeamId].filter(Boolean) as string[]

  for (const teamId of times) {
    const fila = partidasDoTime(matches, teamId)
    const posicaoAlvo = fila.findIndex((m) => m.id === match.id)
    // Partida que não está na fila do time (recém-criada, ainda sem salvar):
    // não há histórico anterior a considerar.
    if (posicaoAlvo <= 0) continue

    // Eventos por partida, só dos jogos ANTERIORES a esta e já finalizados.
    const anteriores = fila
      .slice(0, posicaoAlvo)
      .filter((m) => m.status === 'finished')

    for (const p of players) {
      if (p.teamId !== teamId) continue
      if ((p.role ?? 'atleta') !== 'atleta') continue

      const cat = catById.get(p.categoryId ?? '')
      const limite = limiteAmarelos(cat)
      const acumula = amareloAcumula(cat)

      let amarelos = 0
      /** Índice, na fila do time, da partida em que a punição foi disparada. */
      let disparou: number | null = null

      for (let i = 0; i < anteriores.length; i++) {
        const m = anteriores[i]
        const doJogo = events.filter((e) => e.matchId === m.id && e.playerId === p.id)

        // Vermelho: vale em qualquer fase e suspende a partida seguinte.
        if (doJogo.some((e) => e.type === 'red_card')) {
          disparou = fila.findIndex((x) => x.id === m.id)
          fora.set(p.id, { playerId: p.id, motivo: 'cartão vermelho' })
        }

        // Amarelo: só conta na fase de grupos / pontos corridos, como no resto
        // do app — no mata-mata o acúmulo costuma zerar.
        if (acumula && m.phase === 'group') {
          const antes = amarelos
          amarelos += doJogo.filter((e) => e.type === 'yellow_card').length
          // Passou por um múltiplo do limite dentro desta partida?
          if (Math.floor(amarelos / limite) > Math.floor(antes / limite)) {
            disparou = fila.findIndex((x) => x.id === m.id)
            const marco = Math.floor(amarelos / limite) * limite
            fora.set(p.id, { playerId: p.id, motivo: `${marco}º amarelo` })
          }
        }
      }

      // A punição só vale para a partida IMEDIATAMENTE seguinte à do gatilho.
      // Se o time já jogou depois dela, a suspensão foi cumprida.
      if (disparou === null || disparou + 1 !== posicaoAlvo) fora.delete(p.id)
    }
  }

  return fora
}
