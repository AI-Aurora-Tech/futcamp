// ---------------------------------------------------------------------------
// Contato dos planos sob consulta.
//
// A cobrança dos planos pagos é feita pelo Asaas, dentro do app: o organizador
// escolhe o plano, cria o campeonato e a Edge Function `asaas-checkout` gera o
// link (ver src/services/payments.ts). Não existe link fixo por plano — o
// valor depende do número de categorias.
//
// ⚠️ A chave de API do Asaas NUNCA entra aqui (nem em qualquer arquivo de
// `src/`): tudo daqui vai para o navegador. Ela é secret de servidor:
//   supabase secrets set ASAAS_API_KEY="$aact_..."
// ---------------------------------------------------------------------------

const env = (k: string): string | undefined => {
  const v = (import.meta.env as Record<string, string | undefined>)[k]
  return v && v.trim() ? v.trim() : undefined
}

/**
 * E-mail de contato do plano Diamante (sob consulta). Defina
 * `VITE_CONTACT_EMAIL` no .env para habilitar o botão "Falar com a gente".
 */
export const CONTACT_EMAIL = env('VITE_CONTACT_EMAIL')
