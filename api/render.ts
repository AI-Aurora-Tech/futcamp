// ---------------------------------------------------------------------------
// Entrega o HTML das rotas públicas já com os metadados e o conteúdo dentro.
//
// Antes, o `vercel.json` mandava toda rota para o `index.html` e o robô recebia
// sempre a mesma página: mesmo título, mesma descrição, e um corpo vazio à
// espera do JavaScript. O Google até executa JavaScript, mas o primeiro passe
// de indexação lê o HTML como veio — e o robô do WhatsApp, do Facebook, do
// LinkedIn e do X não executa nada. Resultado: a página pública de um
// campeonato virava um card genérico do Tabelaço.
//
// Esta função pega o `index.html` construído pelo Vite (que já tem os scripts
// do app com os nomes versionados), troca o que é próprio da rota e devolve.
// O app continua sendo o mesmo — quando o JavaScript carrega, ele assume a
// página normalmente. Não é conteúdo diferente para robô: é a mesma página,
// legível antes de o JavaScript rodar.
//
// ⚠️ Os textos das páginas fixas estão espelhados em `src/lib/seoRotas.ts`.
// Mudou aqui, mude lá.
// ---------------------------------------------------------------------------

import {
  esc,
  trocarCanonical,
  trocarJsonLd,
  trocarMetaNome,
  trocarMetaPropriedade,
  trocarNoscript,
  trocarTitulo,
} from './_html'
import {
  buscarCampeonato,
  listarPartidas,
  listarTimes,
  type CampeonatoDb,
  type PartidaDb,
  type TimeDb,
} from './_dados'

const SITE_URL = (process.env.SITE_URL ?? 'https://tabelaco.app').replace(/\/$/, '')
const OG_IMAGE = `${SITE_URL}/og-image.png`

const ESPORTES: Record<string, string> = {
  futebol: 'Futebol de campo',
  futsal: 'Futsal',
  society: 'Society',
  volei: 'Vôlei',
  basquete: 'Basquete',
}

const FORMATOS: Record<string, string> = {
  league: 'Pontos corridos',
  groups_knockout: 'Grupos + mata-mata',
  knockout: 'Mata-mata',
}

type Pagina = {
  titulo: string
  descricao: string
  caminho: string
  indexavel?: boolean
  jsonLd: unknown | null
  /** Conteúdo legível do `<noscript>`, já em HTML escapado. */
  corpo: string
}

// ---------------------------------------------------------------------------
// Páginas fixas
// ---------------------------------------------------------------------------

function migalhas(nome: string, caminho: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: nome, item: `${SITE_URL}${caminho}` },
    ],
  }
}

function paginaPlanos(): Pagina {
  return {
    caminho: '/planos',
    titulo: 'Planos e preços — Tabelaço | A partir de R$ 0',
    descricao:
      'Compare os planos do Tabelaço: Grátis com 1 campeonato e até 8 equipes, Bronze R$ 59,90, Prata R$ 79,90, Ouro R$ 109,90 por campeonato e Diamante R$ 200,00/mês com campeonatos ilimitados. Sem cartão para começar.',
    jsonLd: migalhas('Planos e preços', '/planos'),
    corpo: envolver(`
      <h1>Planos e preços do Tabelaço</h1>
      <p>Todos os planos têm as mesmas funcionalidades. O que muda é quantos campeonatos, categorias e equipes cabem.</p>
      <ul>
        <li><strong>Grátis</strong> — 1 campeonato, 1 categoria, até 8 equipes. Sem cartão e sem prazo.</li>
        <li><strong>Bronze — R$ 59,90</strong> por campeonato, até 16 equipes por categoria.</li>
        <li><strong>Prata — R$ 79,90</strong> por campeonato, até 32 equipes por categoria.</li>
        <li><strong>Ouro — R$ 109,90</strong> por campeonato, equipes ilimitadas por categoria.</li>
        <li><strong>Diamante — R$ 200,00/mês</strong>, campeonatos, categorias e equipes ilimitados.</li>
      </ul>
      <p><a href="/">Início</a> · <a href="/como-usar">Como usar</a> · <a href="/instalar">Instalar no celular</a></p>
    `),
  }
}

