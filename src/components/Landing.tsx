import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  PUBLIC_FINISHED_DAYS,
  daysLeftPublic,
  listPublicChampionships,
} from '../services/championships'
import { listTeams } from '../services/teams'
import { listEvents, listMatches } from '../services/matches'
import { computePodium } from '../lib/champion'
import { FORMAT_LABELS, SPORT_LABELS, type Championship } from '../types'
import { vitrine } from '../lib/vitrine'
import { statusEfetivo } from '../lib/categorias'
import { teamLoginByEmail, type TeamAccess } from '../services/registration'
import { abrirSessaoTime } from '../lib/teamSession'
import { convitesSemConta, type ConviteOrganizador } from '../services/coorganizers'
import {
  criarSenhaDoMesario,
  mesaLoginByEmail,
  mesaSenhaZerada,
  type MesaAccess,
  type MesaSenhaZerada,
} from '../services/officials'
import { abrirSessaoMesa } from '../lib/mesaSession'
import { Button, ChampLogo, Field, SuporteLink, TeamBadge } from './ui'

/** Campeão de cada campeonato encerrado, para a vitrine pública. */
interface ChampionInfo {
  name: string
  how?: string
}

function openPublic(id: string) {
  window.location.hash = `#/c/${id}`
}

/**
 * Descobre o campeão de cada campeonato encerrado da vitrine. Só roda para os
 * encerrados (poucos, pela janela de dias), um a um, sem derrubar a lista se
 * algum falhar.
 */
async function loadChampions(finished: Championship[]): Promise<Record<string, ChampionInfo>> {
  const entries = await Promise.all(
    finished.slice(0, 12).map(async (c) => {
      try {
        const [teams, matches, events] = await Promise.all([
          listTeams(c.id),
          listMatches(c.id),
          listEvents(c.id),
        ])
        const podium = computePodium(c, teams, matches, events)
        const champion = teams.find((t) => t.id === podium.championId)
        if (!champion) return null
        const how =
          podium.decidedBy === 'final'
            ? podium.finalScore
            : podium.points != null
              ? `${podium.points} ponto(s) em ${podium.played} jogo(s)`
              : undefined
        return [c.id, { name: champion.name, how }] as const
      } catch {
        return null
      }
    }),
  )
  return Object.fromEntries(entries.filter(Boolean) as (readonly [string, ChampionInfo])[])
}

/**
 * Um bloco da vitrine (em andamento OU encerrados). Some quando não há nada
 * para mostrar — bloco vazio na home é ruído.
 */
