import { CONTACT_EMAIL } from '../lib/checkout'
import { PLANS, formatBRL, type PlanInfo } from '../lib/pricing'
import { rememberPlan } from '../lib/planChoice'
import { ChampLogo } from './ui'

const Check = () => (
  <svg className="plan-feats__ic" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
    <path d="M4 10.5l3.5 3.5L16 5.5" />
  </svg>
)

/**
 * Botão do plano. Escolher um plano leva para a criação do campeonato — é lá
 * que o valor final é fechado (plano + categorias) e o pagamento é gerado.
 */
function PlanCta({ plan, onChoose }: { plan: PlanInfo; onChoose: (p: PlanInfo) => void }) {
  const cls = `btn ${plan.featured ? 'btn--primary' : 'btn--ghost'} plan-btn`

  if (plan.consult) {
    return CONTACT_EMAIL ? (
      <a className={cls} href={`mailto:${CONTACT_EMAIL}?subject=Plano Diamante — Tabelaço`}>
        {plan.cta}
      </a>
    ) : (
      <button type="button" className={cls} onClick={() => onChoose(plan)}>
        {plan.cta}
      </button>
    )
  }
  return (
    <button type="button" className={cls} onClick={() => onChoose(plan)}>
      {plan.cta}
    </button>
  )
}

export function Plans({ onHome }: { onHome: () => void }) {
  // Guarda a escolha e volta para o app: quem estiver logado cai direto no
  // formulário de criação com o plano marcado; quem não estiver, entra antes.
  function choose(plan: PlanInfo) {
    rememberPlan(plan.key)
    onHome()
  }

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
            Cada <b>categoria é um campeonato à parte</b>. Escolha o plano pela quantidade de equipes,
            monte o campeonato e pague só o que usar — sem mensalidade surpresa.
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
                {!p.consult && <span className="plan-price__cur">R$</span>}
                <span className={`plan-price__val ${p.consult ? 'plan-price__val--consult' : ''}`}>
                  {p.consult
                    ? 'Preço a consultar'
                    : formatBRL(p.priceCents).replace('R$', '').trim()}
                </span>
              </div>
              <div className="plan-price__unit">{p.unit}</div>
              <div className="plan-addon">{p.addon}</div>
              <ul className="plan-feats">
                {p.feats.map((f) => (
                  <li key={f}><Check /> {f}</li>
                ))}
              </ul>
              <div className="plan-cta">
                <PlanCta plan={p} onChoose={choose} />
              </div>
            </article>
          ))}
        </section>

        <section className="plans-how">
          <h2 className="section-title">Como funciona a cobrança</h2>
          <div className="plans-how__grid">
            <div className="plan-note">
              <h3>1. Escolha o plano</h3>
              <p>O plano define quantas equipes cabem em cada categoria. O valor já inclui a primeira categoria.</p>
            </div>
            <div className="plan-note">
              <h3>2. Monte o campeonato</h3>
              <p>Ao criar, o sistema soma o plano com as categorias adicionais — <b>Bronze R$ 39,90</b> · <b>Prata R$ 49,90</b> · <b>Ouro R$ 59,90</b> cada — e mostra o total antes de cobrar.</p>
            </div>
            <div className="plan-note">
              <h3>3. Pague e comece</h3>
              <p>O pagamento é feito pelo Asaas (Pix, cartão ou boleto). Confirmado o pagamento, o campeonato é liberado automaticamente para você administrar.</p>
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