function paginaComoUsar(): Pagina {
  return {
    caminho: '/como-usar',
    titulo: 'Como usar o Tabelaço — guia do organizador, do time e do mesário',
    descricao:
      'Passo a passo para criar o campeonato, gerar a tabela de jogos, inscrever times por link, preencher a súmula digital e acompanhar a classificação. Guia para organizador, responsável de time e mesário.',
    jsonLd: migalhas('Como usar', '/como-usar'),
    corpo: envolver(`
      <h1>Como usar o Tabelaço</h1>
      <p>O guia tem três partes, uma para cada pessoa envolvida no campeonato.</p>
      <h2>Organizador</h2>
      <p>Cria o campeonato, define categorias e forma de disputa, gera a tabela de jogos, envia os links de inscrição para os times e acompanha a classificação a cada rodada.</p>
      <h2>Responsável do time</h2>
      <p>Recebe um link, cria o acesso do time, monta o escudo, inscreve os atletas e escala a equipe antes de cada partida.</p>
      <h2>Mesário</h2>
      <p>Recebe o link do portal da mesa e uma senha, e lança gols, cartões, substituições e presença direto na súmula digital.</p>
      <p><a href="/">Início</a> · <a href="/planos">Planos e preços</a> · <a href="/instalar">Instalar no celular</a></p>
    `),
  }
}

function paginaInstalar(): Pagina {
  return {
    caminho: '/instalar',
    titulo: 'Instalar o Tabelaço no celular — Android e iPhone, sem loja',
    descricao:
      'Como adicionar o Tabelaço à tela de início do Android e do iPhone. Funciona como aplicativo, sem passar por loja e sem ocupar espaço.',
    jsonLd: migalhas('Instalar no celular', '/instalar'),
    corpo: envolver(`
      <h1>Instalar o Tabelaço no celular</h1>
      <p>O Tabelaço roda no navegador e pode ser adicionado à tela de início como aplicativo — sem loja e praticamente sem ocupar espaço.</p>
      <h2>Android</h2>
      <p>Abra o site no Chrome, toque no menu e escolha "Instalar aplicativo" ou "Adicionar à tela inicial".</p>
      <h2>iPhone</h2>
      <p>Abra o site no Safari, toque no botão de compartilhar e escolha "Adicionar à Tela de Início".</p>
      <p><a href="/">Início</a> · <a href="/planos">Planos e preços</a> · <a href="/como-usar">Como usar</a></p>
    `),
  }
}

// ---------------------------------------------------------------------------
// Página pública de um campeonato
// ---------------------------------------------------------------------------

