// ---------------------------------------------------------------------------
// E-mail: a mesma regra que o banco aplica (`email_plausivel`, migration 0028).
//
// Deliberadamente frouxa. Ela barra o que claramente não é e-mail — o
// "leoes.fc" que os gestores usavam como usuário, espaços, duas arrobas — sem
// tentar reimplementar a RFC 5322, que rejeitaria endereços válidos de
// verdade. Quem confere se a caixa existe é o mundo real, no dia em que o
// gestor precisar receber alguma coisa.
// ---------------------------------------------------------------------------

const FORMATO = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i

/** Parece um e-mail? */
export function emailPlausivel(email: string | null | undefined): boolean {
  return FORMATO.test((email ?? '').trim())
}

/** Forma canônica do e-mail: sem espaços nas pontas e em minúsculas. */
export function normalizarEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}
