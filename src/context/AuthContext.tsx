import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  authMode,
  getCurrentOrganizer,
  signIn as apiSignIn,
  signInDemo,
  signOut as apiSignOut,
  signUp as apiSignUp,
  type Organizer,
} from '../services/auth'
import { isMasterUser } from '../services/masters'

interface AuthContextValue {
  organizer: Organizer | null
  loading: boolean
  mode: 'supabase' | 'demo'
  /** Administrador master: administra e exclui qualquer campeonato. */
  isMaster: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signUp: (name: string, email: string, password: string) => Promise<string | null>
  enterDemo: () => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [organizer, setOrganizer] = useState<Organizer | null>(null)
  const [loading, setLoading] = useState(true)
  const [isMaster, setIsMaster] = useState(false)

  useEffect(() => {
    let active = true
    getCurrentOrganizer()
      .then((o) => active && setOrganizer(o))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  // Reavalia o papel de master sempre que a sessão muda.
  useEffect(() => {
    let active = true
    if (!organizer) {
      setIsMaster(false)
      return
    }
    isMasterUser(organizer)
      .then((m) => active && setIsMaster(m))
      .catch(() => active && setIsMaster(false))
    return () => {
      active = false
    }
  }, [organizer])

  const value = useMemo<AuthContextValue>(
    () => ({
      organizer,
      loading,
      mode: authMode,
      isMaster,
      async signIn(email, password) {
        const { organizer: org, error } = await apiSignIn(email, password)
        if (org) setOrganizer(org)
        return error
      },
      async signUp(name, email, password) {
        const { organizer: org, error } = await apiSignUp(name, email, password)
        if (org) setOrganizer(org)
        return error
      },
      enterDemo() {
        const { organizer: org } = signInDemo()
        setOrganizer(org)
      },
      async signOut() {
        await apiSignOut()
        setOrganizer(null)
        setIsMaster(false)
      },
    }),
    [organizer, loading, isMaster],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  return ctx
}