function paginaCampeonato(champ: CampeonatoDb, times: TimeDb[], partidas: PartidaDb[]): Pagina {
  const temporada = champ.season ? ` ${champ.season}` : ''
  const nomeCompleto = `${champ.name}${temporada}`
  const esporte = ESPORTES[champ.sport] ?? 'Futebol'
  const formato = FORMATOS[champ.format] ?? 'Pontos corridos'
  const realizados = partidas.filter((p) => p.status === 'finished').length

  const resumo = [
    `${esporte} · ${formato}`,
    `${times.length} ${times.length === 1 ? 'equipe' : 'equipes'}`,
    partidas.length > 0 ? `${realizados} de ${partidas.length} jogos realizados` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const descricao = champ.description?.trim()
    ? `${champ.description.trim().slice(0, 150)} — tabela, classificação e artilharia no Tabelaço.`
    : `Tabela de jogos, classificação, artilharia e resultados do ${nomeCompleto}. ${resumo}. Acompanhe ao vivo no Tabelaço.`

  const datas = partidas
    .map((p) => p.scheduled_at)
    .filter((d): d is string => Boolean(d))
    .sort()

  const nomePorTime = new Map(times.map((t) => [t.id, t.name]))
  const ultimos = partidas
    .filter((p) => p.status === 'finished' && p.home_team_id && p.away_team_id)
    .slice(-10)
    .map(
      (p) =>
        `<li>${esc(nomePorTime.get(p.home_team_id!) ?? 'A definir')} ${p.home_score ?? 0} × ${p.away_score ?? 0} ${esc(nomePorTime.get(p.away_team_id!) ?? 'A definir')}</li>`,
    )
    .join('')

  const proximos = partidas
    .filter((p) => p.status !== 'finished' && p.home_team_id && p.away_team_id)
    .slice(0, 10)
    .map((p) => {
      const quando = p.scheduled_at ? ` — ${dataLegivel(p.scheduled_at)}` : ''
      return `<li>${esc(nomePorTime.get(p.home_team_id!) ?? 'A definir')} × ${esc(nomePorTime.get(p.away_team_id!) ?? 'A definir')}${quando}</li>`
    })
    .join('')

  return {
    caminho: `/c/${champ.id}`,
    titulo: `${nomeCompleto} — tabela, classificação e artilharia | Tabelaço`,
    descricao,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'SportsEvent',
      name: nomeCompleto,
      url: `${SITE_URL}/c/${champ.id}`,
      inLanguage: 'pt-BR',
      sport: esporte,
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      description: descricao,
      organizer: { '@type': 'Organization', name: 'Tabelaço', url: `${SITE_URL}/` },
      ...(datas.length > 0 ? { startDate: datas[0], endDate: datas[datas.length - 1] } : {}),
      competitor: times.slice(0, 50).map((t) => ({ '@type': 'SportsTeam', name: t.name })),
    },
    corpo: envolver(`
      <h1>${esc(nomeCompleto)}</h1>
      <p>${esc(resumo)}</p>
      ${champ.description?.trim() ? `<p>${esc(champ.description.trim())}</p>` : ''}
      ${times.length > 0 ? `<h2>Equipes</h2><ul>${times.map((t) => `<li>${esc(t.name)}</li>`).join('')}</ul>` : ''}
      ${ultimos ? `<h2>Últimos resultados</h2><ul>${ultimos}</ul>` : ''}
      ${proximos ? `<h2>Próximos jogos</h2><ul>${proximos}</ul>` : ''}
      <p>Classificação, artilharia e súmula completas no <a href="/">Tabelaço</a>.</p>
    `),
  }
}

/** Página do campeonato que não existe. Responde 404 de verdade. */
function paginaNaoEncontrada(): Pagina {
  return {
    caminho: '/',
    titulo: 'Campeonato não encontrado — Tabelaço',
    descricao: 'O link pode estar incorreto ou o campeonato foi removido.',
    indexavel: false,
    jsonLd: null,
    corpo: envolver(`
      <h1>Campeonato não encontrado</h1>
      <p>O link pode estar incorreto ou o campeonato foi removido.</p>
      <p><a href="/">Ir para o início do Tabelaço</a></p>
    `),
  }
}

// ---------------------------------------------------------------------------

function dataLegivel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' })
}

/** Mesma moldura visual do `<noscript>` original — é o que a pessoa vê sem JavaScript. */
function envolver(interno: string): string {
  return `<div style="max-width:44rem;margin:0 auto;padding:2.5rem 1.5rem;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#0f172a">${interno}
        <p style="padding:1rem;background:#f1f5f9;border-radius:8px;color:#334155">
          <strong>Este site precisa de JavaScript para funcionar.</strong>
          Ative o JavaScript no seu navegador para ver a página completa.
        </p>
      </div>`
}

/**
 * O `index.html` construído, guardado entre invocações.
 *
 * Buscado do próprio domínio: `/index.html` é um arquivo estático de verdade, e
 * a Vercel serve arquivo existente antes de aplicar `rewrites` — então não há
 * risco de a busca voltar para esta mesma função. Em lambda quente a busca não
 * se repete.
 */
