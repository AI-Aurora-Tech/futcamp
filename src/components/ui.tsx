import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useEffect } from 'react'
import type { Team } from '../types'

/** Escudo do time: usa emoji/data URL em `logo` ou as iniciais como fallback. */
export function TeamBadge({
  team,
  size = 28,
}: {
  team?: Pick<Team, 'name' | 'shortName' | 'logo' | 'color'> | null
  size?: number
}) {
  const style = {
    width: size,
    height: size,
    fontSize: size * 0.55,
    background: team?.color ? `${team.color}22` : 'var(--surface-2)',
    borderColor: team?.color ?? 'var(--line)',
  }
  const logo = team?.logo
  const isImage = logo?.startsWith('data:') || logo?.startsWith('http')
  const initials = (team?.shortName || team?.name || '?').slice(0, 3).toUpperCase()
  return (
    <span className="badge-circle" style={style} aria-hidden>
      {isImage ? (
        <img src={logo} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
      ) : logo ? (
        logo
      ) : (
        <span style={{ fontSize: size * 0.34, fontWeight: 800 }}>{initials}</span>
      )}
    </span>
  )
}

export function Button({
  variant = 'primary',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'soft' | 'danger'
}) {
  return (
    <button className={`btn btn--${variant}`} {...props}>
      {children}
    </button>
  )
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal ${wide ? 'modal--wide' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal__head">
          <h3>{title}</h3>
          <button className="modal__close" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  )
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  )
}

export function EmptyState({
  icon = '📋',
  title,
  children,
}: {
  icon?: string
  title: string
  children?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon}</div>
      <p className="empty__title">{title}</p>
      {children && <div className="empty__body">{children}</div>}
    </div>
  )
}

export function Spinner({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="spinner">
      <div className="spinner__dot" />
      <span>{label}</span>
    </div>
  )
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: 'Rascunho', cls: 'pill--draft' },
    active: { label: 'Em andamento', cls: 'pill--active' },
    finished: { label: 'Encerrado', cls: 'pill--finished' },
  }
  const info = map[status] ?? { label: status, cls: '' }
  return <span className={`pill ${info.cls}`}>{info.label}</span>
}
