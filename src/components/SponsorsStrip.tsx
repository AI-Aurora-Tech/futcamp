import type { Sponsor } from '../types'

/** Faixa de patrocinadores e parceiros exibida na página pública. */
export function SponsorsStrip({ sponsors }: { sponsors: Sponsor[] }) {
  if (!sponsors.length) return null
  const isImage = (l?: string) => l?.startsWith('data:') || l?.startsWith('http')
  const patrocinadores = sponsors.filter((s) => s.tier === 'patrocinador')
  const parceiros = sponsors.filter((s) => s.tier === 'parceiro')

  const item = (s: Sponsor) => {
    const inner = (
      <>
        <span className="sponsor-logo sponsor-logo--lg">
          {isImage(s.logo) ? <img src={s.logo} alt={s.name} /> : <span>{s.logo || '🏷️'}</span>}
        </span>
        <span className="sponsor-strip__name">{s.name}</span>
      </>
    )
    return s.url ? (
      <a key={s.id} className="sponsor-strip__item" href={s.url} target="_blank" rel="noopener noreferrer">
        {inner}
      </a>
    ) : (
      <span key={s.id} className="sponsor-strip__item">{inner}</span>
    )
  }

  return (
    <section className="sponsor-strip">
      <div className="container">
        {patrocinadores.length > 0 && (
          <div className="sponsor-strip__group">
            <h4>Patrocinadores</h4>
            <div className="sponsor-strip__row">{patrocinadores.map(item)}</div>
          </div>
        )}
        {parceiros.length > 0 && (
          <div className="sponsor-strip__group">
            <h4>Parceiros</h4>
            <div className="sponsor-strip__row">{parceiros.map(item)}</div>
          </div>
        )}
      </div>
    </section>
  )
}
