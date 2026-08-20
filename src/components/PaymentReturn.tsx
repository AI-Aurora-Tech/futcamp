import { useEffect, useState } from 'react'
import { getChampionship } from '../services/championships'
import { isLocked } from '../lib/pricing'
import type { Championship } from '../types'
import { Button, ChampLogo, Spinner } from './ui'
import { PaymentPanel } from './PaymentPanel'

/**
 * Volta do Mercado Pago (`#/pagamento/<id>`).
 *
 * A liberação vem pelo webhook, não por esta tela — aqui a gente só confere o
 * campeonato e mostra o resultado. Se ainda estiver pendente (Pix caindo,
 * boleto em compensação), mostra a cobrança com a espera automática.
 */
export function PaymentReturn({
  championshipId,
  status,
  onOpen,
  onHome,
}: {
  championshipId: string
  status: string | null
  onOpen: (id: string) => void
  onHome: () => void
}) {
  const [champ, setChamp] = useState<Championship | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    getChampionship(championshipId)
      .then((c) => active && setChamp(c))
      .catch(() => active && setChamp(null))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [championshipId])

  if (loading) return <div className="container pad-lg"><Spinner label="Conferindo o pagamento…" /></div>

  if (!champ) {
    return (
      <div className="container pad-lg center">
        <h2>Campeonato não encontrado</h2>
        <Button onClick={onHome}>Ir para meus campeonatos</Button>
      </div>
    )
  }

  if (!isLocked(champ)) {
    return (
      <div className="container pad-lg center pay-done">
        <span className="pay-done__ic" aria-hidden>🎉</span>
        <h2>Pagamento confirmado!</h2>
        <p className="muted">
          <span className="pay-done__logo"><ChampLogo logo={champ.logo} /></span>
          O campeonato <b>{champ.name}</b> está liberado.
        </p>
        <Button onClick={() => onOpen(champ.id)}>Abrir campeonato</Button>
      </div>
    )
  }

  return (
    <div className="container pad-lg">
      <button className="back-link" onClick={onHome}>← Meus campeonatos</button>
      {status === 'falha' && (
        <p className="auth-error">O pagamento não foi concluído. Você pode tentar de novo abaixo.</p>
      )}
      {status === 'pendente' && (
        <p className="muted">
          O Mercado Pago ainda está processando (boleto e alguns Pix levam alguns minutos).
        </p>
      )}
      <PaymentPanel champ={champ} onPaid={(c) => setChamp(c)} />
    </div>
  )
}
