// ---------------------------------------------------------------------------
// Metadados por rota (title, description, canonical, Open Graph, JSON-LD).
//
// O `index.html` traz os metadados da home. Como o app é uma SPA, sem este
// módulo TODA rota herdaria o título e a descrição da home — inclusive a
// página pública de um campeonato, que é justamente a que tem conteúdo próprio
// para ranquear e para virar um card decente quando alguém manda o link no
// WhatsApp.
//
// O servidor (`api/render.ts`) já entrega esses mesmos metadados no HTML cru,
// para o robô que não executa JavaScript. Aqui é a versão do navegador: mantém
// tudo correto enquanto a pessoa navega sem recarregar a página.
//
// ⚠️ As descrições das páginas fixas estão espelhadas em `api/render.ts`.
// Mudou aqui, mude lá.
// ---------------------------------------------------------------------------

/** Domínio canônico. O canonical precisa apontar sempre para a produção — nunca
 *  para a URL de preview da Vercel, senão o Google indexa o preview. */
export const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, '') ?? 'https://tabelaco.app'

const OG_IMAGE_PADRAO = `${SITE_URL}/og-image.png`

export type SeoMeta = {
  title: string
  description: string
  /** Caminho canônico, começando com "/". */
  path: string
  /** `false` em páginas privadas (links de inscrição, portal do mesário, retorno de pagamento). */
  indexavel?: boolean
  image?: string
  /** JSON-LD específico da página. Substitui o bloco da home. */
  jsonLd?: Record<string, unknown> | null
}

const ID_JSON_LD_ROTA = 'ld-rota'
const ID_JSON_LD_SITE = 'ld-site'

/** Conteúdo original do bloco de dados estruturados da home, guardado no
 *  carregamento do módulo para poder voltar quando a pessoa navega de volta. */
const jsonLdDaHome = document.getElementById(ID_JSON_LD_SITE)?.textContent ?? null

function setMeta(seletor: string, criar: () => HTMLMetaElement, conteudo: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(seletor)
  if (!el) {
    el = criar()
    document.head.appendChild(el)
  }
  el.setAttribute('content', conteudo)
}

function metaPorNome(nome: string, conteudo: string): void {
  setMeta(`meta[name="${nome}"]`, () => {
    const el = document.createElement('meta')
    el.setAttribute('name', nome)
    return el
  }, conteudo)
}

function metaPorPropriedade(prop: string, conteudo: string): void {
  setMeta(`meta[property="${prop}"]`, () => {
    const el = document.createElement('meta')
    el.setAttribute('property', prop)
    return el
  }, conteudo)
}

/**
 * Aplica os metadados da rota atual ao `<head>`.
 *
 * Sobrescreve o que veio do `index.html` em vez de acumular: chamado de novo a
 * cada troca de rota, sempre deixa o `<head>` descrevendo só a página atual.
 */
export function applySeo(meta: SeoMeta): void {
  const canonical = `${SITE_URL}${meta.path === '/' ? '/' : meta.path}`
  const imagem = meta.image ?? OG_IMAGE_PADRAO
  const indexavel = meta.indexavel !== false

  document.title = meta.title
  metaPorNome('description', meta.description)
  metaPorNome('robots', indexavel ? 'index, follow, max-image-preview:large' : 'noindex, nofollow')

  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'canonical'
    document.head.appendChild(link)
  }
  link.href = canonical

  metaPorPropriedade('og:title', meta.title)
  metaPorPropriedade('og:description', meta.description)
  metaPorPropriedade('og:url', canonical)
  metaPorPropriedade('og:image', imagem)
  metaPorNome('twitter:title', meta.title)
  metaPorNome('twitter:description', meta.description)
  metaPorNome('twitter:image', imagem)

  aplicarJsonLd(meta.jsonLd ?? null)
}

/**
 * Troca o bloco de dados estruturados da página.
 *
 * O bloco do `index.html` (`#ld-site`) descreve a HOME — `SoftwareApplication`
 * com os preços e `FAQPage`. Repetir isso na página de um campeonato seria
 * descrever a página errada, então ele é REMOVIDO do documento e o da rota
 * entra no lugar. Remover, e não esconder: o Google lê `application/ld+json`
 * mesmo dentro de elemento com `hidden`, então esconder não adiantaria nada.
 */
function aplicarJsonLd(dados: Record<string, unknown> | null): void {
  document.getElementById(ID_JSON_LD_ROTA)?.remove()

  if (dados) {
    document.getElementById(ID_JSON_LD_SITE)?.remove()
    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.id = ID_JSON_LD_ROTA
    script.textContent = JSON.stringify(dados)
    document.head.appendChild(script)
    return
  }

  // De volta à home: recoloca o bloco original, se ele tiver saído.
  if (jsonLdDaHome && !document.getElementById(ID_JSON_LD_SITE)) {
    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.id = ID_JSON_LD_SITE
    script.textContent = jsonLdDaHome
    document.head.appendChild(script)
  }
}
