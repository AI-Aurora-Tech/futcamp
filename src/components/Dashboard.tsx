import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  createChampionship,
  listChampionships,
  type NewChampionship,
} from '../services/championships'
import { FORMAT_LABELS, SPORT_LABELS, type Championship } from '../types'
import { Button, ChampLogo, EmptyState, Spinner, StatusPill } from './ui'
import { ChampionshipForm } from './ChampionshipForm'

export function Dashboard({ onOpen }: { onOpen: (id: string) => void }) {
  const { organizer } = useAuth()
  const [items, setItems] = useState<Championship[] | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!organizer) return
    let active = true
    listChampionships(organizer.id)
      .then((list) => active && setItems(list))
      .catch(() => active && setItems([]))
    return () => {
      active = false
    }
  }, [organizer])

  async function handleCreate(data: NewChampionship) {
    if (!organizer) return
    const champ = await createChampionship(organizer.id, data)
    setCreating(false)
    onOpen(champ.id)
  }

  return (
    <div className="container dashboard">
      <div className="dashboard__head">
        <div>
          <h1>Meus campeonatos</h1>
          <p className="muted">Gerencie suas competições e acompanhe os resultados.</p>
        </div>
        <Button onClick={() => setCreating(true)}>＋ Novo campeonato</Button>
      </div>

      {items === null ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState icon="🏆" title="Você ainda não tem campeonatos">
          <p>Crie o primeiro para começar a montar times, rodadas e a tabela.</p>
          <Button onClick={() => setCreating(true)}>Criar meu primeiro campeonato</Button>
        </EmptyState>
      ) : (
        <div className="champ-grid">
          {items.map((c) => (
            <button key={c.id} className="champ-card" onClick={() => onOpen(c.id)} style={{ '--accent': c.primaryColor ?? '#16a34a' } as React.CSSProperties}>
              <div className="champ-card__logo"><ChampLogo logo={c.logo} /></div>
              <div className="champ-card__body">
                <div className="champ-card__top">
                  <h3>{c.name}</h3>
                  <StatusPill status={c.status} />
                </div>
                <p className="champ-card__meta">
                  {SPORT_LABELS[c.sport]} · {FORMAT_LABELS[c.format]}
                  {c.season ? ` · ${c.season}` : ''}
                </p>
                {c.description && <p className="champ-card__desc">{c.description}</p>}
              </div>
            </button>
          ))}
        </div>
      )}

      {creating && <ChampionshipForm onClose={() => setCreating(false)} onSave={handleCreate} />}
    </div>
  )
}
