// ---------------------------------------------------------------------------
// Planos e preços — fonte única da verdade.
//
// A página de planos, o formulário de criação e a cobrança leem daqui, para o
// valor mostrado ao organizador ser exatamente o valor cobrado.
//
// A conta é sempre a mesma:
//     total = preço do plano + (categorias − 1) × adicional por categoria
//
// Valores em CENTAVOS — dinheiro nunca em ponto flutuante.
// ---------------------------------------------------------------------------
import type { PlanKey } from '../types'

export interface PlanInfo {
  key: PlanKey
  tier: string
  gem: string
  tint: string
  cap: string
  /** Preço do plano (já inclui a 1ª categoria), em centavos. */
  priceCents: number
  /** Valor de cada categoria além da primeira, em centavos. */
  addonCents: number
  /** Limite de equipes por categoria (null = ilimitado). */
  maxTeams: number | null
  /** Limite de categorias (null = ilimitado). */
  maxCategories: number | null
  /** Quantos campeonatos o organizador pode ter neste plano (null = sem limite). */
  maxChampionships: number | null
  /** Plano sob consulta: não gera cobrança automática. */
  consult?: boolean
  unit: string
  addon: string
  feats: string[]
  cta: string
  featured?: boolean
  badge?: string
}

export const PLANS: PlanInfo[] = [
  {
    key: 'gratis',
    tier: 'Grátis',
    gem: '●',
    tint: '#16a34a',
    cap: 'Para experimentar e organizar uma copa pequena.',
    priceCents: 0,
    addonCents: 0,
    maxTeams: 8,
    maxCategories: 1,
    maxChampionships: 1,
    unit: 'para sempre · 1 campeonato',
    addon: 'Com a marca Tabelaço na página pública',
    feats: ['Apenas 1 campeonato com 1 categoria', 'Até 8 equipes', 'Todas as funcionalidades'],
    cta: 'Começar grátis',
  },
  {
    key: 'bronze',
    tier: 'Bronze',
    gem: '●',
    tint: '#c0803f',
    cap: 'Para copas menores, com poucas equipes por categoria.',
    priceCents: 5990,
    addonCents: 3990,
    maxTeams: 16,
    maxCategories: null,
    maxChampionships: null,
    unit: 'por campeonato · 1 categoria',
    addon: '+ R$ 39,90 por categoria adicional',
    feats: ['Até 16 equipes por categoria', 'Todas as funcionalidades', 'Com a marca Tabelaço na página pública'],
    cta: 'Escolher Bronze',
  },
  {
    key: 'prata',
    tier: 'Prata',
    gem: '●',
    tint: '#8f9bad',
    cap: 'Para campeonatos de porte médio, com mais times.',
    priceCents: 7990,
    addonCents: 4990,
    maxTeams: 32,
    maxCategories: null,
    maxChampionships: null,
    unit: 'por campeonato · 1 categoria',
    addon: '+ R$ 49,90 por categoria adicional',
    feats: ['Até 32 equipes por categoria', 'Todas as funcionalidades'],
    cta: 'Escolher Prata',
  },
  {
    key: 'ouro',
    tier: 'Ouro',
    gem: '●',
    tint: '#d1a01e',
    cap: 'Para ligas e copas grandes, sem se preocupar com limite.',
    priceCents: 10990,
    addonCents: 5990,
    maxTeams: null,
    maxCategories: null,
    maxChampionships: null,
    unit: 'por campeonato · 1 categoria',
    addon: '+ R$ 59,90 por categoria adicional',
    feats: ['Equipes ilimitadas por categoria', 'Todas as funcionalidades'],
    cta: 'Escolher Ouro',
    featured: true,
    badge: 'Mais popular',
  },
  {
    key: 'diamante',
    tier: 'Diamante',
    gem: '◆',
    tint: '#35a9c4',
    cap: 'Para organizações que rodam vários campeonatos o ano todo.',
    priceCents: 0,
    addonCents: 0,
    maxTeams: null,
    maxCategories: null,
    maxChampionships: null,
    consult: true,
    unit: 'plano anual',
    addon: 'Categorias ilimitadas — sem cobrança por adicional',
    feats: ['Equipes ilimitadas', 'Categorias ilimitadas', 'Todas as funcionalidades'],
    cta: 'Falar com a gente',
    badge: 'Anual',
  },
]

/** Plano pelo identificador. */
export function planOf(key: PlanKey | undefined): PlanInfo {
  return PLANS.find((p) => p.key === key) ?? PLANS[0]
}

/** Planos que geram cobrança automática (Diamante é sob consulta). */
export const PAID_PLANS = PLANS.filter((p) => p.priceCents > 0 && !p.consult)

/**
 * Total do campeonato: plano + categorias adicionais.
 * `categories` é o número de categorias do campeonato (mínimo 1).
 */
export function totalCents(key: PlanKey | undefined, categories: number): number {
  const plan = planOf(key)
  if (plan.consult) return 0
  const extra = Math.max(0, Math.ceil(categories) - 1)
  return plan.priceCents + extra * plan.addonCents
}

/** Detalhamento do valor, para mostrar ao organizador antes de pagar. */
export interface PriceBreakdown {
  plan: PlanInfo
  categories: number
  extraCategories: number
  baseCents: number
  extraCents: number
  totalCents: number
}

export function breakdown(key: PlanKey | undefined, categories: number): PriceBreakdown {
  const plan = planOf(key)
  const extraCategories = plan.consult ? 0 : Math.max(0, Math.ceil(categories) - 1)
  const extraCents = extraCategories * plan.addonCents
  return {
    plan,
    categories: Math.max(1, Math.ceil(categories)),
    extraCategories,
    baseCents: plan.consult ? 0 : plan.priceCents,
    extraCents,
    totalCents: (plan.consult ? 0 : plan.priceCents) + extraCents,
  }
}

/** Formata centavos como moeda brasileira: 10990 → "R$ 109,90". */
export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** O plano cobra? (Grátis não cobra; Diamante é negociado fora do app.) */
export function isPayable(key: PlanKey | undefined, categories: number): boolean {
  return totalCents(key, categories) > 0
}

/**
 * Campeonato bloqueado por falta de pagamento. Enquanto estiver assim, o
 * organizador vê a tela de cobrança em vez do painel.
 */
export function isLocked(champ: { paymentStatus?: string } | null | undefined): boolean {
  return champ?.paymentStatus === 'pending'
}
