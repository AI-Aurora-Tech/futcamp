// ---------------------------------------------------------------------------
// Roteador do Tabelaço — rotas por CAMINHO (History API).
//
// Até aqui o app roteava pelo `location.hash` (`#/planos`, `#/c/<id>`). Para o
// navegador funcionava bem, mas para os buscadores era uma limitação de teto:
// o que vem depois do "#" nunca chega ao servidor, então o site inteiro era
// UMA única URL indexável — e as páginas públicas dos campeonatos, que são o
// conteúdo mais valioso que existe aqui, simplesmente não existiam para o
// Google nem para o robô do WhatsApp.
//
// Agora cada rota é um caminho de verdade (`/planos`, `/c/<id>`), servido pelo
// `vercel.json`. Os links antigos em `#/` continuam funcionando: `migrateLegacyHash`
// os converte para o caminho equivalente antes do primeiro render — importante
// porque já existem links `#/c/<id>` circulando em grupos de WhatsApp e nas
// notificações push gravadas no banco.
// ---------------------------------------------------------------------------

export type Route =
  | { kind: 'home' }
  | { kind: 'planos' }
  | { kind: 'instalar' }
  | { kind: 'como-usar' }
  | { kind: 'campeonato'; id: string }
  | { kind: 'time'; teamId: string; token: string }
  | { kind: 'novo-time'; championshipId: string; token: string }
  | { kind: 'pagamento'; championshipId: string; status: string | null }
  | { kind: 'mesa'; championshipId: string }

/** Evento disparado a cada navegação interna (o `popstate` só cobre voltar/avançar). */
const NAV_EVENT = 'tabelaco:navegou'

/**
 * Converte um caminho + query na rota correspondente.
 *
 * Aceita caminho com ou sem barra final. Qualquer coisa não reconhecida cai em
 * `home` — o app é uma SPA e não tem 404 próprio; o `vercel.json` é quem
 * responde 404 de verdade para caminhos que não existem.
 */
export function parseRoute(pathname: string, search: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/'
  const params = new URLSearchParams(search)

  if (path === '/' ) return { kind: 'home' }
  if (path === '/planos') return { kind: 'planos' }
  if (path === '/instalar') return { kind: 'instalar' }
  if (path === '/como-usar') return { kind: 'como-usar' }

  const campeonato = path.match(/^\/c\/([^/]+)$/)
  if (campeonato) return { kind: 'campeonato', id: decodeURIComponent(campeonato[1]) }

  const time = path.match(/^\/t\/([^/]+)$/)
  if (time) return { kind: 'time', teamId: decodeURIComponent(time[1]), token: params.get('k') ?? '' }

  const novoTime = path.match(/^\/novo-time\/([^/]+)$/)
  if (novoTime) {
    return {
      kind: 'novo-time',
      championshipId: decodeURIComponent(novoTime[1]),
      token: params.get('k') ?? '',
    }
  }

  const pagamento = path.match(/^\/pagamento\/([^/]+)$/)
  if (pagamento) {
    return {
      kind: 'pagamento',
      championshipId: decodeURIComponent(pagamento[1]),
      status: params.get('status'),
    }
  }

  const mesa = path.match(/^\/mesa\/([^/]+)$/)
  if (mesa) return { kind: 'mesa', championshipId: decodeURIComponent(mesa[1]) }

  return { kind: 'home' }
}

/** Rota atual, lida da barra de endereço. */
export function currentRoute(): Route {
  return parseRoute(window.location.pathname, window.location.search)
}

/** Caminho + query atuais, do jeito que aparecem na barra de endereço. */
export function currentPath(): string {
  return window.location.pathname + window.location.search
}

/**
 * Navega para um caminho interno sem recarregar a página.
 * `replace` troca a entrada atual do histórico em vez de empilhar uma nova.
 */
export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const destino = to.startsWith('/') ? to : `/${to}`
  if (destino === currentPath()) return
  if (options.replace) {
    window.history.replaceState(null, '', destino)
  } else {
    window.history.pushState(null, '', destino)
  }
  window.dispatchEvent(new Event(NAV_EVENT))
}

/**
 * Assina mudanças de rota (navegação interna + botões voltar/avançar).
 * Devolve a função de cancelamento.
 */
export function onRouteChange(handler: () => void): () => void {
  window.addEventListener('popstate', handler)
  window.addEventListener(NAV_EVENT, handler)
  return () => {
    window.removeEventListener('popstate', handler)
    window.removeEventListener(NAV_EVENT, handler)
  }
}

/**
 * Converte um link antigo `#/alguma-coisa` no caminho `/alguma-coisa`.
 * Devolve `null` quando o hash não é uma rota (âncora comum, hash vazio).
 */
export function legacyHashToPath(hash: string): string | null {
  if (!hash.startsWith('#/')) return null
  const semCerquilha = hash.slice(1)
  const [caminho, query] = semCerquilha.split('?')
  const limpo = caminho.replace(/\/+$/, '') || '/'
  return query ? `${limpo}?${query}` : limpo
}

/**
 * Reescreve a URL quando o usuário chega por um link antigo em `#/`.
 *
 * Roda uma vez, antes do primeiro render. Usa `replaceState` de propósito: o
 * link `#/` não deve ficar no histórico, senão o botão "voltar" devolve a
 * pessoa para ele e ela entra num laço.
 */
export function migrateLegacyHash(): void {
  const destino = legacyHashToPath(window.location.hash)
  if (!destino) return
  window.history.replaceState(null, '', destino)
}

/**
 * Faz os links internos (`<a href="/planos">`) navegarem pela History API em
 * vez de recarregar a página inteira.
 *
 * É um único ouvinte no documento em vez de um componente `<Link>`: mantém o
 * JSX das telas como está — `<a href="/planos">` continua sendo um link de
 * verdade, que abre em nova aba, aparece na barra de status e é seguido pelo
 * robô do Google. Cliques com Ctrl/Cmd/Shift, botão do meio, `target="_blank"`,
 * `download` e links externos passam direto para o navegador.
 */
export function installLinkInterceptor(): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented) return
    if (event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    const alvo = (event.target as HTMLElement | null)?.closest('a')
    if (!alvo) return
    if (alvo.target && alvo.target !== '_self') return
    if (alvo.hasAttribute('download')) return
    if (alvo.getAttribute('rel')?.includes('external')) return

    const href = alvo.getAttribute('href')
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return

    const url = new URL(alvo.href, window.location.origin)
    if (url.origin !== window.location.origin) return

    event.preventDefault()
    navigate(url.pathname + url.search)
  }

  document.addEventListener('click', onClick)
  return () => document.removeEventListener('click', onClick)
}
