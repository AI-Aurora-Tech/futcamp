import { useEffect, useState } from 'react'
import { useAuth } from './context/AuthContext'
import { Header } from './components/Header'
import { Landing } from './components/Landing'
import { Dashboard } from './components/Dashboard'
import { ManageChampionship } from './components/ManageChampionship'
import { PublicChampionship } from './components/PublicChampionship'
import { TeamRegistration } from './components/TeamRegistration'
import { CreateTeamViaLink } from './components/CreateTeamViaLink'
import { MesaPortal } from './components/MesaPortal'
import { Plans } from './components/Plans'
import { PaymentReturn } from './components/PaymentReturn'
import { InstallGuide } from './components/InstallGuide'
import { ComoUsar } from './components/ComoUsar'
import { Spinner } from './components/ui'
import { currentRoute, navigate, onRouteChange } from './lib/router'
import { applySeo } from './lib/seo'
import { metaDaRota } from './lib/seoRotas'

export default function App() {
  const { organizer, loading } = useAuth()
  const [route, setRoute] = useState(currentRoute)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => onRouteChange(() => setRoute(currentRoute())), [])

  // Título, descrição, canonical e dados estruturados da rota atual. A página
  // pública do campeonato refina isso com o nome real assim que os dados
  // chegam (ver `PublicChampionship`).
  useEffect(() => {
    applySeo(metaDaRota(route))
  }, [route])

  function goHome() {
    navigate('/')
    setSelected(null)
  }

  // Página pública de planos (não exige login).
  if (route.kind === 'planos') {
    return <Plans onHome={goHome} />
  }

  // Página pública de instalação (não exige login).
  if (route.kind === 'instalar') {
    return <InstallGuide onHome={goHome} />
  }

  // Guia de uso (não exige login: o organizador manda o link para os times
  // e para os mesários, e cada um lê a parte dele sem precisar de conta).
  if (route.kind === 'como-usar') {
    return <ComoUsar onHome={goHome} />
  }

  // Portal do mesário (login próprio).
  if (route.kind === 'mesa') {
    return <MesaPortal championshipId={route.championshipId} onHome={goHome} />
  }

  // Link de criação de time pelo responsável (não exige login).
  if (route.kind === 'novo-time') {
    return <CreateTeamViaLink championshipId={route.championshipId} token={route.token} onHome={goHome} />
  }

  // Link de inscrição do time (não exige login).
  if (route.kind === 'time') {
    return <TeamRegistration teamId={route.teamId} token={route.token} onHome={goHome} />
  }

  // Página pública tem prioridade e não exige login.
  if (route.kind === 'campeonato') {
    return <PublicChampionship championshipId={route.id} onHome={goHome} />
  }

  if (loading) {
    return <div className="app-loading"><Spinner label="Carregando Tabelaço…" /></div>
  }

  if (!organizer) {
    return <Landing />
  }

  return (
    <div className="app">
      <Header onHome={goHome} />
      <main>
        {route.kind === 'pagamento' ? (
          <PaymentReturn
            championshipId={route.championshipId}
            status={route.status}
            onOpen={(id) => {
              goHome()
              setSelected(id)
            }}
            onHome={goHome}
          />
        ) : selected ? (
          <ManageChampionship championshipId={selected} onBack={() => setSelected(null)} />
        ) : (
          <Dashboard onOpen={(id) => setSelected(id)} />
        )}
      </main>
    </div>
  )
}
