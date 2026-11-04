import { useCallback, useEffect, useState } from 'react'
import { getChampionship } from '../services/championships'
import { listTeams } from '../services/teams'
import { listPlayers } from '../services/players'
import { listEvents, listMatches, requestKnockoutSync } from '../services/matches'
import { listAssignedMatches, mesaWriter } from '../services/officials'
import { fecharSessaoMesa, lerSessaoMesa, type MesaSession } from '../lib/mesaSession'
import {
  atletaDaCategoria,
  categoriaPadrao,
  competicaoDaCategoria,
  elencoDeTimes,
  partidasDaCategoria,
  temVariasCategorias,
} from '../lib/categorias'
import type { Championship, Match, Player, Team } from '../types'
import { ChampLogo, EmptyState, Spinner, StatusPill } from './ui'
import { MatchRow } from './MatchesPanel'
import { MatchResultModal } from './MatchResultModal'
import { useRealtimeChampionship } from '../lib/realtime'

type Session = MesaSession

export function MesaPortal({ championshipId, onHome }: { championshipId: string; onHome: () => void }) {
  const [champ, setChamp] = useState<Championship | null>(null)
  const [loading, setLoading] = useState(true)
  // A sessão nasce na tela de login principal. Sem ela, volta para lá.
  const [session, setSession] = useState<Session | null>(() => lerSessaoMesa(championshipId))
  const [teams, setTeams] = useState<Team[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  /**
   * TODAS as partidas do campeonato. O mesário só vê os jogos dele na lista,
   * mas a conta de suspensão precisa das rodadas anteriores de cada time —
   * inclusive as que outro mesário apitou.
   */
  const [todasPartidas, setTodasPartidas] = useState<Match[]>([])
  const [editing, setEditing] = useState<Match | null>(null)

  useEffect(() => {
    getChampionship(championshipId)
      .then(setChamp)
      .finally(() => setLoading(false))
  }, [championshipId])

  // Não há mais login próprio do mesário: quem chega sem sessão (link antigo,
  // aba nova, saiu) vai para a tela de login principal.
  useEffect(() => {
    if (!session) onHome()
  }, [session, onHome])

  const loadData = useCallback(async () => {
    if (!session) return
    const [t, p, m, todas] = await Promise.all([
      listTeams(championshipId),
      listPlayers(championshipId),
      listAssignedMatches(championshipId, session.officialId),
      listMatches(championshipId).catch(() => [] as Match[]),
    ])
    setTeams(t)
    setPlayers(p)
    setMatches(m)
    setTodasPartidas(todas)
  }, [championshipId, session])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // Tempo real: jogos atribuídos, remarcados ou alterados pelo organizador
  // aparecem sem recarregar a janela.
  useRealtimeChampionship(session ? championshipId : null, () => void loadData().catch(() => {}))

  /**
   * Depois que o mesário salva um jogo: se aquele era o último da primeira
   * fase, o mata-mata é criado na hora (e os vencedores avançam) — sem
   * depender do administrador abrir o campeonato.
   */
  const afterSave = useCallback(async () => {
    try {
      if (champ) {
        const [all, evs] = await Promise.all([listMatches(championshipId), listEvents(championshipId)])
        await requestKnockoutSync(champ, await listTeams(championshipId), all, evs)
      }
    } catch {
      /* sem permissão de escrita: o administrador conclui ao abrir o campeonato */
    }
    await loadData()
  }, [champ, championshipId, loadData])

  function logout() {
    fecharSessaoMesa(championshipId)
    setSession(null)
    setMatches([])
  }

  if (loading) return <div className="container pad-lg"><Spinner /></div>
  if (!champ) {
    return (
      <div className="container pad-lg center">
        <div className="empty__icon">🔒</div>
        <h2>Campeonato não encontrado</h2>
        <button className="btn btn--primary" onClick={onHome}>Ir para o início</button>
      </div>
    )
  }

  const writer = session
    ? mesaWriter({ championshipId, officialId: session.officialId, username: session.username, password: session.password })
    : null

  // A partida aberta é de UMA categoria: o mesário só vê os atletas, os clubes
  // e as partidas dela — o mesmo recorte que o painel do administrador faz.
  const varias = temVariasCategorias(champ)
  const padraoCat = categoriaPadrao(champ)
  const catPartida = editing && varias ? editing.categoryId ?? padraoCat : undefined
  const compPartida = competicaoDaCategoria(champ, catPartida)
  // Os dois clubes do jogo ficam sempre — mesmo que a inscrição deles na
  // categoria esteja incompleta, o mesário precisa vê-los na partida.
  const timesPartida = elencoDeTimes(teams, catPartida)
  for (const t of teams) {
    if ((t.id === editing?.homeTeamId || t.id === editing?.awayTeamId) && !timesPartida.some((x) => x.id === t.id)) {
      timesPartida.push(t)
    }
  }
  const partidasCat = partidasDaCategoria(todasPartidas, catPartida, padraoCat)
  const atletasPartida = players.filter((p) => atletaDaCategoria(p.categoryId, catPartida, padraoCat))

  return (
    <div className="reg" style={{ '--accent': champ.primaryColor ?? '#16a34a' } as React.CSSProperties}>
      <header className="reg__hero">
        <div className="container">
          <div className="reg__champ">
            <span className="reg__champ-logo"><ChampLogo logo={champ.logo} /></span>
            <div>
              <p className="reg__eyebrow">Portal do mesário</p>
              <h1>{champ.name}</h1>
            </div>
            {session && (
              <button className="btn btn--ghost btn--sm mesa-logout" onClick={logout}>Sair ({session.name})</button>
            )}
          </div>
        </div>
      </header>

      <div className="container reg__content">
        {!session ? (
          <Spinner />
        ) : (
          <section className="panel reg__panel">
            <div className="panel__head">
              <div>
                <h2>Meus jogos ({matches.length})</h2>
                <p className="muted">Clique em um jogo para lançar o placar e os eventos em tempo real.</p>
              </div>
            </div>
            {matches.length === 0 ? (
              <EmptyState icon="📅" title="Nenhum jogo atribuído">
                <p>O organizador ainda não atribuiu partidas a você.</p>
              </EmptyState>
            ) : (
              <div className="mesa-matches">
                {matches.map((m) => (
                  <div key={m.id} className="mesa-match">
                    <div className="mesa-match__meta">
                      <StatusPill status={m.status} />
                      {m.scheduledAt && <span className="muted small">{new Date(m.scheduledAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}
                      {m.venue && <span className="muted small">· {m.venue}</span>}
                    </div>
                    <MatchRow match={m} teams={teams} onClick={() => setEditing(m)} />
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {editing && writer && (
        <MatchResultModal
          key={editing.id}
          championship={compPartida}
          match={editing}
          allMatches={partidasCat}
          teams={timesPartida}
          players={atletasPartida}
          writer={writer}
          readOnlySchedule
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void afterSave()
          }}
        />
      )}
    </div>
  )
}
