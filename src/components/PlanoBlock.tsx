import { useState } from 'react'
import { changePlan, revertPlan } from '../services/championships'
import { PLANS, breakdown, formatBRL, limiteDeTimes, planOf } from '../lib/pricing'
import type { Championship, PlanKey } from '../types'
import { Button } from './ui'

/**
 * Troca de plano de um campeonato JÁ CRIADO.
 *
 * Existia um beco sem saída: quem escolhia o Grátis e batia no limite de
 * equipes precisava criar outro campeonato do zero e recadastrar tudo. Aqui a
 * troca é feita no lugar, e nada — time, elenco, tabela, súmula — se move.
 *
 * As duas direções não são simétricas, e a tela diz isso antes de o organizador
 * clicar:
 *
 *   • SUBIR cobra a diferença e devolve o campeonato para "pendente" até o
 *     pagamento sair. O painel fecha; os dados ficam. Dá para desfazer
 *     enquanto não estiver pago.
 *   • DESCER vale na hora e não devolve dinheiro.
 *
 * Quem decide é o banco (`change_championship_plan`). Este componente só
 * pergunta e mostra o resultado.
 */
export function PlanoBlock({
  champ,
  totalTimes,
  onChanged,
}: {
  champ: Championship
  /** Equipes já cadastradas — para avisar quando o plano novo não as comporta. */
  totalTimes?: number
  onChanged: () => void
}) {
  const atual = planOf(champ.plan)
  const [escolhido, setEscolhido] = useState<PlanKey | ''>('')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const cats = champ.categories?.length || 1
  const jaPago = champ.paymentStatus === 'paid' || champ.paymentStatus === 'free'
    ? champ.amountCents ?? 0
    : 0
  const pendente = champ.planChange

  const novo = escolhido ? breakdown(escolhido, cats) : null
  const sobe = novo ? novo.totalCents > jaPago : false
  const limiteNovo = escolhido ? limiteDeTimes(escolhido) : Number.POSITIVE_INFINITY
  const naoCabem = totalTimes != null && totalTimes > limiteNovo

  async function trocar() {
    if (!escolhido) return
    setErro(null)
    setAviso(null)
    setBusy(true)
    try {
      const r = await changePlan(champ.id, escolhido)
      setEscolhido('')
      setAviso(
        r.cobra
          ? `Plano alterado para ${r.tier}. Falta pagar ${formatBRL(r.aPagarCents)} — o campeonato fica fechado até a confirmação, mas nada foi perdido.`
          : `Plano alterado para ${r.tier}. O campeonato continua liberado.`,
      )
      onChanged()
    } catch (e) {
      setErro((e as Error).message || 'Não foi possível trocar o plano.')
    } finally {
      setBusy(false)
    }
  }

  async function desfazer() {
    setErro(null)
    setBusy(true)
    try {
      await revertPlan(champ.id)
      setAviso('Troca desfeita. O campeonato voltou ao plano anterior.')
      onChanged()
    } catch (e) {
      setErro((e as Error).message || 'Não foi possível desfazer a troca.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-block">
      <h3>Plano do campeonato</h3>
      <p className="muted small">
        Plano atual: <b>{atual.tier}</b> ·{' '}
        {atual.maxTeams == null ? 'equipes ilimitadas' : `até ${atual.maxTeams} equipes`} ·{' '}
        {cats} categoria(s){champ.amountCents ? ` · ${formatBRL(champ.amountCents)}` : ''}
        {totalTimes != null && ` · ${totalTimes} equipe(s) cadastrada(s)`}
      </p>
      <p className="muted small">
        Trocar de plano <b>não apaga nada</b>: times, elencos, tabela e súmulas continuam
        exatamente onde estão.
      </p>

      {pendente && (
        <div className="plano-troca__pendente">
          <p>
            ⏳ Troca pendente: o campeonato passou de <b>{planOf(pendente.plan).tier}</b> para{' '}
            <b>{atual.tier}</b> e está aguardando o pagamento
            {champ.amountCents ? ` de ${formatBRL(champ.amountCents)}` : ''}.
          </p>
          <Button variant="soft" type="button" onClick={() => void desfazer()} disabled={busy}>
            ↩ Desfazer e voltar para {planOf(pendente.plan).tier}
          </Button>
        </div>
      )}

      <div className="plano-troca">
        <label className="field__label" htmlFor="plano-novo">Trocar para</label>
        <select
          id="plano-novo"
          value={escolhido}
          onChange={(e) => { setEscolhido(e.target.value as PlanKey | ''); setAviso(null); setErro(null) }}
        >
          <option value="">Escolha um plano…</option>
          {PLANS.filter((p) => p.key !== champ.plan).map((p) => (
            <option key={p.key} value={p.key}>
              {p.tier} — {p.maxTeams == null ? 'equipes ilimitadas' : `até ${p.maxTeams} equipes`}
              {p.consult ? ' (sob consulta)' : ` — ${formatBRL(breakdown(p.key, cats).totalCents)}`}
            </option>
          ))}
        </select>
        <Button type="button" onClick={() => void trocar()} disabled={busy || !escolhido}>
          {busy ? 'Trocando…' : 'Trocar plano'}
        </Button>
      </div>

      {novo && (
        <p className={`plano-troca__previsao ${sobe ? 'is-cobra' : ''}`}>
          {planOf(escolhido as PlanKey).consult ? (
            <>
              O plano Diamante é negociado com um consultor. Escolher aqui não gera cobrança —
              fale com a gente pela página de planos.
            </>
          ) : sobe ? (
            <>
              💳 Vai gerar uma cobrança de <b>{formatBRL(novo.totalCents)}</b>. O campeonato fica
              fechado até o pagamento ser confirmado — e você pode desfazer antes de pagar.
            </>
          ) : (
            <>
              ✅ Vale na hora, sem nova cobrança. <b>Não há devolução</b> do que já foi pago.
            </>
          )}
        </p>
      )}

      {naoCabem && (
        <p className="plano-troca__previsao is-cobra">
          ⚠️ Este campeonato tem {totalTimes} equipe(s) e o plano {planOf(escolhido as PlanKey).tier}{' '}
          permite {limiteNovo}. Nenhuma equipe é apagada — mas você não conseguirá cadastrar novas
          enquanto estiver acima do limite.
        </p>
      )}

      {aviso && <p className="plano-troca__ok">{aviso}</p>}
      {erro && <p className="auth-error">{erro}</p>}
    </div>
  )
}
