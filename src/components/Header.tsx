import { useAuth } from '../context/AuthContext'
import { SuporteLink } from './ui'

export function Header({ onHome }: { onHome: () => void }) {
  const { organizer, signOut, mode, isMaster } = useAuth()
  return (
    <header className="topbar">
      <button className="topbar__brand" onClick={onHome} aria-label="Início">
        <span className="logo-mark">⚽</span>
        <span className="logo-word">Tabela<b>ço</b></span>
      </button>
      <div className="topbar__right">
        <a className="topbar__ajuda" href="/como-usar">Como usar</a>
        <SuporteLink className="topbar__suporte">Suporte</SuporteLink>
        {mode === 'demo' && <span className="mode-tag" title="Dados salvos apenas neste navegador">modo demo</span>}
        {isMaster && <span className="master-tag" title="Administrador master: administra e exclui qualquer campeonato">👑 master</span>}
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
