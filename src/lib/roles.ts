// ---------------------------------------------------------------------------
// Administrador MASTER.
//
// O master é o único perfil que enxerga e administra QUALQUER campeonato da
// plataforma — e o único que pode EXCLUIR um campeonato (nem mesmo o dono
// pode). Quem é master vem de duas fontes:
//
//   1. `VITE_MASTER_ADMINS` — lista de e-mails separados por vírgula (.env).
//   2. tabela `master_admins` no Supabase (migration 0015), que também é o que
//      garante a regra no banco, via RLS.
//
// No modo demo (sem Supabase) vale apenas a lista de e-mails: basta entrar com
// um e-mail da lista para administrar como master.
// ---------------------------------------------------------------------------

const RAW = (import.meta.env.VITE_MASTER_ADMINS as string | undefined) ?? 'master@tabelaco.app'

/** E-mails configurados como administradores master. */
export const MASTER_EMAILS: string[] = RAW.split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

/** O e-mail está na lista de administradores master? */
export function isMasterEmail(email?: string | null): boolean {
  if (!email) return false
  return MASTER_EMAILS.includes(email.trim().toLowerCase())
}
