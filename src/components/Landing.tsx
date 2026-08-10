import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Button, Field } from './ui'

export function Landing() {
  const { signIn, signUp, enterDemo, mode } = useAuth()
  const [tab, setTab] = useState<'in' | 'up'>('in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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

  return (
    <div className="landing">
      <div className="landing__hero">
        <div className="landing__brand">
          <span className="logo-mark">⚽</span>
          <span className="logo-word">Fut<b>Camp</b></span>
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
        </div>
      </div>
    </div>
  )
}