let moldeEmCache: { html: string; em: number } | null = null
const VALIDADE_MOLDE_MS = 5 * 60 * 1000

async function buscarMolde(host: string, protocolo: string): Promise<string | null> {
  if (moldeEmCache && Date.now() - moldeEmCache.em < VALIDADE_MOLDE_MS) return moldeEmCache.html
  try {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 3000)
    const resposta = await fetch(`${protocolo}://${host}/index.html`, { signal: abort.signal })
    clearTimeout(timer)
    if (!resposta.ok) return null
    const html = await resposta.text()
    moldeEmCache = { html, em: Date.now() }
    return html
  } catch {
    return null
  }
}

function montar(molde: string, pagina: Pagina): string {
  const canonical = `${SITE_URL}${pagina.caminho}`
  const indexavel = pagina.indexavel !== false

  let html = trocarTitulo(molde, pagina.titulo)
  html = trocarMetaNome(html, 'description', pagina.descricao)
  html = trocarMetaNome(html, 'robots', indexavel ? 'index, follow, max-image-preview:large' : 'noindex, nofollow')
  html = trocarCanonical(html, canonical)
  html = trocarMetaPropriedade(html, 'og:title', pagina.titulo)
  html = trocarMetaPropriedade(html, 'og:description', pagina.descricao)
  html = trocarMetaPropriedade(html, 'og:url', canonical)
  html = trocarMetaPropriedade(html, 'og:image', OG_IMAGE)
  html = trocarMetaNome(html, 'twitter:title', pagina.titulo)
  html = trocarMetaNome(html, 'twitter:description', pagina.descricao)
  html = trocarJsonLd(html, pagina.jsonLd)
  html = trocarNoscript(html, pagina.corpo)
  return html
}

type Req = { query: Record<string, string | string[] | undefined>; headers: Record<string, string | string[] | undefined> }
type Res = {
  status(codigo: number): Res
  setHeader(nome: string, valor: string): void
  send(corpo: string): void
  redirect(codigo: number, destino: string): void
}

export default async function handler(req: Req, res: Res): Promise<void> {
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const rota = um(req.query.rota) ?? 'home'
  const id = um(req.query.id) ?? ''
  const host = um(req.headers['x-forwarded-host']) ?? um(req.headers.host) ?? ''
  const protocolo = um(req.headers['x-forwarded-proto']) ?? 'https'

  const molde = await buscarMolde(host, protocolo)
  if (!molde) {
    // Sem o molde não há como montar a página com os scripts corretos do app.
    // Devolver a home é melhor do que devolver erro: a pessoa chega no site.
    res.redirect(302, '/')
    return
  }

  let pagina: Pagina
  let codigo = 200

  if (rota === 'campeonato') {
    const champ = await buscarCampeonato(id)
    if (champ) {
      const [times, partidas] = await Promise.all([listarTimes(id), listarPartidas(id)])
      pagina = paginaCampeonato(champ, times, partidas)
    } else {
      // Sem o campeonato — apagado, id errado, ou banco fora do ar. Um 404 aqui
      // evita que o Google acumule "páginas" idênticas e sem conteúdo, que é o
      // que ele chama de soft 404 e conta contra o site inteiro.
      pagina = paginaNaoEncontrada()
      codigo = 404
    }
  } else if (rota === 'planos') {
    pagina = paginaPlanos()
  } else if (rota === 'como-usar') {
    pagina = paginaComoUsar()
  } else if (rota === 'instalar') {
    pagina = paginaInstalar()
  } else {
    res.redirect(302, '/')
    return
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  // Cache na borda da Vercel: o robô e as pessoas pegam a página pronta sem
  // acordar a função. `stale-while-revalidate` serve a versão guardada
  // enquanto a nova é montada em segundo plano.
  res.setHeader(
    'Cache-Control',
    codigo === 200
      ? 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600'
      : 'public, max-age=0, s-maxage=60',
  )
  res.status(codigo).send(montar(molde, pagina))
}
