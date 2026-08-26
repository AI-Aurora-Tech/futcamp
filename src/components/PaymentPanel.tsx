import { useCallback, useEffect, useRef, useState } from 'react'
import {
  acceptContract,
  checkPayment,
  getSubscription,
  masterRelease,
  refreshPayment,
  setNegotiatedPrice,
  startCheckout,
} from '../services/payments'
import { CONTRATO_VERSAO, contratoDiamante, totalDoContrato } from '../lib/contrato'
import type { Subscription } from '../types'
import { useAuth } from '../context/AuthContext'
import { breakdown, formatBRL, planOf } from '../lib/pricing'
import type { Championship } from '../types'
import { LINK_DIAMANTE, LINK_SUPORTE_PAGAMENTO } from '../lib/whatsapp'
import { PlanoBlock } from './PlanoBlock'
import { Button, Field, Spinner, SuporteLink } from './ui'

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
  onChanged,
}: {
  champ: Championship
  onPaid: (updated: Championship) => void
  /** Recarrega o campeonato depois de uma troca de plano. */
  onChanged?: () => void
}) {
  const b = breakdown(champ.plan, champ.categories.length)
  const total = champ.amountCents ?? b.totalCents

  const { isMaster } = useAuth()
  const [busy, setBusy] = useState(false)
  const [liberando, setLiberando] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const ticks = useRef(0)

  const check = useCallback(
    async (quiet = false, perguntarAoAsaas = true) => {
      if (!quiet) setChecking(true)
      try {
        const r = perguntarAoAsaas
          ? await checkPayment(champ.id)
          : { champ: await refreshPayment(champ.id), consultou: false as const, erro: undefined }
        const fresh = r.champ
        if (fresh && fresh.paymentStatus !== 'pending') {
          onPaid(fresh)
          return true
        }
        if (!quiet) {
          // Distingue "perguntei e ele não achou" de "não consegui perguntar".
          // Confundir os dois foi o que fez este problema demorar a aparecer.
          setError(
            perguntarAoAsaas && !r.consultou
              ? `Não consegui perguntar ao Asaas: ${r.erro ?? 'falha na consulta'}. ` +
                  'Confira se a função asaas-status foi publicada (supabase functions deploy asaas-status --no-verify-jwt).'
              : 'O Asaas ainda não registrou este pagamento. Pix costuma cair em segundos; ' +
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

  // Ao abrir a tela já pergunta uma vez ao Asaas: quem pagou e voltou depois
  // (fechou a aba, entrou de outro aparelho) não precisa clicar em nada.
  useEffect(() => {
    void check(true, true)
    // Só na montagem — o resto é o intervalo abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  /** Liberação manual: só o master, e quem valida é o banco. */
  async function liberar() {
    const nota = prompt(
      'Liberar este campeonato SEM cobrança pelo app.\n\n' +
        'Use quando o pagamento entrou por fora (dinheiro, transferência, cortesia).\n' +
        'Anote o motivo — fica registrado no campeonato:',
      'recebido em dinheiro',
    )
    if (nota === null) return
    setLiberando(true)
    setError(null)
    try {
      const fresh = await masterRelease(champ.id, nota)
      if (fresh) onPaid(fresh)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLiberando(false)
    }
  }

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

  // Diamante: o valor não vem da tabela de preços, vem da negociação. Enquanto
  // o consultor não registra quanto ficou, não há o que cobrar.
  const diamante = b.plan.consult
  // Sem negociação, vale o preço de tabela — desde a 0038 o Diamante tem um, e
  // o cliente contrata sozinho. O consultor entra só para fechar diferente.
  const mensal = diamante && (champ.negotiatedKind ?? 'mensal') === 'mensal'
  const combinado = champ.negotiatedCents ?? (mensal ? (b.plan.monthlyCents ?? 0) : 0)
  const aCombinar = diamante && combinado <= 0

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
        {diamante ? (
          <li>
            <span>
              Plano Diamante{' '}
              <span className="muted small">
                {mensal
                  ? `assinatura mensal · ${champ.negotiatedMonths ?? 12} meses`
                  : '(categorias e equipes ilimitadas)'}
              </span>
            </span>
            <span>{aCombinar ? '—' : mensal ? `${formatBRL(combinado)}/mês` : formatBRL(combinado)}</span>
          </li>
        ) : (
          <>
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
          </>
        )}
        <li className="pay__total">
          <span>{mensal ? 'Por mês' : 'Total'}</span>
          <span>
            {aCombinar ? 'a combinar' : formatBRL(mensal || diamante ? combinado : total)}
          </span>
        </li>
        {mensal && (
          <li className="muted small">
            <span>Compromisso de {champ.negotiatedMonths ?? 12} meses</span>
            <span>
              {formatBRL(totalDoContrato({ cents: combinado, meses: champ.negotiatedMonths ?? 12 }))}
            </span>
          </li>
        )}
      </ul>

      {/* Diamante sem valor registrado: não há link a gerar, e é melhor dizer
          isso do que oferecer um botão que responde erro. */}
      {aCombinar && (
        <p className="pay__consulta">
          ◆ O <b>Diamante</b> é negociado caso a caso. Fale com o consultor: assim que o valor
          for combinado, ele aparece aqui e o pagamento é liberado nesta mesma tela.
          {' '}<SuporteLink href={LINK_DIAMANTE}>Falar com o consultor</SuporteLink>
        </p>
      )}

      {diamante && !aCombinar && champ.negotiatedNote && (
        <p className="muted small pay__note">◆ Negociação: {champ.negotiatedNote}</p>
      )}

      {error && <p className="auth-error">{error}</p>}

      {mensal ? (
        <AssinaturaDiamante
          champ={champ}
          cents={combinado}
          meses={champ.negotiatedMonths ?? 12}
          assinando={busy}
          onAssinar={() => void pay()}
          onConferir={() => void check()}
          conferindo={checking}
        />
      ) : (
        <div className="pay__actions">
          <Button onClick={() => void pay()} disabled={busy || aCombinar}>
            {busy ? 'Gerando link…' : link ? '↻ Abrir pagamento de novo' : '💳 Pagar com Pix, boleto ou cartão'}
          </Button>
          <Button variant="ghost" onClick={() => void check()} disabled={checking}>
            {checking ? 'Perguntando ao Asaas…' : 'Já paguei — conferir'}
          </Button>
        </div>
      )}

      {isMaster && (
        <div className="pay__master">
          <p className="muted small">
            👑 <b>Administrador master:</b> se o pagamento entrou por fora do app — dinheiro,
            transferência, cortesia — você pode liberar na mão. Fica registrado no campeonato.
          </p>
          <Button variant="soft" onClick={() => void liberar()} disabled={liberando}>
            {liberando ? 'Liberando…' : '👑 Liberar sem cobrança'}
          </Button>
        </div>
      )}

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
        {' '}Continua preso? <SuporteLink href={LINK_SUPORTE_PAGAMENTO}>Fale com o suporte</SuporteLink>.
      </p>

      {/* Trocar de plano é a saída para quem escolheu grande demais e ainda não
          pagou: descer para um plano mais barato (ou para o Grátis) libera o
          campeonato na hora, sem perder o que já foi cadastrado. */}
      <PlanoBlock champ={champ} onChanged={() => onChanged?.()} />
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Valor negociado do plano Diamante — visão do consultor (master)             */
/*                                                                            */
/* Fica nos Ajustes, e não na tela de cobrança, porque o master NUNCA vê a    */
/* tela de cobrança: ele entra direto no campeonato, em qualquer situação.    */
/* -------------------------------------------------------------------------- */
export function DiamanteNegociacao({
  champ,
  onChanged,
}: {
  champ: Championship
  onChanged: (c: Championship) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const combinado = champ.negotiatedCents ?? 0
  const pago = champ.paymentStatus === 'paid'
  const mensalidade = champ.negotiatedKind === 'mensal'
  const meses = champ.negotiatedMonths ?? 12

  /**
   * Registra o valor combinado.
   *
   * O Diamante não tem preço de tabela — cada contrato sai por um valor. É o
   * consultor quem sabe qual, e é aqui que ele entra no sistema. Definido o
   * valor, o cliente vê a cobrança e paga pelo link do Asaas como em qualquer
   * outro plano; a liberação continua sendo do webhook.
   */
  async function combinar(kind: 'avulso' | 'mensal') {
    // Sem valor combinado ainda, sugere o de tabela: o consultor confirma em
    // vez de digitar, e negocia diferente quando o caso pedir.
    const tabela = kind === 'mensal' ? (planOf('diamante').monthlyCents ?? 0) : 0
    const sugerido = combinado || tabela
    const atual = sugerido ? (sugerido / 100).toFixed(2) : ''
    const digitado = prompt(
      kind === 'mensal'
        ? `Mensalidade do Diamante para "${champ.name}".\n\n` +
            'Em reais, o valor de CADA mês (ex.: 200 ou 200,00).\n' +
            'Deixe em branco (ou 0) para voltar a "a combinar".'
        : `Valor único do Diamante para "${champ.name}".\n\n` +
            'Em reais, como você negociou (ex.: 2500 ou 2500,00).\n' +
            'Deixe em branco (ou 0) para voltar a "a combinar".',
      atual,
    )
    if (digitado === null) return

    const limpo = digitado.trim().replace(/[R$\s.]/g, '').replace(',', '.')
    const reais = limpo === '' ? 0 : Number(limpo)
    if (!Number.isFinite(reais) || reais < 0) {
      setError('Valor inválido. Digite só o número, como 200 ou 200,00.')
      return
    }

    let meses = champ.negotiatedMonths ?? 12
    if (reais > 0 && kind === 'mensal') {
      const m = prompt('Compromisso de quantos meses?', String(meses))
      if (m === null) return
      const n = Number(m.trim())
      if (!Number.isFinite(n) || n < 1 || n > 60) {
        setError('Prazo inválido. Use um número de meses entre 1 e 60.')
        return
      }
      meses = Math.round(n)
    }

    const nota =
      reais > 0
        ? prompt('Anotação da negociação (proposta, contrato, condições):', champ.negotiatedNote ?? '')
        : null
    if (reais > 0 && nota === null) return

    setBusy(true)
    setError(null)
    try {
      const fresh = await setNegotiatedPrice(
        champ.id, Math.round(reais * 100), nota ?? undefined, kind, meses,
      )
      if (fresh) onChanged(fresh)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-block">
      <h3>◆ Plano Diamante — valor negociado</h3>
      <p className="muted small">
        {pago ? (
          <>
            Contrato fechado por <b>{formatBRL(champ.amountCents ?? 0)}</b> e já pago. O valor não
            muda mais.
          </>
        ) : combinado > 0 ? (
          mensalidade ? (
            <>
              Combinado: <b>{formatBRL(combinado)}/mês</b> por <b>{meses} meses</b> (
              {formatBRL(totalDoContrato({ cents: combinado, meses }))} no total). O cliente aceita o
              contrato e assina no cartão; a partir daí <b>todos</b> os campeonatos Diamante da conta
              dele ficam abertos enquanto a assinatura estiver em dia.
            </>
          ) : (
            <>
              Combinado: <b>{formatBRL(combinado)}</b>, pagamento único. O cliente já vê a cobrança e
              o botão de pagar; quando o Asaas confirmar, o campeonato libera sozinho.
            </>
          )
        ) : (
          <>
            Sem negociação: vale o <b>plano de tabela</b> —{' '}
            {formatBRL(planOf('diamante').monthlyCents ?? 0)}/mês por 12 meses, e o cliente pode
            contratar sozinho. Registre um valor aqui só para fechar diferente do padrão.
          </>
        )}
      </p>
      {champ.negotiatedNote && <p className="muted small">Negociação: {champ.negotiatedNote}</p>}
      {error && <p className="auth-error">{error}</p>}
      {!pago && (
        <div className="panel__head-actions">
          <Button variant="soft" onClick={() => void combinar('mensal')} disabled={busy}>
            {busy ? 'Registrando…' : '◆ Mensalidade diferente'}
          </Button>
          <Button variant="ghost" onClick={() => void combinar('avulso')} disabled={busy}>
            {busy ? 'Registrando…' : '◆ Valor único'}
          </Button>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Assinatura mensal do Diamante — visão do cliente                           */
/*                                                                            */
/* Duas etapas, nesta ordem, e a ordem é o ponto: primeiro o ACEITE do        */
/* contrato, depois o cartão. O Asaas não sabe representar compromisso de 12  */
/* meses — a assinatura dele recorre até alguém parar. O que segura o prazo   */
/* é o aceite, e ele precisa existir antes de haver o que cobrar.             */
/* -------------------------------------------------------------------------- */
function AssinaturaDiamante({
  champ,
  cents,
  meses,
  assinando,
  onAssinar,
  onConferir,
  conferindo,
}: {
  champ: Championship
  cents: number
  meses: number
  assinando: boolean
  onAssinar: () => void
  onConferir: () => void
  conferindo: boolean
}) {
  const [sub, setSub] = useState<Subscription | null | undefined>(undefined)
  const [nome, setNome] = useState('')
  const [documento, setDocumento] = useState('')
  const [marcado, setMarcado] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const texto = contratoDiamante({ campeonato: champ.name, cents, meses })

  useEffect(() => {
    let vivo = true
    getSubscription()
      .then((s) => vivo && setSub(s))
      .catch(() => vivo && setSub(null))
    return () => {
      vivo = false
    }
  }, [champ.id])

  async function aceitar() {
    if (!nome.trim() || !documento.trim()) {
      setError('Preencha o nome e o documento de quem está aceitando.')
      return
    }
    if (!marcado) {
      setError('Marque a confirmação de que leu e aceita o contrato.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      setSub(await acceptContract({
        championshipId: champ.id,
        nome: nome.trim(),
        documento: documento.trim(),
        versao: CONTRATO_VERSAO,
        texto,
      }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (sub === undefined) {
    return <div className="pad-lg center"><Spinner /></div>
  }

  // Assinatura atrasada além da carência: não é hora de contrato novo, é hora
  // de regularizar o cartão.
  if (sub && sub.status === 'overdue') {
    return (
      <div className="assina">
        <p className="assina__aviso">
          ⚠️ A cobrança deste mês não foi paga. Regularize o cartão para o campeonato voltar ao ar —
          nada foi apagado.
        </p>
        <div className="pay__actions">
          <Button variant="ghost" onClick={onConferir} disabled={conferindo}>
            {conferindo ? 'Perguntando ao Asaas…' : 'Já regularizei — conferir'}
          </Button>
        </div>
      </div>
    )
  }

  // Contrato já aceito: falta o cartão.
  if (sub && sub.contractAt) {
    return (
      <div className="assina">
        <p className="assina__ok">
          ✅ Contrato aceito por <b>{sub.contractName}</b> em{' '}
          {new Date(sub.contractAt).toLocaleString('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
          })}
          .
        </p>
        <p className="muted small">
          O cartão é debitado em <b>{formatBRL(cents)}</b> por mês, durante {meses} meses. Não é
          parcelamento: o limite do seu cartão não fica preso no valor total.
        </p>
        <div className="pay__actions">
          <Button onClick={onAssinar} disabled={assinando}>
            {assinando ? 'Gerando link…' : '💳 Assinar com cartão de crédito'}
          </Button>
          <Button variant="ghost" onClick={onConferir} disabled={conferindo}>
            {conferindo ? 'Perguntando ao Asaas…' : 'Já assinei — conferir'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="assina">
      <h4 className="assina__titulo">Contrato da assinatura</h4>
      <p className="muted small">
        {formatBRL(cents)} por mês, durante {meses} meses —{' '}
        {formatBRL(totalDoContrato({ cents, meses }))} no total. Leia e aceite para liberar o
        pagamento.
      </p>
      <pre className="assina__texto">{texto}</pre>

      <div className="form-row">
        <Field label="Nome de quem aceita">
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo" />
        </Field>
        <Field label="CPF ou CNPJ">
          <input
            value={documento}
            onChange={(e) => setDocumento(e.target.value)}
            placeholder="000.000.000-00"
          />
        </Field>
      </div>

      <label className="assina__check">
        <input type="checkbox" checked={marcado} onChange={(e) => setMarcado(e.target.checked)} />
        <span>
          Li e aceito o contrato acima, inclusive o compromisso de {meses} meses e a carência de 7
          dias em caso de atraso.
        </span>
      </label>

      {error && <p className="auth-error">{error}</p>}

      <div className="pay__actions">
        <Button onClick={() => void aceitar()} disabled={busy}>
          {busy ? 'Registrando…' : '✍️ Aceitar contrato'}
        </Button>
      </div>
    </div>
  )
}
