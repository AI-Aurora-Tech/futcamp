// ---------------------------------------------------------------------------
// sitemap.xml gerado a partir do banco.
//
// O sitemap estático que existia aqui tinha uma URL só — a home — porque com
// rotas por hash não havia mais nada que o Google pudesse visitar. Agora que
// cada campeonato tem caminho próprio (`/c/<id>`), o sitemap lista todos eles:
// é o que faz o Google descobrir páginas que ninguém linka de fora.
// ---------------------------------------------------------------------------

import { listarCampeonatosPublicos } from './_dados'

const SITE_URL = (process.env.SITE_URL ?? 'https://tabelaco.app').replace(/\/$/, '')

/** Páginas fixas. A data é a do deploy: é quando o conteúdo delas pode ter mudado. */
const PAGINAS_FIXAS: { caminho: string; prioridade: string; frequencia: string }[] = [
  { caminho: '/', prioridade: '1.0', frequencia: 'weekly' },
  { caminho: '/planos', prioridade: '0.8', frequencia: 'monthly' },
  { caminho: '/como-usar', prioridade: '0.7', frequencia: 'monthly' },
  { caminho: '/instalar', prioridade: '0.5', frequencia: 'yearly' },
]

function url(caminho: string, prioridade: string, frequencia: string, lastmod?: string): string {
  return [
    '  <url>',
    `    <loc>${SITE_URL}${caminho}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
    `    <changefreq>${frequencia}</changefreq>`,
    `    <priority>${prioridade}</priority>`,
    '  </url>',
  ]
    .filter(Boolean)
    .join('\n')
}

type Res = {
  status(codigo: number): Res
  setHeader(nome: string, valor: string): void
  send(corpo: string): void
}

export default async function handler(_req: unknown, res: Res): Promise<void> {
  const hoje = new Date().toISOString().slice(0, 10)

  const entradas = PAGINAS_FIXAS.map((p) => url(p.caminho, p.prioridade, p.frequencia, hoje))

  // Se o banco não responder, o sitemap sai só com as páginas fixas. Melhor um
  // sitemap menor do que um erro: erro repetido faz o Google parar de buscá-lo.
  const campeonatos = await listarCampeonatosPublicos()
  for (const c of campeonatos) {
    // Sem `lastmod` de propósito: a tabela `championships` só guarda a data de
    // criação, e o conteúdo que muda (resultados, classificação) está em outras
    // tabelas. Declarar a data de criação como "última modificação" seria dizer
    // ao Google que a página nunca mudou — o contrário do que acontece.
    entradas.push(url(`/c/${c.id}`, c.status === 'active' ? '0.9' : '0.6', c.status === 'active' ? 'daily' : 'monthly'))
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entradas.join('\n')}
</urlset>
`

  res.setHeader('Content-Type', 'application/xml; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')
  res.status(200).send(xml)
}
