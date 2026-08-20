import { CONTACT_EMAIL, checkoutUrl } from '../lib/checkout'
import { ChampLogo } from './ui'

/** Um plano da página de preços. */
interface Plan {
  key: string
  tier: string
  gem: string
  tint: string
  cap: string
  price: string
  cur?: string
  consult?: boolean
  unit: string
  addon: string
  feats: string[]
  cta: string
  featured?: boolean
  badge?: string
}

const PLANS: Plan[] = [
  {
    key: 'gratis',
    tier: 'Grátis',
    gem: '●',
    tint: '#16a34a',
    cap: 'Para experimentar e organizar uma copa pequena.',
    price: '0',
    cur: 'R$',
    unit: 'para sempre · 1 campeonato',
    addon: 'Com a marca Tabelaço na página pública',
    feats: ['Apenas 1 campeonato com 1 categoria', 'Até 8 equipes', 'Todas as funcionalidades'],
    cta: 'Começar grátis',
  },
  {
    key: 'bronze',
    tier: 'Bronze',
    gem: '●',
    tint: '#c0803f',
    cap: 'Para copas menores, com poucas equipes por categoria.',
    price: '59,90',
    cur: 'R$',
    unit: 'por campeonato · 1 categoria',
    addon: '+ R$ 39,90 por categoria adicional',
    feats: ['Até 16 equipes por categoria', 'Todas as funcionalidades', 'Com a marca Tabelaço na página pública'],
    cta: 'Escolher Bronze',
  },
  {
    key: 'prata',
    tier: 'Prata',
    gem: '●',
    tint: '#8f9bad',
    cap: 'Para campeonatos de porte médio, com mais times.',
    price: '79,90',
    cur: 'R$',
    unit: 'por campeonato · 1 categoria',
    addon: '+ R$ 49,90 por categoria adicional',
    feats: ['Até 32 equipes por categoria', 'Todas as funcionalidades'],
    cta: 'Escolher Prata',
  },
  {
    key: 'ouro',
    tier: 'Ouro',
    gem: '●',
    tint: '#d1a01e',
    cap: 'Para ligas e copas grandes, sem se preocupar com limite.',
    price: '109,90',
    cur: 'R$',
    unit: 'por campeonato · 1 categoria',
    addon: '+ R$ 59,90 por categoria adicional',
    feats: ['Equipes ilimitadas por categoria', 'Todas as funcionalidades'],
    cta: 'Escolher Ouro',
    featured: true,
    badge: 'Mais popular',
  },
  {
    key: 'diamante',
    tier: 'Diamante',
    gem: '◆',
    tint: '#35a9c4',
    cap: 'Para organizações que rodam vários campeonatos o ano todo.',
    price: 'Preço a consultar',
    consult: true,
    unit: 'plano anual',
    addon: 'Categorias ilimitadas — sem cobrança por adicional',
    feats: ['Equipes ilimitadas', 'Categorias ilimitadas', 'Todas as funcionalidades'],
    cta: 'Falar com a gente',
    badge: 'Anual',
  },
]

const Check = () => (
  <svg className="plan-feats__ic" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
    <path d="M4 10.5l3.5 3.5L16 5.5" />
  </svg>
)

/**
 * Botão do plano: leva ao checkout do Mercado Pago nos planos pagos, ao
 * cadastro no plano grátis e ao e-mail de contato no Diamante (sob consulta).
 */
function PlanCta({ plan, onHome }: { plan: Plan; onHome: () => void }) {
  const cls = `btn ${plan.featured ? 'btn--primary' : 'btn--ghost'} plan-btn`
  const url = checkoutUrl(plan.key)

  if (url) {
    return (
      <a className={cls} href={url} target="_blank" rel="noopener noreferrer">
        {plan.cta}
      </a>
    )
  }
  if (plan.consult && CONTACT_EMAIL) {
    return (
      <a className={cls} href={`mailto:${CONTACT_EMAIL}?subject=Plano Diamante — Tabelaço`}>
        {plan.cta}
      </a>
    )
  }
  return (
    <button type="button" className={cls} onClick={onHome}>
      {plan.cta}
    </button>
  )
}

export function Plans({ onHome }: { onHome: () => void }) {
  return (
    <div className="reg plans-page">
      <header className="reg__hero">
        <div className="container">
          <button className="back-link" onClick={onHome}>← Tabelaço</button>
          <div className="reg__champ">
            <span className="reg__champ-logo"><ChampLogo logo="🏆" /></span>
            <div>
              <p className="reg__eyebrow">Cobrança por campeonato</p>
              <h1>Planos e preços</h1>
            </div>
          </div>
          <p className="plans-lede">
            Cada <b>categoria é um campeonato à parte</b>. Você escolhe o plano pela quantidade de equipes
            e paga por campeonato — sem mensalidade surpresa.
          </p>
        </div>
      </header>

      <div className="container plans-content">
        <section className="plan-grid" aria-label="Planos">
          {PLANS.map((p) => (
            <article
              key={p.key}
              className={`plan-card ${p.featured ? 'plan-card--featured' : ''}`}
              style={{ '--tier': p.tint } as React.CSSProperties}
            >
              {p.badge && <span className="plan-card__badge">{p.badge}</span>}
              <div className="plan-card__tier"><span className="plan-card__gem">{p.gem}</span> {p.tier}</div>
              <p className="plan-card__cap">{p.cap}</p>
              <div className="plan-price">
                {p.cur && <span className="plan-price__cur">{p.cur}</span>}
                <span className={`plan-price__val ${p.consult ? 'plan-price__val--consult' : ''}`}>{p.price}</span>
              </div>
              <div className="plan-price__unit">{p.unit}</div>
              <div className="plan-addon">{p.addon}</div>
              <ul className="plan-feats">
                {p.feats.map((f) => (
                  <li key={f}><Check /> {f}</li>
                ))}
              </ul>
              <div className="plan-cta">
                <PlanCta plan={p} onHome={onHome} />
              </div>
            </article>
          ))}
        </section>

        <section className="plans-how">
          <h2 className="section-title">Como funciona a cobrança</h2>
          <div className="plans-how__grid">
            <div className="plan-note">
              <h3>Categoria = campeonato</h3>
              <p>Cada categoria (Sub-15, Adulto, Veterano…) roda como um campeonato independente, com tabela e classificação próprias.</p>
            </div>
            <div className="plan-note">
              <h3>O plano cobre 1 categoria</h3>
              <p>O valor já inclui o primeiro campeonato. O plano define o limite de equipes de cada categoria.</p>
            </div>
            <div className="plan-note">
              <h3>Categorias a mais</h3>
              <p>A partir da 2ª categoria, o valor adicional varia por plano: <b>Bronze R$ 39,90</b> · <b>Prata R$ 49,90</b> · <b>Ouro R$ 59,90</b>. No Diamante, são ilimitadas.</p>
            </div>
          </div>
        </section>
      </div>

      <footer className="public__footer">
        <span className="logo-word">Tabela<b>ço</b></span> · Preços por campeonato · Diamante é anual, sob consulta
      </footer>
    </div>
  )
}
