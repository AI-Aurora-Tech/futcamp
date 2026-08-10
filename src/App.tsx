import { useEffect, useState } from 'react'
import { useAuth } from './context/AuthContext'
import { Header } from './components/Header'
import { Landing } from './components/Landing'
import { Dashboard } from './components/Dashboard'
import { ManageChampionship } from './components/ManageChampionship'
import { PublicChampionship } from './components/PublicChampionship'
import { TeamRegistration } from './components/TeamRegistration'
import { Spinner } from './components/ui'

/** Extrai o ID de campeonato público de um hash `#/c/<id>`, se houver. */
function readPublicId(): string | null {
  const m = window.location.hash.match(/^#\/c\/([^?]+)$/)
  return m ? decodeURIComponent(m[1]) : null
}

/** Extrai `#/t/<teamId>?k=<token>` (link de inscrição de time), se houver. */
function readTeamRoute(): { teamId: string; token: string } | null {
  const m = window.location.hash.match(/^#\/t\/([^?]+)(?:\?(.*))?$/)
  if (!m) return null
  const params = new URLSearchParams(m[2] ?? '')
  return { teamId: decodeURIComponent(m[1]), token: params.get('k') ?? '' }
}

export default function App() {
  const { organizer, loading } = useAuth()
  const [publicId, setPublicId] = useState<string | null>(readPublicId())
  const [teamRoute, setTeamRoute] = useState(readTeamRoute())
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    const onHash = () => {
      setPublicId(readPublicId())
      setTeamRoute(readTeamRoute())
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  function goHome() {
    if (window.location.hash) {
      window.location.hash = ''
    }
    setPublicId(null)
    setTeamRoute(null)
    setSelected(null)
  }

  // Link de inscrição do time (não exige login).
  if (teamRoute) {
    return <TeamRegistration teamId={teamRoute.teamId} token={teamRoute.token} onHome={goHome} />
  }

  // Página pública tem prioridade e não exige login.
  if (publicId) {
    return <PublicChampionship championshipId={publicId} onHome={goHome} />
  }

  if (loading) {
    return <div className="app-loading"><Spinner label="Carregando FutCamp…" /></div>
  }

  if (!organizer) {
    return <Landing />
  }

  return (
    <div className="app">
      <Header onHome={goHome} />
      <main>
        {selected ? (
          <ManageChampionship championshipId={selected} onBack={() => setSelected(null)} />
        ) : (
          <Dashboard onOpen={(id) => setSelected(id)} />
        )}
      </main>
    </div>
  )
}
