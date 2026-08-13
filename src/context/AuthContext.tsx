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

interface AuthContextValue {
  organizer: Organizer | null
  loading: boolean
  mode: 'supabase' | 'demo'
  signIn: (email: string, password: string) => Promise<string | null>
  signUp: (name: string, email: string, password: string) => Promise<string | null>
  enterDemo: () => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [organizer, setOrganizer] = useState<Organizer | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    getCurrentOrganizer()
      .then((o) => active && setOrganizer(o))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      organizer,
      loading,
      mode: authMode,
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
      },
    }),
    [organizer, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  return ctx
}
