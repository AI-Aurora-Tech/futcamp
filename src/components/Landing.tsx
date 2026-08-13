import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { listPublicChampionships } from '../services/championships'
import { FORMAT_LABELS, SPORT_LABELS, type Championship } from '../types'
import { Button, ChampLogo, Field } from './ui'

function openPublic(id: string) {
  window.location.hash = `#/c/${id}`
}

export function Landing() {
  const { signIn, signUp, enterDemo, mode } = useAuth()
  const [tab, setTab] = useState<'in' | 'up'>('in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [ongoing, setOngoing] = useState<Championship[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    let active = true
    listPublicChampionships()
      .then((list) => active && setOngoing(list))
      .catch(() => active && setOngoing([]))
    return () => {
      active = false
    }
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const err =
      tab === 'in' ? await signIn(email, password) : await signUp(name, email, password)
    if (err) setError(err)
    setBusy(false)
  }

  const features = [
    { icon: '🏆', title: 'Crie campeonatos', text: 'Pontos corridos, grupos ou mata-mata em minutos.' },
    { icon: '📅', title: 'Tabela automática', text: 'Gere todas as rodadas com um clique.' },
    { icon: '📊', title: 'Classificação ao vivo', text: 'Pontos, saldo e desempates calculados sozinhos.' },
    { icon: '⚽', title: 'Artilharia & cartões', text: 'Registre gols e cartões por jogador.' },
  ]

  const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const q = normalize(search.trim())
  const filtered = q
    ? ongoing.filter(
        (c) => normalize(c.name).includes(q) || normalize(c.season ?? '').includes(q),
      )
    : ongoing

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
          <a className="landing__plans" href="#/planos">Ver planos e preços →</a>
          <a className="landing__plans" href="#/instalar">📲 Instalar o app</a>
        </div>
      </div>

      <div className="landing__panel">
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
                minLength={6}
                required
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

          <p className="auth-note">
            {mode === 'demo'
              ? 'Modo demo ativo: os dados ficam salvos apenas neste navegador.'
              : 'Conectado ao Supabase: seus campeonatos ficam salvos na nuvem.'}
          </p>
          <a className="auth-plans-link" href="#/planos">💳 Ver planos e preços</a>
          <a className="auth-plans-link" href="#/instalar">📲 Como instalar o app</a>
        </div>
      </div>
    </div>

    <section className="pub-band">
      <div className="container">
        <div className="pub-band__head">
          <div>
            <h2>📣 Campeonatos em andamento</h2>
            <p className="muted">Acompanhe a classificação e as estatísticas — acesso público, sem login.</p>
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
        {ongoing.length === 0 ? (
          <p className="muted">Nenhum campeonato em andamento no momento.</p>
        ) : filtered.length === 0 ? (
          <p className="muted">Nenhum campeonato encontrado para “{search}”.</p>
        ) : (
          <div className="champ-grid">
            {filtered.map((c) => (
              <button
                key={c.id}
                className="champ-card"
                onClick={() => openPublic(c.id)}
                style={{ '--accent': c.primaryColor ?? '#16a34a' } as React.CSSProperties}
              >
                <div className="champ-card__logo"><ChampLogo logo={c.logo} /></div>
                <div className="champ-card__body">
                  <div className="champ-card__top">
                    <h3>{c.name}</h3>
                    <span className="pill pill--active">ao vivo</span>
                  </div>
                  <p className="champ-card__meta">
                    {SPORT_LABELS[c.sport]} · {FORMAT_LABELS[c.format]}{c.season ? ` · ${c.season}` : ''}
                  </p>
                  <p className="champ-card__desc">Ver classificação e estatísticas →</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
    </div>
  )
}
