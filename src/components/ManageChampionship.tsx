import { useCallback, useEffect, useState } from 'react'
import {
  daysLeftPublic,
  deleteChampionship,
  getChampionship,
  updateChampionship,
  type NewChampionship,
} from '../services/championships'
import { listTeams } from '../services/teams'
import { listPlayers } from '../services/players'
import { listEvents, listMatches, syncKnockout } from '../services/matches'
import { listOfficials } from '../services/officials'
import { useAuth } from '../context/AuthContext'
import { disablePush, enablePush, pushAvailable } from '../services/push'
import {
  FORMAT_LABELS,
  SPORT_LABELS,
  type Championship,
  type Match,
  type MatchEvent,
  type Official,
  type Player,
  type Team,
} from '../types'
import { Button, ChampLogo, PushToggle, Spinner, StatusPill } from './ui'
import { Overview } from './Overview'
import { ChampionTag } from './ChampionBanner'
import { computePodium } from '../lib/champion'
import { TeamsPanel } from './TeamsPanel'
import { PlayersPanel } from './PlayersPanel'
import { MatchesPanel } from './MatchesPanel'
import { StatsPanel } from './StatsPanel'
import { OfficialsPanel } from './OfficialsPanel'
import { RegistriesPanel } from './RegistriesPanel'
import { ChampionshipForm } from './ChampionshipForm'
import { PaymentPanel } from './PaymentPanel'
import { masterRelease } from '../services/payments'
import { RegulamentoButton } from './RegulamentoButton'
import { PlanoBlock } from './PlanoBlock'
import { formatBRL, isLocked } from '../lib/pricing'
import {
  atletaDaCategoria,
  categoriaInicial,
  categoriaPadrao,
  competicaoDaCategoria,
  elencoDeTimes,
  partidasDaCategoria,
  statusDaCategoria,
  temVariasCategorias,
} from '../lib/categorias'
import { setCategoryStatus } from '../services/championships'

type Tab = 'overview' | 'teams' | 'players' | 'matches' | 'officials' | 'registries' | 'stats' | 'settings'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Visão geral', icon: '📊' },
  { id: 'teams', label: 'Times', icon: '🛡️' },
  { id: 'players', label: 'Elencos', icon: '👥' },
  { id: 'matches', label: 'Partidas', icon: '📅' },
  { id: 'officials', label: 'Mesários', icon: '🧑‍⚖️' },
  { id: 'registries', label: 'Cadastros', icon: '🏟️' },
  { id: 'stats', label: 'Estatísticas', icon: '🏅' },
  { id: 'settings', label: 'Ajustes', icon: '⚙️' },
]

