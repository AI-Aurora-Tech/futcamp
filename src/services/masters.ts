import { authMode, type Organizer } from './auth'
import { supabase } from '../lib/supabase'
import { isMasterEmail } from '../lib/roles'

/**
 * O organizador logado é o administrador master?
 *
 * Verifica a lista de e-mails (`VITE_MASTER_ADMINS`) e, no modo Supabase, a
 * tabela `master_admins` — cuja RLS só devolve a própria linha, então a
 * simples existência de um registro já responde à pergunta.
 */
export async function isMasterUser(organizer: Organizer | null): Promise<boolean> {
  if (!organizer) return false
  if (isMasterEmail(organizer.email)) return true
  if (authMode === 'supabase' && supabase) {
    const { data, error } = await supabase.from('master_admins').select('id').limit(1)
    if (error) {
      // Migration 0015 ainda não aplicada — não quebra o app.
      console.warn('master_admins indisponível:', error.message)
      return false
    }
    return (data ?? []).length > 0
  }
  return false
}
