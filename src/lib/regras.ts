// ---------------------------------------------------------------------------
// Regras de jogo em texto.
//
// O organizador preenche números e opções no formulário; aqui eles viram as
// frases que entram no regulamento que os times baixam. Separado do PDF de
// propósito: isto é texto puro e testável, sem byte de arquivo no meio.
//
// Regra ausente = frase ausente. O regulamento nunca inventa um padrão: dizer
// "2 tempos de 25 minutos" num campeonato onde ninguém definiu o tempo é pior
// do que não dizer nada — vira a palavra do app contra a da organização, no
// meio de uma discussão de beira de campo.
// ---------------------------------------------------------------------------
import type { Category, Championship } from '../types'
import { SEND_OFF_LABELS } from '../types'
import { formatBRL } from './pricing'

/** Converte "R$ 120,00", "120,00" ou "120" em centavos. Vazio = indefinido. */
export function centavosDeTexto(valor: string): number | undefined {
  const limpo = (valor ?? '').replace(/[^\d,.-]/g, '').trim()
  if (!limpo) return undefined
  // Em pt-BR a vírgula é o separador decimal e o ponto agrupa milhar.
  const normal = limpo.replace(/\./g, '').replace(',', '.')
  const n = Number(normal)
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.round(n * 100)
}

/** Centavos no formato que o organizador digita de volta ("120,00"). */
export function textoDeCentavos(cents: number | undefined | null): string {
  if (cents == null) return ''
  return (cents / 100).toFixed(2).replace('.', ',')
}

/** "2 tempos de 25 minutos (50 no total)" — ou vazio, se não foi definido. */
export function descreverTempo(cat: Category | null | undefined): string {
  const min = cat?.periodMinutes
  if (!min || min <= 0) return ''
  const tempos = Math.max(1, cat?.periods ?? 2)
  if (tempos === 1) return `partida de ${min} minutos, em tempo corrido`
  const total = tempos * min
  return `${tempos} tempos de ${min} minutos (${total} minutos no total)`
}

/** Como as substituições funcionam nesta categoria. */
export function descreverSubstituicoes(cat: Category | null | undefined): string {
  const modo = cat?.substitutionMode
  if (!modo) return ''
  if (modo === 'rotativa') {
    return 'substituição rotativa: as trocas são livres e o atleta substituído pode voltar à partida'
  }
  const max = cat?.maxSubstitutions
  if (!max || max <= 0) return 'substituições com limite definido pela organização'
  return `até ${max} substituição(ões) por partida, sem retorno do atleta substituído`
}

/** Acúmulo de cartão amarelo e suspensão automática. */
export function descreverAmarelos(cat: Category | null | undefined): string {
  if (cat?.yellowAccumulates === undefined) return ''
  if (!cat.yellowAccumulates) {
    return 'o cartão amarelo não acumula entre as partidas'
  }
  const n = limiteAmarelos(cat)
  return `o ${n}º cartão amarelo acumulado gera suspensão automática na partida seguinte`
}

/**
 * Quantos amarelos suspendem nesta categoria. O 3 é o costume do futebol
 * amador brasileiro e vale como padrão quando o acúmulo está ligado mas o
 * número não foi informado.
 */
export function limiteAmarelos(cat: Category | null | undefined): number {
  const n = cat?.yellowsForSuspension
  return n && n > 0 ? Math.floor(n) : 3
}

/** O amarelo acumula nesta categoria? Sem definição, acumula (o costume). */
export function amareloAcumula(cat: Category | null | undefined): boolean {
  return cat?.yellowAccumulates !== false
}

/** Valor da arbitragem e a chave PIX de recebimento. */
export function descreverArbitragem(cat: Category | null | undefined): string {
  const cents = cat?.refereeFeeCents
  const pix = (cat?.refereePix ?? '').trim()
  if (!cents && !pix) return ''
  const valor = cents ? `taxa de arbitragem de ${formatBRL(cents)} por partida` : 'taxa de arbitragem definida pela organização'
  return pix ? `${valor}, paga via PIX na chave ${pix}` : valor
}

/** O banco de reservas — a frase pedida, ao pé da letra. */
export function descreverBanco(c: Pick<Championship, 'benchSize'>): string {
  const n = c.benchSize
  if (!n || n <= 0) return ''
  return `Poderá ficar no banco de reservas até ${n} atletas devidamente uniformizados.`
}

/** O que acontece com a equipe quando um atleta é expulso. */
export function descreverExpulsao(c: Pick<Championship, 'sendOffPolicy'>): string {
  const p = c.sendOffPolicy
  if (!p) return ''
  return p === 'menos_um'
    ? 'O atleta expulso não pode ser substituído: a equipe segue a partida com um atleta a menos.'
    : 'A equipe pode substituir o atleta expulso, mantendo o número de atletas em campo. O expulso está fora da partida.'
}

/** Rótulo pronto da penalidade, para telas e resumos. */
export function rotuloExpulsao(c: Pick<Championship, 'sendOffPolicy'>): string {
  return c.sendOffPolicy ? SEND_OFF_LABELS[c.sendOffPolicy] : ''
}

/** Alguma categoria definiu alguma regra de jogo? */
export function temRegrasDeJogo(cats: Category[] | null | undefined): boolean {
  return (cats ?? []).some(
    (c) =>
      Boolean(c.periodMinutes) ||
      Boolean(c.substitutionMode) ||
      c.yellowAccumulates !== undefined ||
      Boolean(c.refereeFeeCents) ||
      Boolean((c.refereePix ?? '').trim()),
  )
}