function Vitrine({
  titulo,
  vazio,
  itens,
  sobrando,
  champions,
}: {
  titulo: string
  vazio: string
  itens: Championship[]
  sobrando: number
  champions: Record<string, ChampionInfo>
}) {
  if (itens.length === 0) return <p className="muted pub-vitrine__vazio">{vazio}</p>

  return (
    <div className="pub-vitrine">
      <div className="pub-vitrine__head">
        <h3>{titulo}</h3>
        {sobrando > 0 && (
          <span className="muted small">
            mostrando os {itens.length} mais recentes · + {sobrando} — use a busca acima
          </span>
        )}
      </div>
      <div className="champ-grid">
        {itens.map((c) => {
          const done = statusEfetivo(c) === 'finished'
          const champion = champions[c.id]
          const days = done ? daysLeftPublic(c) : null
          return (
            <button
              key={c.id}
              className={`champ-card ${done ? 'champ-card--done' : ''}`}
              onClick={() => openPublic(c.id)}
              style={{ '--accent': c.primaryColor ?? '#16a34a' } as React.CSSProperties}
            >
              <div className="champ-card__logo"><ChampLogo logo={c.logo} /></div>
              <div className="champ-card__body">
                <div className="champ-card__top">
                  <h3>{c.name}</h3>
                  <span className={`pill ${done ? 'pill--done' : 'pill--active'}`}>
                    {done ? 'encerrado' : 'ao vivo'}
                  </span>
                </div>
                <p className="champ-card__meta">
                  {SPORT_LABELS[c.sport]} · {FORMAT_LABELS[c.format]}{c.season ? ` · ${c.season}` : ''}
                </p>
                {done && champion && (
                  <p className="champ-card__champion">
                    <span aria-hidden>🏆</span> Campeão: <strong>{champion.name}</strong>
                    {champion.how && <span className="champ-card__how">{champion.how}</span>}
                  </p>
                )}
                <p className="champ-card__desc">
                  {done
                    ? `Ver resultado final${days ? ` · em cartaz por mais ${days} dia(s)` : ''} →`
                    : 'Ver classificação e estatísticas →'}
                </p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Abre o portal do time já autenticado — o e-mail e a senha acabaram de ser conferidos. */
function entrarNoTime(t: TeamAccess) {
  abrirSessaoTime(t.teamId)
  window.location.hash = `#/t/${t.teamId}?k=${encodeURIComponent(t.token)}`
}

/** Abre o portal do mesário já autenticado — só com as partidas dele. */
function entrarComoMesario(m: MesaAccess, password: string) {
  abrirSessaoMesa({
    championshipId: m.championshipId,
    officialId: m.officialId,
    name: m.name,
    username: m.username,
    password,
  })
  window.location.hash = `#/mesa/${m.championshipId}`
}

export function Landing() {
  const { signIn, signUp, enterDemo, mode } = useAuth()
  const [tab, setTab] = useState<'in' | 'up'>('in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Times que o e-mail/senha abriu, quando é mais de um: a pessoa escolhe.
  const [meusTimes, setMeusTimes] = useState<TeamAccess[] | null>(null)
  // Campeonatos em que o e-mail/senha é mesário, quando é mais de um.
  const [minhasMesas, setMinhasMesas] = useState<MesaAccess[] | null>(null)
  // Mesário cuja senha o organizador zerou: cria a nova aqui mesmo.
  // O login de mesário não respondeu (migration 0045 ausente no servidor).
  const mesaIndisponivel = useRef(false)
  const [criarSenha, setCriarSenha] = useState<MesaSenhaZerada[] | null>(null)
  // Organizador convidado que ainda não tem conta: cria a senha no primeiro acesso.
  const [primeiroAcesso, setPrimeiroAcesso] = useState<ConviteOrganizador[] | null>(null)
  const [novaSenha, setNovaSenha] = useState('')
  const [confirmaSenha, setConfirmaSenha] = useState('')
  const [ongoing, setOngoing] = useState<Championship[]>([])
  const [champions, setChampions] = useState<Record<string, ChampionInfo>>({})
  const [search, setSearch] = useState('')
  // Falha ao buscar a vitrine: mostra o motivo em vez de "nenhum campeonato".
  const [erroLista, setErroLista] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    listPublicChampionships()
      .then((list) => {
        if (!active) return
        setOngoing(list)
        void loadChampions(list.filter((c) => statusEfetivo(c) === 'finished')).then(
          (map) => active && setChampions(map),
        )
      })
      .catch((e) => {
        if (!active) return
        setOngoing([])
        const msg = e instanceof Error ? e.message : (e as { message?: string })?.message
        setErroLista(msg || 'erro desconhecido')
      })
    return () => {
      active = false
    }
  }, [])

  /**
   * Tenta entrar como GESTOR DE TIME. Devolve `true` quando resolveu a
   * tentativa (entrou, abriu a lista de times ou tem um erro para mostrar).
   */
  async function tentarComoTime(): Promise<boolean> {
    const { teams, error: erro } = await teamLoginByEmail(email, password)
    if (erro) {
      setError(erro)
      return true
    }
    if (teams.length === 0) return false
    if (teams.length === 1) {
      entrarNoTime(teams[0])
      return true
    }
    setMeusTimes(teams)
    return true
  }

  /** Tenta entrar como MESÁRIO. Devolve `true` quando entrou ou abriu a lista. */
  async function tentarComoMesario(senha = password): Promise<boolean> {
    const { mesas, indisponivel } = await mesaLoginByEmail(email, senha)
    mesaIndisponivel.current = !!indisponivel
    if (mesas.length === 0) return false
    if (mesas.length === 1) {
      entrarComoMesario(mesas[0], senha)
      return true
    }
    setMinhasMesas(mesas)
    return true
  }

  /** O e-mail é de mesário com a senha zerada? Abre a criação da nova senha. */
  async function tentarSenhaZerada(): Promise<boolean> {
    const contas = await mesaSenhaZerada(email)
    if (contas.length === 0) return false
    setCriarSenha(contas)
    return true
  }

  /** O e-mail é de organizador convidado sem conta? Abre a criação da senha. */
  async function tentarPrimeiroAcesso(): Promise<boolean> {
    const convites = await convitesSemConta(email)
    if (convites.length === 0) return false
    setPrimeiroAcesso(convites)
    return true
  }

  async function criarContaConvidado(e: React.FormEvent) {
    e.preventDefault()
    if (!primeiroAcesso) return
    setError(null)
    if (novaSenha.length < 6) {
      setError('A senha precisa ter ao menos 6 caracteres.')
      return
    }
    if (novaSenha !== confirmaSenha) {
      setError('As senhas não conferem.')
      return
    }
    setBusy(true)
    try {
      // O convite vale pelo e-mail: ao criar a conta com ele, o campeonato já
      // aparece no painel. O nome vem do convite (ou do começo do e-mail).
      const nome = primeiroAcesso.find((c) => c.name.trim())?.name.trim() || email.split('@')[0]
      const err = await signUp(nome, email, novaSenha)
      if (err) setError(err)
    } finally {
      setBusy(false)
    }
  }

  async function salvarNovaSenha(e: React.FormEvent) {
    e.preventDefault()
    if (!criarSenha) return
    setError(null)
    if (novaSenha !== confirmaSenha) {
      setError('As senhas não conferem.')
      return
    }
    setBusy(true)
    try {
      const res = await criarSenhaDoMesario(criarSenha, novaSenha)
      if (!res.ok) {
        setError(res.error ?? 'Não foi possível criar a senha.')
        return
      }
      // Já entra com a senha recém-criada.
      setCriarSenha(null)
      setPassword(novaSenha)
      setNovaSenha('')
      setConfirmaSenha('')
      if (!(await tentarComoMesario(novaSenha))) {
        setPassword('')
        setError('Senha criada! Entre novamente com a nova senha.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (tab === 'up') {
        const err = await signUp(name, email, password)
        if (err) setError(err)
        return
      }

      // Sem senha: só serve para quem está no primeiro acesso — organizador
      // convidado (cria a conta) ou mesário cuja senha foi zerada.
      if (!password.trim()) {
        if (await tentarPrimeiroAcesso()) return
        if (await tentarSenhaZerada()) return
        setError('Informe a senha. Se foi convidado como organizador ou mesário, entre só com o e-mail do convite.')
        return
      }

      // A mesma caixa de login serve para o organizador e para o gestor do
      // time. A ordem muda com o modo porque no demo o login de organizador
      // aceita qualquer e-mail (é conta de brinquedo) e engoliria o do time.
      if (mode === 'demo') {
        if (await tentarComoTime()) return
        if (await tentarComoMesario()) return
        if (await tentarSenhaZerada()) return
        if (await tentarPrimeiroAcesso()) return
        const err = await signIn(email, password)
        if (err) setError(err)
        return
      }

      const err = await signIn(email, password)
      if (!err) return
      // Organizador não é: pode ser gestor de time.
      if (await tentarComoTime()) return
      // Nem time: pode ser mesário.
      if (await tentarComoMesario()) return
      if (await tentarSenhaZerada()) return
      if (await tentarPrimeiroAcesso()) return
      setError(
        mesaIndisponivel.current
          ? `${err}. Se você é mesário: o acesso de mesário pela página inicial ainda não foi liberado neste servidor (migration 0045).`
          : err,
      )
    } finally {
      setBusy(false)
    }
  }

  const features = [
    { icon: '🏆', title: 'Crie campeonatos', text: 'Pontos corridos, grupos ou mata-mata em minutos.' },
    { icon: '📅', title: 'Tabela automática', text: 'Gere todas as rodadas com um clique.' },
    { icon: '📊', title: 'Classificação ao vivo', text: 'Pontos, saldo e desempates calculados sozinhos.' },
    { icon: '⚽', title: 'Artilharia & cartões', text: 'Registre gols e cartões por jogador.' },
  ]

  // Dois blocos, cada um com os mais recentes. Buscando, o teto cai — quem
  // digitou um nome quer achar aquele campeonato.
  const { ativos, encerrados, maisAtivos, maisEncerrados } = vitrine(ongoing, search)
  const nada = ativos.length === 0 && encerrados.length === 0

  return (
    <div className="landing-page">
    <div className="landing">
      <div className="landing__hero">
        <div className="landing__brand">
          <span className="logo-mark">⚽</span>
          <span className="logo-word">Tabela<b>ço</b></span>
        </div>
        <h1>
          Organize seu campeonato como um <span className="hl">profissional</span>.
        </h1>
        <p className="landing__lead">
          A plataforma completa para gerir campeonatos esportivos amadores: times,
          elencos, rodadas, resultados, classificação e estatísticas — tudo em um só lugar.
        </p>
        <ul className="landing__features">
          {features.map((f) => (
            <li key={f.title}>
              <span className="landing__ficon">{f.icon}</span>
              <div>
                <strong>{f.title}</strong>
                <span>{f.text}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="landing__links">
          <a className="landing__plans" href="#/como-usar">📖 Como usar →</a>
          <a className="landing__plans" href="#/planos">Ver planos e preços →</a>
          <a className="landing__plans" href="#/instalar">📲 Instalar o app</a>
          <SuporteLink className="landing__plans">Suporte</SuporteLink>
        </div>
      </div>

      <div className="landing__panel">
        {primeiroAcesso ? (
          <div className="auth-card">
            <h2 className="auth-card__title">Primeiro acesso</h2>
            <p className="muted">
              Você foi convidado para organizar{' '}
              <b>{primeiroAcesso.map((c) => c.championshipName).join(', ')}</b>. Crie uma senha para
              entrar com <b>{email.trim()}</b>.
            </p>
            <form onSubmit={criarContaConvidado} className="auth-form">
              <Field label="Nova senha">
                <input type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} minLength={6} autoComplete="new-password" required />
              </Field>
              <Field label="Confirmar nova senha">
                <input type="password" value={confirmaSenha} onChange={(e) => setConfirmaSenha(e.target.value)} minLength={6} autoComplete="new-password" required />
              </Field>
              {error && <p className="auth-error">{error}</p>}
              <Button type="submit" disabled={busy || !novaSenha || !confirmaSenha}>
                {busy ? 'Criando…' : 'Criar senha e entrar'}
              </Button>
            </form>
            <button className="link-btn" onClick={() => { setPrimeiroAcesso(null); setNovaSenha(''); setConfirmaSenha(''); setError(null); setPassword('') }}>
              ← Voltar
            </button>
          </div>
        ) : criarSenha ? (
          <div className="auth-card">
            <h2 className="auth-card__title">Criar nova senha</h2>
            <p className="muted">
              O organizador zerou a senha de <b>{email.trim()}</b>. Defina uma nova senha para entrar.
            </p>
            <form onSubmit={salvarNovaSenha} className="auth-form">
              <Field label="Nova senha">
                <input type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} minLength={4} autoComplete="new-password" required />
              </Field>
              <Field label="Confirmar nova senha">
                <input type="password" value={confirmaSenha} onChange={(e) => setConfirmaSenha(e.target.value)} minLength={4} autoComplete="new-password" required />
              </Field>
              {error && <p className="auth-error">{error}</p>}
              <Button type="submit" disabled={busy || !novaSenha || !confirmaSenha}>
                {busy ? 'Salvando…' : 'Criar senha e entrar'}
              </Button>
            </form>
            <button className="link-btn" onClick={() => { setCriarSenha(null); setNovaSenha(''); setConfirmaSenha(''); setError(null); setPassword('') }}>
              ← Voltar
            </button>
          </div>
        ) : minhasMesas ? (
          <div className="auth-card">
            <h2 className="auth-card__title">Seus campeonatos</h2>
            <p className="muted">
              Você é mesário em {minhasMesas.length} campeonatos. Escolha qual você quer abrir.
            </p>
            <ul className="team-pick">
              {minhasMesas.map((m) => (
                <li key={m.officialId}>
                  <button type="button" className="team-pick__item" onClick={() => entrarComoMesario(m, password)}>
                    <span className="team-pick__logo"><ChampLogo logo={m.championshipLogo} /></span>
                    <span className="team-pick__text">
                      <strong>{m.championshipName}</strong>
                      <span className="muted small">Mesário · {m.name}</span>
                    </span>
                    <span aria-hidden>→</span>
                  </button>
                </li>
              ))}
            </ul>
            <button className="link-btn" onClick={() => { setMinhasMesas(null); setPassword('') }}>
              ← Entrar com outra conta
            </button>
          </div>
        ) : meusTimes ? (
          <div className="auth-card">
            <h2 className="auth-card__title">Seus times</h2>
            <p className="muted">
              Este e-mail gerencia {meusTimes.length} times. Escolha qual você quer abrir.
            </p>
            <ul className="team-pick">
              {meusTimes.map((t) => (
                <li key={t.teamId}>
                  <button type="button" className="team-pick__item" onClick={() => entrarNoTime(t)}>
                    <TeamBadge team={{ name: t.teamName, logo: t.teamLogo, color: t.teamColor }} size={40} />
                    <span className="team-pick__text">
                      <strong>{t.teamName}</strong>
                      <span className="muted small">{t.championshipName}</span>
                    </span>
                    <span aria-hidden>→</span>
                  </button>
                </li>
              ))}
            </ul>
            <button className="link-btn" onClick={() => { setMeusTimes(null); setPassword('') }}>
              ← Entrar com outra conta
            </button>
          </div>
        ) : (
        <div className="auth-card">
          <div className="auth-tabs">
            <button className={tab === 'in' ? 'is-active' : ''} onClick={() => setTab('in')}>
              Entrar
            </button>
            <button className={tab === 'up' ? 'is-active' : ''} onClick={() => setTab('up')}>
              Criar conta
            </button>
          </div>

          <form onSubmit={submit} className="auth-form">
            {tab === 'up' && (
              <Field label="Nome do organizador">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Seu nome"
                  required
                />
              </Field>
            )}
            <Field label="E-mail">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@email.com"
                required
              />
            </Field>
            <Field label="Senha">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                // Senha de mesário pode ter 4 caracteres; o mínimo de 6 vale só para criar conta.
                // No login pode ficar em branco: é como o convidado faz o primeiro acesso.
                minLength={tab === 'up' ? 6 : undefined}
                required={tab === 'up'}
              />
            </Field>

            {error && <p className="auth-error">{error}</p>}

            <Button type="submit" disabled={busy}>
              {busy ? 'Aguarde…' : tab === 'in' ? 'Entrar' : 'Criar conta'}
            </Button>
          </form>

          <div className="auth-divider"><span>ou</span></div>

          <Button variant="soft" onClick={enterDemo} type="button">
            🚀 Entrar no modo demonstração
          </Button>

          <p className="auth-note auth-note--time">
            🤝 <b>Convidado como organizador?</b> Digite só o seu e-mail, deixe a senha em branco e
            clique em Entrar: você cria a senha no primeiro acesso.
          </p>
          <p className="auth-note auth-note--time">
            🛡️ <b>Dono de time?</b> Entre aqui com o mesmo e-mail e senha que você criou
            pelo link do organizador. A conta do time nasce sempre daquele link — depois
            dela criada, esta página é a porta de entrada.
          </p>
          <p className="auth-note auth-note--time">
            🧾 <b>Mesário?</b> Entre aqui com o e-mail e a senha que o organizador cadastrou —
            você verá somente as partidas atribuídas a você. Se o organizador zerou a sua senha, informe o e-mail, digite qualquer senha e clique em Entrar para criar uma nova.
          </p>

          <p className="auth-note">
            {mode === 'demo'
              ? 'Modo demo ativo: os dados ficam salvos apenas neste navegador.'
              : 'Conectado ao Supabase: seus campeonatos ficam salvos na nuvem.'}
          </p>
          <a className="auth-plans-link" href="#/como-usar">📖 Como usar o Tabelaço</a>
          <a className="auth-plans-link" href="#/planos">💳 Ver planos e preços</a>
          <a className="auth-plans-link" href="#/instalar">📲 Como instalar o app</a>
          <SuporteLink className="auth-plans-link">Falar com o suporte</SuporteLink>
        </div>
        )}
      </div>
    </div>

    <section className="pub-band">
      <div className="container">
        <div className="pub-band__head">
          <div>
            <h2>📣 Campeonatos em andamento e campeões recentes</h2>
            <p className="muted">
              Acompanhe a classificação e as estatísticas — acesso público, sem login. Os
              campeonatos encerrados ficam aqui, com o campeão em destaque, por{' '}
              {PUBLIC_FINISHED_DAYS} dias. Procurando um que não está na lista? Use a busca.
            </p>
          </div>
          {ongoing.length > 0 && (
            <div className="pub-search">
              <span className="pub-search__icon">🔎</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar campeonato pelo nome…"
                aria-label="Buscar campeonato"
              />
              {search && (
                <button className="pub-search__clear" onClick={() => setSearch('')} aria-label="Limpar busca">✕</button>
              )}
            </div>
          )}
        </div>
        {nada ? (
          <p className="muted">
            {erroLista
              ? `Não foi possível carregar os campeonatos: ${erroLista}`
              : search
                ? `Nenhum campeonato encontrado para “${search}”.`
                : 'Nenhum campeonato em andamento no momento.'}
          </p>
        ) : (
          <>
            <Vitrine
              titulo="⚽ Em andamento"
              vazio="Nenhum campeonato em andamento no momento."
              itens={ativos}
              sobrando={maisAtivos}
              champions={champions}
            />
            <Vitrine
              titulo="🏆 Campeões recentes"
              vazio={`Nenhum campeonato encerrado nos últimos ${PUBLIC_FINISHED_DAYS} dias.`}
              itens={encerrados}
              sobrando={maisEncerrados}
              champions={champions}
            />
          </>
        )}
      </div>
    </section>
    </div>
  )
}
