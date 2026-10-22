/**
 * O texto de um erro, venha de onde vier.
 *
 * O Supabase devolve erros como objeto simples ({ message, details, hint,
 * code }), que NÃO é `instanceof Error`. Testar só `instanceof Error` jogava
 * fora a causa e mostrava uma mensagem genérica ("Erro ao salvar.").
 */
export function mensagemDoErro(err: unknown, padrao: string): string {
  if (err instanceof Error && err.message) return err.message
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; details?: unknown; code?: unknown }
    const msg = typeof e.message === 'string' ? e.message.trim() : ''
    if (msg) {
      // Recusa da política de acesso do banco: diz o que fazer, não o jargão.
      if (e.code === '42501' || /row-level security/i.test(msg)) {
        return 'Sem permissão para alterar este campeonato. Entre com a conta do organizador.'
      }
      const det = typeof e.details === 'string' ? e.details.trim() : ''
      return det && !msg.includes(det) ? `${msg} (${det})` : msg
    }
  }
  if (typeof err === 'string' && err.trim()) return err
  return padrao
}