export function ManageChampionship({
  championshipId,
  onBack,
}: {
  championshipId: string
  onBack: () => void
}) {
  const { organizer, isMaster } = useAuth()
  const [champ, setChamp] = useState<Championship | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [events, setEvents] = useState<MatchEvent[]>([])
  const [officials, setOfficials] = useState<Official[]>([])
  const [tab, setTab] = useState<Tab>('overview')
  /** Categoria escolhida nas abas. Nula = ainda não escolheu; abre na sugerida. */
  const [catId, setCatId] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [liberando, setLiberando] = useState(false)

  const reload = useCallback(async () => {
    // Carrega o campeonato (crítico) e os demais dados de forma resiliente:
    // a falha de uma consulta secundária (ex.: mesários sem a migration 0006)
    // não pode "derrubar" a tela inteira nem esconder o campeonato.
    const empty = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[])
    const fetchAll = () =>
      Promise.all([
        getChampionship(championshipId).catch(() => null),
        empty(listTeams(championshipId)),
        empty(listPlayers(championshipId)),
        empty(listMatches(championshipId)),
        empty(listEvents(championshipId)),
        empty(listOfficials(championshipId)),
      ])

    let [c, t, p, m, e, o] = await fetchAll()

    // Fase de grupos encerrada? Cria o mata-mata com os classificados e leva os
    // vencedores para a fase seguinte. Só recarrega se algo mudou de fato.
    if (c) {
      const changed = await syncKnockout(c, t, m, e).catch(() => false)
      if (changed) [c, t, p, m, e, o] = await fetchAll()
    }

    setChamp(c)
    setTeams(t)
    setPlayers(p)
    setMatches(m)
    setEvents(e)
    setOfficials(o)
  }, [championshipId])

  useEffect(() => {
    setLoading(true)
    reload().finally(() => setLoading(false))
  }, [reload])

  async function saveEdit(data: NewChampionship) {
    await updateChampionship(championshipId, data)
    setEditing(false)
    await reload()
  }

  /** Liberação manual do master — quem valida é o banco, não o navegador. */
  async function liberar() {
    const nota = prompt(
      'Liberar este campeonato SEM cobrança pelo app.\n\n' +
        'Use quando o pagamento entrou por fora (dinheiro, transferência, cortesia).\n' +
        'Anote o motivo — fica registrado no campeonato:',
      'recebido em dinheiro',
    )
    if (nota === null) return
    setLiberando(true)
    try {
      await masterRelease(championshipId, nota)
      await reload()
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setLiberando(false)
    }
  }

  /**
   * Muda a situação — do campeonato inteiro ou só da categoria aberta.
   *
   * Com várias categorias, a situação é DE CADA UMA: encerrar o Sub-11 não
   * pode encerrar o Sub-17, que ainda está na semifinal.
   */
  async function changeStatus(status: Championship['status']) {
    if (varias && catAtual) await setCategoryStatus(championshipId, catAtual, status)
    else await updateChampionship(championshipId, { status })
    await reload()
  }

  async function remove() {
    if (!champ) return
    // Trava de segurança: só o administrador master exclui campeonatos.
    if (!isMaster) {
      alert('Somente o administrador master pode excluir campeonatos.')
      return
    }
    if (!confirm(`Excluir o campeonato "${champ.name}"? Esta ação não pode ser desfeita.`)) return
    try {
      await deleteChampionship(championshipId)
    } catch (e) {
      alert((e as Error).message)
      return
    }
    onBack()
  }

  function copyPublicLink() {
    const url = `${location.origin}${location.pathname}#/c/${championshipId}`
    navigator.clipboard?.writeText(url).then(
      () => alert('Link público copiado!\n\n' + url),
      () => prompt('Copie o link público:', url),
    )
  }

  if (loading) return <div className="container"><Spinner /></div>
  if (!champ) {
    return (
      <div className="container">
        <p>Campeonato não encontrado.</p>
        <Button onClick={onBack}>Voltar</Button>
      </div>
    )
  }

  // Pagamento pendente: o campeonato existe, mas fica fechado até o Mercado
  // Pago confirmar. O organizador vê só a cobrança — o master não: ele
  // administra qualquer campeonato, em qualquer situação.
  if (isLocked(champ) && !isMaster) {
    return (
      <div className="container pad-lg">
        <button className="back-link" onClick={onBack}>← Meus campeonatos</button>
        <PaymentPanel champ={champ} onPaid={(updated) => setChamp(updated)} onChanged={reload} />
      </div>
    )
  }

  /* ---------------------------------------------------------------------- */
  /* A categoria escolhida — cada uma é uma competição                        */
  /*                                                                          */
  /* Tudo o que as abas mostram passa por aqui: os clubes inscritos, os       */
  /* atletas daquela idade, as partidas com os seus locais e horários, e a    */
  /* própria estrutura (grupos, classificados). O campeonato entregue aos     */
  /* painéis é o `comp`, que já vem com os números da categoria.              */
  /* ---------------------------------------------------------------------- */
  const varias = temVariasCategorias(champ)
  const padraoCat = categoriaPadrao(champ)
  const catAtual = varias ? catId ?? categoriaInicial(champ) : padraoCat
  const comp = competicaoDaCategoria(champ, catAtual)
  const nomeCatAtual = champ.categories.find((c) => c.id === catAtual)?.name ?? 'categoria'
  const timesCat = elencoDeTimes(teams, varias ? catAtual : undefined)
  const partidasCat = partidasDaCategoria(matches, varias ? catAtual : undefined, padraoCat)
  const atletasCat = players.filter((p) =>
    atletaDaCategoria(p.categoryId, varias ? catAtual : undefined, padraoCat),
  )
  // Eventos seguem as partidas: cartão do Sub-11 não entra na artilharia do
  // Sub-15, porque o jogo não é daquela competição.
  const idsCat = new Set(partidasCat.map((m) => m.id))
  const eventosCat = events.filter((e) => idsCat.has(e.matchId))

  return (
    <div className="manage" style={{ '--accent': champ.primaryColor ?? '#16a34a' } as React.CSSProperties}>
      <div className="manage__hero">
        <div className="container manage__hero-inner">
          <button className="back-link" onClick={onBack}>← Meus campeonatos</button>
          <div className="manage__title">
            <span className="manage__logo"><ChampLogo logo={champ.logo} /></span>
            <div>
              <div className="manage__title-row">
                <h1>{champ.name}</h1>
                <StatusPill status={statusDaCategoria(champ, catAtual)} />
              </div>
              <p className="manage__meta">
                {SPORT_LABELS[champ.sport]} · {FORMAT_LABELS[champ.format]}
                {champ.season ? ` · ${champ.season}` : ''}
              </p>
              <ChampionTag podium={computePodium(comp, timesCat, partidasCat, eventosCat)} teams={timesCat} />
            </div>
            <div className="manage__actions">
              {isMaster && isLocked(champ) && (
                <span className="master-tag master-tag--pay" title="O organizador ainda não pagou este campeonato">
                  🔒 pagamento pendente
                </span>
              )}
              {isMaster && organizer && champ.ownerId !== organizer.id && (
                <span className="master-tag" title="Você está administrando o campeonato de outro organizador">
                  👑 modo master
                </span>
              )}
              <Button variant="soft" onClick={copyPublicLink}>🔗 Link público</Button>
            </div>
          </div>
          {/* Cada categoria é uma competição: tabela, jogos, locais e
              classificação próprios. A aba escolhe qual delas está na tela. */}
          {varias && (
            <nav className="cat-tabs" aria-label="Categorias">
              {champ.categories.map((c) => {
                const st = statusDaCategoria(champ, c.id)
                return (
                  <button
                    key={c.id}
                    className={`cat-tab ${catAtual === c.id ? 'is-active' : ''} cat-tab--${st}`}
                    onClick={() => setCatId(c.id)}
                  >
                    {c.name}
                    {st === 'finished' && <span className="cat-tab__mark" title="Categoria encerrada">🏁</span>}
                    {st === 'draft' && <span className="cat-tab__mark" title="Ainda em rascunho">✎</span>}
                  </button>
                )
              })}
            </nav>
          )}

          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t.id} className={`tab ${tab === t.id ? 'is-active' : ''}`} onClick={() => setTab(t.id)}>
                <span className="tab__icon">{t.icon}</span> {t.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="container manage__content">
        {tab === 'overview' && <Overview championship={comp} teams={timesCat} matches={partidasCat} players={atletasCat} events={eventosCat} />}
        {tab === 'teams' && <TeamsPanel championship={comp} teams={teams} categoryId={varias ? catAtual : undefined} onChange={reload} />}
        {tab === 'players' && (
          <PlayersPanel
            championship={comp}
            teams={timesCat}
            players={atletasCat}
            categoryId={varias ? catAtual : undefined}
            onCategoryChange={varias ? setCatId : undefined}
            onChange={reload}
          />
        )}
        {tab === 'matches' && <MatchesPanel championship={comp} teams={timesCat} players={atletasCat} matches={partidasCat} events={eventosCat} officials={officials} categoryId={varias ? catAtual : undefined} onChange={reload} />}
        {tab === 'officials' && <OfficialsPanel championship={champ} officials={officials} matches={matches} onChange={reload} />}
        {tab === 'registries' && <RegistriesPanel championship={champ} onChange={reload} />}
        {tab === 'stats' && <StatsPanel events={eventosCat} players={atletasCat} teams={timesCat} matches={partidasCat} categories={champ.categories} />}
        {tab === 'settings' && (
          <section className="panel">
            <div className="panel__head">
              <div>
                <h2>Ajustes do campeonato</h2>
                <p className="muted">Edite as informações, mude o status ou exclua o campeonato.</p>
              </div>
              <Button onClick={() => setEditing(true)}>✎ Editar informações</Button>
            </div>

            <div className="settings-block">
              <h3>{varias ? `Situação · ${nomeCatAtual}` : 'Status'}</h3>
              <p className="muted small">
                {varias
                  ? `Cada categoria tem a sua fase. Isto vale só para o ${nomeCatAtual} — as outras seguem como estão.`
                  : 'Controle a fase atual da competição.'}
              </p>
              <div className="status-buttons">
                {(['draft', 'active', 'finished'] as const).map((s) => (
                  <button
                    key={s}
                    className={`status-btn ${statusDaCategoria(champ, catAtual) === s ? 'is-active' : ''}`}
                    onClick={() => void changeStatus(s)}
                  >
                    {s === 'draft' ? 'Rascunho' : s === 'active' ? 'Em andamento' : 'Encerrado'}
                  </button>
                ))}
              </div>
              {varias && (
                <ul className="cat-status">
                  {champ.categories.map((c) => {
                    const st = statusDaCategoria(champ, c.id)
                    return (
                      <li key={c.id}>
                        <b>{c.name}</b>
                        <span className={`pill pill--${st === 'active' ? 'active' : st === 'finished' ? 'finished' : 'draft'}`}>
                          {st === 'draft' ? 'Rascunho' : st === 'active' ? 'Em andamento' : 'Encerrado'}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}

              {statusDaCategoria(champ, catAtual) === 'finished' && (
                <p className="muted small">
                  🏆 Campeonato encerrado{' '}
                  {daysLeftPublic(champ)
                    ? `— o campeão fica na vitrine pública por mais ${daysLeftPublic(champ)} dia(s).`
                    : `— saiu da vitrine pública (o link direto continua valendo).`}
                </p>
              )}
            </div>

            {isMaster && isLocked(champ) && (
              <div className="settings-block">
                <h3>Pagamento</h3>
                <p className="muted small">
                  🔒 Este campeonato está com o pagamento pendente
                  {champ.amountCents ? ` (${formatBRL(champ.amountCents)})` : ''} — para o
                  organizador ele fica fechado até o Asaas confirmar. Como master,
                  você continua podendo editar e excluir normalmente.
                </p>
                <div className="pay__master">
                  <p className="muted small">
                    Recebeu por fora do app — dinheiro, transferência, cortesia? Libere na mão.
                    O motivo fica registrado no campeonato.
                  </p>
                  <Button variant="soft" onClick={() => void liberar()} disabled={liberando}>
                    {liberando ? 'Liberando…' : '👑 Liberar sem cobrança'}
                  </Button>
                </div>
              </div>
            )}

            <PlanoBlock champ={champ} totalTimes={teams.length} onChanged={reload} />

            <div className="settings-block">
              <h3>Regulamento</h3>
              <p className="muted small">
                Gerado a partir das informações do campeonato — formato, categorias, pontuação,
                desempate, prazo de inscrição{champ.audience === 'infantil' ? ' e atletas federados' : ''}.
                Os times também podem baixá-lo pelo link de inscrição.
              </p>
              <RegulamentoButton champ={champ} />
            </div>

            <div className="settings-block">
              <h3>Notificações</h3>
              <p className="muted small">
                Receba um aviso no celular quando um time mexer no elenco ou nos próprios dados —
                inscrição, edição e remoção de atletas. Vale para este dispositivo.
              </p>
              <PushToggle
                title="Avisos de alterações dos times"
                hint="Um aviso por time, agrupando alterações seguidas (uma importação não vira dezenas de avisos)."
                available={pushAvailable()}
                enable={() => enablePush({ championshipId, role: 'organizer' })}
                disable={() => disablePush(championshipId)}
              />
            </div>

            <div className="settings-block danger-zone">
              <h3>Zona de perigo</h3>
              {isMaster ? (
                <>
                  <p className="muted small">
                    A exclusão remove times, jogadores, partidas e estatísticas.
                    Você é o administrador master — use com cuidado.
                  </p>
                  <Button variant="danger" onClick={() => void remove()}>Excluir campeonato</Button>
                </>
              ) : (
                <>
                  <p className="muted small">
                    🔒 A exclusão de campeonatos é exclusiva do <b>administrador master</b> —
                    nem mesmo o dono do campeonato pode excluí-lo. Precisa remover esta
                    competição? Fale com o master ou marque o status como “Encerrado”.
                  </p>
                  <Button variant="danger" disabled>Excluir campeonato</Button>
                </>
              )}
            </div>
          </section>
        )}
      </div>

      {editing && <ChampionshipForm initial={champ} onClose={() => setEditing(false)} onSave={saveEdit} />}
    </div>
  )
}
