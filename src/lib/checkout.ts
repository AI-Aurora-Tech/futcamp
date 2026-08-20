// ---------------------------------------------------------------------------
// Links de pagamento (Mercado Pago).
//
// São links PÚBLICOS de checkout — não levam token nem chave secreta. O
// visitante clica no plano e vai direto para a página de pagamento do Mercado
// Pago; nada sensível trafega pelo app.
//
// Para trocar um link sem mexer no código, defina no .env:
//   VITE_MP_LINK_BRONZE / VITE_MP_LINK_PRATA / VITE_MP_LINK_OURO
//
// ⚠️ O **access token de produção** do Mercado Pago NUNCA entra aqui (nem em
// qualquer arquivo de `src/`): tudo em `src/` vai para o navegador. Ele fica
// só nos secrets do servidor — ver `supabase/README.md`.
// ---------------------------------------------------------------------------

const env = (key: string) => {
  const v = (import.meta.env[key as keyof ImportMetaEnv] as string | undefined)?.trim()
  return v || undefined
}

/** Link de checkout de cada plano pago. */
export const CHECKOUT_LINKS: Record<string, string> = {
  bronze: env('VITE_MP_LINK_BRONZE') ?? 'https://mpago.la/2Af73pB',
  prata: env('VITE_MP_LINK_PRATA') ?? 'https://mpago.la/2Ko31QH',
  ouro: env('VITE_MP_LINK_OURO') ?? 'https://mpago.la/18CTFci',
}

/** Link de pagamento do plano, quando existir. */
export function checkoutUrl(planKey: string): string | undefined {
  return CHECKOUT_LINKS[planKey]
}

/**
 * E-mail de contato do plano Diamante (sob consulta). Defina
 * `VITE_CONTACT_EMAIL` no .env para habilitar o botão "Falar com a gente".
 */
export const CONTACT_EMAIL = env('VITE_CONTACT_EMAIL')
