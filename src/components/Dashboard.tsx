import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  createChampionship,
  listAllChampionships,
  listChampionships,
  type NewChampionship,
} from '../services/championships'
import { FORMAT_LABELS, SPORT_LABELS, type Championship, type PlanKey } from '../types'
import { forgetPlan, pendingPlan } from '../lib/planChoice'
import { formatBRL, isLocked, planOf } from '../lib/pricing'
import { Button, ChampLogo, EmptyState, Modal, Spinner, StatusPill } from './ui'
import { ChampionshipForm } from './ChampionshipForm'
import { PaymentPanel } from './PaymentPanel'

export function Dashboard({ onOpen }: { onOpen: (id: string) => void }) {
  const { organizer, isMaster } = useAuth()
  const [items, setItems] = useState<Championship[] | null>(null)
  const [creating, setCreating] = useState(false)
  /** Plano marcado no formulário (vindo da página de planos). */
  const [plan, setPlan] = useState<PlanKey | undefined>(undefined)
  /** Campeonato recém-criado esperando pagamento. */
  const [paying, setPaying] = useState<Championship | null>(null)

  useEffect(() => {
    if (!organizer) return
    let active = true
    // O administrador master enxerga os campeonatos de todos os organizadores.
    const load = isMaster ? listAllChampionships() : listChampionships(organizer.id)
    load
      .then((list) => active && setItems(list))
      .catch(() => active && setItems([]))
    return () => {
      active = false
    }
  }, [organizer, isMaster])

  // Veio da página de planos: abre a criação já com o plano escolhido.
  useEffect(() => {
    const chosen = pendingPlan()
    if (!chosen) return
    forgetPlan()
    setPlan(chosen)
    setCreating(true)
  }, [])

  async function handleCreate(data: NewChampionship) {
    if (!organizer) return
    const champ = await createChampionship(organizer.id, data)
    setCreating(false)
    setPlan(undefined)
    setItems((prev) => (prev ? [champ, ...prev] : [champ]))
    // Pago: vai direto para o painel. Pendente: cobra antes de liberar.
    if (isLocked(champ)) setPaying(champ)
    else onOpen(champ.id)
  }

  /** Pagamento confirmado: atualiza a lista e entra no campeonato. */
  function handlePaid(updated: Championship) {
    setItems((prev) => (prev ? prev.map((c) => (c.id === updated.id ? updated : c)) : prev))
    setPaying(null)
    onOpen(updated.id)
  }

  return (
    <div className="container dashboard">
      <div className="dashboard__head">
        <div>
          <h1>{isMaster ? 'Todos os campeonatos' : 'Meus campeonatos'}</h1>
          <p className="muted">
            {isMaster
              ? 'Você é o administrador master: administra e exclui qualquer campeonato da plataforma.'
              : 'Gerencie suas competições e acompanhe os resultados.'}
          </p>
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
            <button
              key={c.id}
              className={`champ-card ${isLocked(c) ? 'champ-card--locked' : ''}`}
              // O master entra em qualquer campeonato, pago ou não — quem é
              // parado pela cobrança é o organizador dono.
              onClick={() => (isLocked(c) && !isMaster ? setPaying(c) : onOpen(c.id))}
              style={{ '--accent': c.primaryColor ?? '#16a34a' } as React.CSSProperties}
            >
              <div className="champ-card__logo"><ChampLogo logo={c.logo} /></div>
              <div className="champ-card__body">
                <div className="champ-card__top">
                  <h3>{c.name}</h3>
                  {isLocked(c) ? (
                    <span className="pill pill--pay">🔒 pagamento pendente</span>
                  ) : (
                    <StatusPill status={c.status} />
                  )}
                  {isMaster && organizer && c.ownerId !== organizer.id && (
                    <span className="master-tag" title="Campeonato de outro organizador">de outro organizador</span>
                  )}
                </div>
                <p className="champ-card__meta">
                  {SPORT_LABELS[c.sport]} · {FORMAT_LABELS[c.format]}
                  {c.season ? ` · ${c.season}` : ''}
                  {c.plan && c.plan !== 'gratis' && ` · plano ${planOf(c.plan).tier}`}
                </p>
                {isLocked(c) ? (
                  <p className="champ-card__desc champ-card__pay">
                    Falta pagar {formatBRL(c.amountCents ?? 0)} para liberar.
                  </p>
                ) : (
                  c.description && <p className="champ-card__desc">{c.description}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {creating && (
        <ChampionshipForm
          plan={plan}
          onClose={() => {
            setCreating(false)
            setPlan(undefined)
          }}
          onSave={handleCreate}
        />
      )}

      {paying && (
        <Modal title="Liberar campeonato" onClose={() => setPaying(null)}>
          <PaymentPanel champ={paying} onPaid={handlePaid} />
        </Modal>
      )}
    </div>
  )
}
