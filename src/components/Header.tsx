import { useAuth } from '../context/AuthContext'

export function Header({ onHome }: { onHome: () => void }) {
  const { organizer, signOut, mode } = useAuth()
  return (
    <header className="topbar">
      <button className="topbar__brand" onClick={onHome} aria-label="Início">
        <span className="logo-mark">⚽</span>
        <span className="logo-word">Fut<b>Camp</b></span>
      </button>
      <div className="topbar__right">
        {mode === 'demo' && <span className="mode-tag" title="Dados salvos apenas neste navegador">modo demo</span>}
        {organizer && (
          <>
            <span className="topbar__user" title={organizer.email}>
              <span className="avatar">{organizer.name.charAt(0).toUpperCase()}</span>
              <span className="topbar__uname">{organizer.name}</span>
            </span>
            <button className="btn btn--ghost btn--sm" onClick={() => void signOut()}>
              Sair
            </button>
          </>
        )}
      </div>
    </header>
  )
}
