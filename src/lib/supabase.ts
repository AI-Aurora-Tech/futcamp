import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/**
 * Verdadeiro quando as credenciais do Supabase estão configuradas.
 * Quando falso, o FutCamp opera em "modo demo" (dados locais no navegador +
 * login mock), permitindo experimentar o app sem backend.
 */
export const isSupabaseConfigured = Boolean(url && anonKey)

/**
 * Cliente Supabase compartilhado. É `null` no modo demo — sempre verifique
 * `isSupabaseConfigured` (ou use os serviços em src/services, que já tratam
 * o fallback) antes de acessá-lo.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null
