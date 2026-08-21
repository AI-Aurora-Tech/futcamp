import { useCallback, useEffect, useRef, useState } from 'react'
import { checkPayment, refreshPayment, startCheckout } from '../services/payments'
import { breakdown, formatBRL } from '../lib/pricing'
import type { Championship } from '../types'
import { Button, Spinner } from './ui'

/**
 * Cobrança do campeonato: mostra a conta (plano + categorias adicionais),
 * gera o link do Asaas e espera a confirmação.
 *
 * Enquanto o pagamento não é confirmado, o campeonato fica bloqueado. A espera
 * automática só relê o banco (quem libera é o webhook); já o botão "Já paguei"
 * pergunta direto ao Asaas, para o organizador não ficar refém do webhook.
 */
export function PaymentPanel({
  champ,
  onPaid,
}: {
  champ: Championship
  onPaid: (updated: Championship) => void
}) {
  const b = breakdown(champ.plan, champ.categories.length)
  const total = champ.amountCents ?? b.totalCents

  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const ticks = useRef(0)

  const check = useCallback(
    async (quiet = false, perguntarAoAsaas = true) => {
      if (!quiet) setChecking(true)
      try {
        const fresh = perguntarAoAsaas ? await checkPayment(champ.id) : await refreshPayment(champ.id)
        if (fresh && fresh.paymentStatus !== 'pending') {
          onPaid(fresh)
          return true
        }
        if (!quiet) {
          setError(
            'O Asaas ainda não registrou este pagamento. Pix costuma cair em segundos; ' +
              'boleto leva até 2 dias úteis. Se você acabou de pagar, tente de novo em um minuto.',
          )
        }
      } catch {
        if (!quiet) setError('Não foi possível consultar o pagamento agora.')
      } finally {
        if (!quiet) setChecking(false)
      }
      return false
    },
    [champ.id, onPaid],
  )

  // Depois que o organizador abre o checkout, fica conferindo sozinho. A cada
  // 5 s relê o banco (barato — é o webhook que libera); a cada 20 s pergunta ao
  // Asaas, para a liberação acontecer mesmo se o webhook não vier.
  useEffect(() => {
    if (!link) return
    ticks.current = 0
    timer.current = window.setInterval(() => {
      ticks.current += 1
      void check(true, ticks.current % 4 === 0)
    }, 5000)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [link, check])

  async function pay() {
    setBusy(true)
    setError(null)
    const res = await startCheckout(champ.id)
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? 'Não foi possível gerar o link de pagamento.')
      return
    }
    if (res.simulated) {
      await check(true, false)
      return
    }
    if (res.url) {
      setLink(res.url)
      window.open(res.url, '_blank', 'noopener')
    }
  }

  return (
    <section className="pay">
      <div className="pay__head">
        <span className="pay__icon" aria-hidden>🔒</span>
        <div>
          <h3>Pagamento pendente</h3>
          <p className="muted small">
            O campeonato <b>{champ.name}</b> é liberado assim que o pagamento for confirmado.
          </p>
        </div>
      </div>

      <ul className="pay__lines">
        <li>
          <span>Plano {b.plan.tier} <span className="muted small">(1ª categoria inclusa)</span></span>
          <span>{formatBRL(b.baseCents)}</span>
        </li>
        {b.extraCategories > 0 && (
          <li>
            <span>
              {b.extraCategories} categoria(s) adicional(is)
              <span className="muted small"> × {formatBRL(b.plan.addonCents)}</span>
            </span>
            <span>{formatBRL(b.extraCents)}</span>
          </li>
        )}
        <li className="pay__total">
          <span>Total</span>
          <span>{formatBRL(total)}</span>
        </li>
      </ul>

      {error && <p className="auth-error">{error}</p>}

      <div className="pay__actions">
        <Button onClick={() => void pay()} disabled={busy}>
          {busy ? 'Gerando link…' : link ? '↻ Abrir pagamento de novo' : '💳 Pagar com Pix, boleto ou cartão'}
        </Button>
        <Button variant="ghost" onClick={() => void check()} disabled={checking}>
          {checking ? 'Perguntando ao Asaas…' : 'Já paguei — conferir'}
        </Button>
      </div>

      {link && (
        <p className="pay__waiting">
          <Spinner /> Esperando a confirmação do Asaas… pode fechar a aba do pagamento, a
          liberação é automática.
        </p>
      )}

      <p className="muted small pay__note">
        Pagou e não liberou? A confirmação do Asaas pode levar alguns minutos (Pix é quase
        imediato; boleto leva até 2 dias úteis). O campeonato fica guardado como está — e
        o botão acima confere direto com o Asaas, quantas vezes você quiser.
      </p>
    </section>
  )
}
