import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { ensureSeed } from './demo'

export interface Organizer {
  id: string
  email: string
  name: string
}

export const authMode: 'supabase' | 'demo' = isSupabaseConfigured ? 'supabase' : 'demo'

const DEMO_KEY = 'futcamp:organizer'
const DEMO_ID = 'demo-organizer'

interface AuthResult {
  organizer: Organizer | null
  error: string | null
}

function nameFromEmail(email: string): string {
  const handle = email.split('@')[0] ?? email
  return handle.charAt(0).toUpperCase() + handle.slice(1)
}

/** Cadastra um novo organizador. */
export async function signUp(
  name: string,
  email: string,
  password: string,
): Promise<AuthResult> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { name: name.trim() } },
    })
    if (error) return { organizer: null, error: error.message }
    const user = data.user
    if (!user) {
      return {
        organizer: null,
        error: 'Confirme seu e-mail para ativar a conta e depois faça login.',
      }
    }
    return {
      organizer: { id: user.id, email: user.email ?? email, name: name.trim() },
      error: null,
    }
  }

  // Modo demo — cadastro é apenas simbólico.
  return signInDemo(name.trim() || nameFromEmail(email), email)
}

/** Autentica um organizador existente. */
export async function signIn(email: string, password: string): Promise<AuthResult> {
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error || !data.user) {
      return { organizer: null, error: error?.message ?? 'Falha na autenticação.' }
    }
    const mail = data.user.email ?? email
    return {
      organizer: {
        id: data.user.id,
        email: mail,
        name: (data.user.user_metadata?.name as string) || nameFromEmail(mail),
      },
      error: null,
    }
  }

  return signInDemo(nameFromEmail(email), email)
}

/** Entra imediatamente no modo demo (sem senha), semeando dados de exemplo. */
export function signInDemo(name = 'Organizador Demo', email = 'demo@tabelaco.app'): AuthResult {
  const org: Organizer = { id: DEMO_ID, email, name }
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(org))
  } catch {
    /* ignore */
  }
  ensureSeed(DEMO_ID)
  return { organizer: org, error: null }
}

export async function signOut(): Promise<void> {
  if (authMode === 'supabase' && supabase) {
    await supabase.auth.signOut()
    return
  }
  try {
    localStorage.removeItem(DEMO_KEY)
  } catch {
    /* ignore */
  }
}

/** Recupera a sessão atual (se houver). */
export async function getCurrentOrganizer(): Promise<Organizer | null> {
  if (authMode === 'supabase' && supabase) {
    const { data } = await supabase.auth.getSession()
    const user = data.session?.user
    if (!user) return null
    const email = user.email ?? ''
    return {
      id: user.id,
      email,
      name: (user.user_metadata?.name as string) || nameFromEmail(email),
    }
  }
  try {
    const raw = localStorage.getItem(DEMO_KEY)
    return raw ? (JSON.parse(raw) as Organizer) : null
  } catch {
    return null
  }
}
