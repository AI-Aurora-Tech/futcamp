// ---------------------------------------------------------------------------
// WhatsApp — o canal de contato do Tabelaço.
//
// `wa.me` resolve os dois casos sem gambiarra: no celular abre o aplicativo,
// no computador abre o WhatsApp Web. O número vai com o código do país (55) e
// só dígitos — é o formato que o link exige.
//
// Um número só, num lugar só: o consultor do plano Diamante e o suporte são a
// mesma pessoa. Trocar sem mexer no código: `VITE_WHATSAPP` no .env.
// ---------------------------------------------------------------------------

/** Número em dígitos, com DDI. Vazio desliga todos os links de WhatsApp. */
export const WHATSAPP_NUMERO =
  ((import.meta.env.VITE_WHATSAPP as string | undefined) ?? '5511992835438').replace(/\D/g, '')

/**
 * Monta o link com a mensagem já escrita.
 *
 * A mensagem pronta não é enfeite: ela diz de onde a pessoa veio. Quem recebe
 * "Olá, preciso de ajuda" não sabe se é um organizador com o pagamento preso
 * ou um time que perdeu a senha.
 */
export function linkWhatsapp(mensagem: string): string {
  if (!WHATSAPP_NUMERO) return ''
  return `https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent(mensagem)}`
}

/** Suporte geral do app. */
export const LINK_SUPORTE = linkWhatsapp(
  'Olá! Preciso de ajuda com o Tabelaço.',
)

/** Suporte a partir do portal do time (a dúvida quase sempre é a inscrição). */
export const LINK_SUPORTE_TIME = linkWhatsapp(
  'Olá! Sou responsável por um time no Tabelaço e preciso de ajuda.',
)

/** Suporte a partir da tela de cobrança — a dúvida é sempre a mesma. */
export const LINK_SUPORTE_PAGAMENTO = linkWhatsapp(
  'Olá! Paguei meu campeonato no Tabelaço e ele ainda não foi liberado.',
)

/** Consultor do plano Diamante, cujo preço é negociado. */
export const LINK_DIAMANTE = linkWhatsapp(
  'Olá! Vi o plano Diamante no Tabelaço e gostaria de falar com um consultor.',
)

/** O contato está configurado? */
export const temWhatsapp = Boolean(WHATSAPP_NUMERO)
