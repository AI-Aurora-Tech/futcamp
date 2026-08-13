import { ChampLogo } from './ui'

/** Passo a passo de instalação por sistema. */
interface Guide {
  os: string
  icon: string
  browser: string
  steps: (string | { b: string })[]
  note: string
}

const GUIDES: Guide[] = [
  {
    os: 'Android',
    icon: '🤖',
    browser: 'Google Chrome',
    steps: [
      'Abra o Tabelaço no navegador Google Chrome.',
      'Toque no menu ⋮ (três pontinhos), no canto superior direito.',
      'Toque em “Instalar aplicativo” (ou “Adicionar à tela inicial”).',
      'Confirme tocando em Instalar.',
      'Pronto! O ícone do Tabelaço aparece na tela inicial.',
    ],
    note: 'Dica: às vezes o Chrome mostra sozinho um aviso “Instalar app” na parte de baixo — basta tocar nele.',
  },
  {
    os: 'iPhone e iPad',
    icon: '🍎',
    browser: 'Safari',
    steps: [
      'Abra o Tabelaço no navegador Safari.',
      'Toque no ícone Compartilhar (um quadrado com uma seta para cima).',
      'Deslize a lista e toque em “Adicionar à Tela de Início”.',
      'Toque em “Adicionar”, no canto superior direito.',
      'Pronto! O ícone aparece na tela de início.',
    ],
    note: 'No iPhone/iPad é preciso usar o Safari — o Chrome do iOS não oferece essa opção.',
  },
]

export function InstallGuide({ onHome }: { onHome: () => void }) {
  return (
    <div className="reg install-page">
      <header className="reg__hero">
        <div className="container">
          <button className="back-link" onClick={onHome}>← Tabelaço</button>
          <div className="reg__champ">
            <span className="reg__champ-logo"><ChampLogo logo="📲" /></span>
            <div>
              <p className="reg__eyebrow">Instalação</p>
              <h1>Como instalar o app</h1>
            </div>
          </div>
          <p className="plans-lede">
            O Tabelaço é um <b>aplicativo web</b>: você instala direto pelo navegador, sem baixar
            de nenhuma loja. Depois de instalado, ele abre em tela cheia, como um app comum.
          </p>
        </div>
      </header>

      <div className="container plans-content">
        <section className="install-grid">
          {GUIDES.map((g) => (
            <article key={g.os} className="install-card">
              <div className="install-card__head">
                <span className="install-card__icon" aria-hidden>{g.icon}</span>
                <div>
                  <h2>{g.os}</h2>
                  <p className="muted small">pelo {g.browser}</p>
                </div>
              </div>
              <ol className="install-steps">
                {g.steps.map((s, i) => (
                  <li key={i}>
                    <span className="install-steps__n">{i + 1}</span>
                    <span>{s as string}</span>
                  </li>
                ))}
              </ol>
              <p className="install-note">💡 {g.note}</p>
            </article>
          ))}
        </section>

        <section className="plans-how">
          <h2 className="section-title">Depois de instalar</h2>
          <div className="plans-how__grid">
            <div className="plan-note">
              <h3>Abre como app</h3>
              <p>O Tabelaço abre em tela cheia, sem a barra do navegador, com o ícone próprio na tela inicial.</p>
            </div>
            <div className="plan-note">
              <h3>Sempre atualizado</h3>
              <p>Como é um app web, você recebe as novidades automaticamente — sem precisar atualizar por nenhuma loja.</p>
            </div>
            <div className="plan-note">
              <h3>Ocupa pouco espaço</h3>
              <p>A instalação é leve: é um atalho inteligente para o app, sem download pesado no aparelho.</p>
            </div>
          </div>
        </section>
      </div>

      <footer className="public__footer">
        <span className="logo-word">Tabela<b>ço</b></span> · Instale pelo navegador — Android (Chrome) ou iPhone (Safari)
      </footer>
    </div>
  )
}
