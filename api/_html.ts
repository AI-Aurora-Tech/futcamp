// ---------------------------------------------------------------------------
// Ferramentas de injeção de metadados no HTML entregue ao robô.
//
// O `index.html` construído pelo Vite é o molde: ele já traz os scripts do app
// com os nomes de arquivo versionados, que só o build conhece. Em vez de
// remontar esse HTML na mão (e ter que adivinhar os nomes), as funções aqui
// pegam o molde pronto e trocam apenas as partes que mudam de página para
// página — título, descrição, canonical, Open Graph, dados estruturados e o
// bloco `<noscript>`.
// ---------------------------------------------------------------------------

/** Escapa texto que vai para dentro do HTML ou de um atributo. */
export function esc(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Serializa dados estruturados para dentro de um `<script>`.
 *
 * O `<` vira `\u003c` porque um nome de campeonato contendo `</script>` (ou
 * qualquer coisa parecida) encerraria o script ali e transformaria o resto em
 * HTML executável. É JSON válido dos dois lados.
 */
export function jsonLdSeguro(dados: unknown): string {
  return JSON.stringify(dados).replace(/</g, '\\u003c')
}

export function trocarTitulo(html: string, titulo: string): string {
  return html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(titulo)}</title>`)
}

export function trocarMetaNome(html: string, nome: string, valor: string): string {
  const re = new RegExp(`<meta\\s+name="${nome}"[\\s\\S]*?\\/?>`, 'i')
  const tag = `<meta name="${nome}" content="${esc(valor)}" />`
  return re.test(html) ? html.replace(re, tag) : html.replace('</head>', `    ${tag}\n  </head>`)
}

export function trocarMetaPropriedade(html: string, prop: string, valor: string): string {
  const re = new RegExp(`<meta\\s+property="${prop}"[\\s\\S]*?\\/?>`, 'i')
  const tag = `<meta property="${prop}" content="${esc(valor)}" />`
  return re.test(html) ? html.replace(re, tag) : html.replace('</head>', `    ${tag}\n  </head>`)
}

export function trocarCanonical(html: string, url: string): string {
  const re = /<link\s+rel="canonical"[\s\S]*?\/?>/i
  const tag = `<link rel="canonical" href="${esc(url)}" />`
  return re.test(html) ? html.replace(re, tag) : html.replace('</head>', `    ${tag}\n  </head>`)
}

/**
 * Substitui o bloco de dados estruturados da home pelo da página.
 *
 * O bloco da home descreve o produto Tabelaço (`SoftwareApplication` com os
 * preços, `FAQPage`). Deixá-lo numa página de campeonato seria descrever a
 * página errada — o Google usa dados estruturados para entender do que a
 * página trata, e dois assuntos concorrentes só atrapalham.
 */
export function trocarJsonLd(html: string, dados: unknown | null): string {
  const re = /<script type="application\/ld\+json" id="ld-site">[\s\S]*?<\/script>/
  if (dados === null) return html
  return html.replace(
    re,
    `<script type="application/ld+json" id="ld-site">${jsonLdSeguro(dados)}</script>`,
  )
}

/**
 * Substitui o conteúdo do `<noscript>`.
 *
 * É o único texto legível no HTML cru — o app só aparece depois que o
 * JavaScript roda. O Google executa JavaScript, mas o primeiro passe de
 * indexação lê o HTML como veio, e o robô do WhatsApp, do Facebook e a maioria
 * dos outros não executa nada.
 */
export function trocarNoscript(html: string, conteudo: string): string {
  return html.replace(/<noscript>[\s\S]*?<\/noscript>/, `<noscript>${conteudo}</noscript>`)
}
