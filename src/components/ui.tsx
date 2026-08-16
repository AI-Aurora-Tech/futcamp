import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useEffect, useState } from 'react'
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

/** Brasão do campeonato: renderiza imagem (data/URL) ou emoji. */
export function ChampLogo({ logo, fallback = '🏆' }: { logo?: string; fallback?: string }) {
  const isImage = logo?.startsWith('data:') || logo?.startsWith('http')
  if (isImage) return <img className="champ-logo-img" src={logo} alt="" />
  return <>{logo || fallback}</>
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

/**
 * Campo de busca com botão de limpar e contador de resultados.
 * Usado para localizar times nas abas Times e Elencos.
 */
export function SearchField({
  value,
  onChange,
  placeholder = 'Buscar…',
  count,
  total,
  noun = 'item',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** Quantidade encontrada (mostra o contador quando há busca ativa). */
  count?: number
  total?: number
  noun?: string
}) {
  const searching = value.trim().length > 0
  return (
    <div className="search-field">
      <span className="search-field__icon" aria-hidden>🔎</span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {searching && (
        <button type="button" className="search-field__clear" onClick={() => onChange('')} title="Limpar busca">
          ✕
        </button>
      )}
      {searching && count != null && (
        <span className="search-field__count">
          {count} de {total} {noun}{(total ?? 0) === 1 ? '' : 's'}
        </span>
      )}
    </div>
  )
}

/**
 * Liga/desliga as notificações push deste navegador. O componente cuida da
 * permissão e do estado; quem usa só informa o que ligar.
 */
export function PushToggle({
  title,
  hint,
  enable,
  disable,
  available,
}: {
  title: string
  hint: string
  enable: () => Promise<{ ok: boolean; error?: string }>
  disable: () => Promise<{ ok: boolean; error?: string }>
  /** Recurso disponível (backend + navegador). */
  available: boolean
}) {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      if (!available || !('serviceWorker' in navigator)) return
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (active) setOn(!!sub && Notification.permission === 'granted')
      } catch {
        /* ignore */
      }
    })()
    return () => {
      active = false
    }
  }, [available])

  async function toggle() {
    setBusy(true)
    setMsg(null)
    const res = on ? await disable() : await enable()
    setBusy(false)
    if (!res.ok) {
      setMsg(res.error ?? 'Não foi possível alterar as notificações.')
      return
    }
    setOn(!on)
    setMsg(on ? 'Notificações desligadas.' : 'Notificações ligadas neste dispositivo ✅')
  }

  return (
    <div className={`push-toggle ${on ? 'is-on' : ''}`}>
      <div className="push-toggle__info">
        <strong>{on ? '🔔' : '🔕'} {title}</strong>
        <span className="muted small">{hint}</span>
        {!available && (
          <span className="muted small">
            Disponível quando o app estiver conectado ao Supabase, em um navegador com suporte a push.
          </span>
        )}
        {msg && <span className="push-toggle__msg">{msg}</span>}
      </div>
      <Button variant={on ? 'ghost' : 'soft'} type="button" onClick={() => void toggle()} disabled={busy || !available}>
        {busy ? 'Aguarde…' : on ? 'Desligar' : 'Ligar avisos'}
      </Button>
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
    // Status de partida (portal do mesário, calendário).
    scheduled: { label: 'Agendada', cls: 'pill--draft' },
    live: { label: '● Ao vivo', cls: 'pill--live' },
  }
  const info = map[status] ?? { label: status, cls: '' }
  return <span className={`pill ${info.cls}`}>{info.label}</span>
}
