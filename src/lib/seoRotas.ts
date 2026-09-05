// ---------------------------------------------------------------------------
// O que cada rota diz ao Google e aos cards de compartilhamento.
//
// Separado de `seo.ts` (que só sabe mexer no `<head>`) para que o texto de cada
// página fique num lugar só, legível, sem se misturar com manipulação de DOM.
// ---------------------------------------------------------------------------

import type { Route } from './router'
import type { SeoMeta } from './seo'
import { SITE_URL } from './seo'
import { FORMAT_LABELS, SPORT_LABELS, type Championship, type Match, type Team } from '../types'

/** Metadados das páginas fixas. Espelhado em `api/render.ts`. */
export function metaDaRota(route: Route): SeoMeta {
  switch (route.kind) {
    case 'planos':
      return {
        path: '/planos',
        title: 'Planos e preços — Tabelaço | A partir de R$ 0',
        description:
          'Compare os planos do Tabelaço: Grátis com 1 campeonato e até 8 equipes, Bronze R$ 59,90, Prata R$ 79,90, Ouro R$ 109,90 por campeonato e Diamante R$ 200,00/mês com campeonatos ilimitados. Sem cartão para começar.',
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}/` },
            { '@type': 'ListItem', position: 2, name: 'Planos e preços', item: `${SITE_URL}/planos` },
          ],
        },
      }

    case 'como-usar':
      return {
        path: '/como-usar',
        title: 'Como usar o Tabelaço — guia do organizador, do time e do mesário',
        description:
          'Passo a passo para criar o campeonato, gerar a tabela de jogos, inscrever times por link, preencher a súmula digital e acompanhar a classificação. Guia para organizador, responsável de time e mesário.',
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}/` },
            { '@type': 'ListItem', position: 2, name: 'Como usar', item: `${SITE_URL}/como-usar` },
          ],
        },
      }

    case 'instalar':
      return {
        path: '/instalar',
        title: 'Instalar o Tabelaço no celular — Android e iPhone, sem loja',
        description:
          'Como adicionar o Tabelaço à tela de início do Android e do iPhone. Funciona como aplicativo, sem passar por loja e sem ocupar espaço.',
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}/` },
            { '@type': 'ListItem', position: 2, name: 'Instalar no celular', item: `${SITE_URL}/instalar` },
          ],
        },
      }

    // Enquanto o campeonato não carregou não dá para dizer nada de específico
    // sobre ele. Um título genérico agora é melhor do que herdar o da home, e
    // `metaDoCampeonato` substitui assim que os dados chegam.
    case 'campeonato':
      return {
        path: `/c/${route.id}`,
        title: 'Campeonato — Tabelaço',
        description: 'Tabela de jogos, classificação, artilharia e resultados do campeonato.',
        jsonLd: null,
      }

    // Páginas privadas: link de inscrição com token, portal do mesário e volta
    // do pagamento. Não têm o que ranquear e não devem aparecer em busca
    // nenhuma — indexar um link com token seria vazar o token.
    case 'time':
    case 'novo-time':
    case 'mesa':
    case 'pagamento':
      return {
        path: '/',
        title: 'Tabelaço',
        description: 'Gestão de campeonatos de futebol amador.',
        indexavel: false,
        jsonLd: null,
      }

    case 'home':
    default:
      return metaDaHome()
  }
}

/** Metadados da home — os mesmos que estão escritos no `index.html`. */
export function metaDaHome(): SeoMeta {
  return {
    path: '/',
    title: 'Tabelaço — Gestão de Campeonatos de Futebol Amador | Tabela, Classificação e Súmula',
    description:
      'Tabelaço é a plataforma gratuita para organizar campeonatos de futebol amador: gere a tabela de jogos, classificação automática, artilharia, súmula digital, inscrição de times por link e acompanhamento ao vivo. Crie seu campeonato em minutos.',
    jsonLd: null,
  }
}

/**
 * Metadados da página pública de um campeonato, com os dados reais.
 *
 * É a rota que mais ganha com isso: o título passa a ser o nome do campeonato
 * (que é exatamente o que a pessoa digita na busca) e o card do WhatsApp deixa
 * de ser o genérico do Tabelaço.
 */
export function metaDoCampeonato(champ: Championship, teams: Team[], matches: Match[]): SeoMeta {
  const temporada = champ.season ? ` ${champ.season}` : ''
  const jogosFeitos = matches.filter((m) => m.status === 'finished').length

  const partes = [
    `${SPORT_LABELS[champ.sport]} · ${FORMAT_LABELS[champ.format]}`,
    `${teams.length} ${teams.length === 1 ? 'equipe' : 'equipes'}`,
    matches.length > 0 ? `${jogosFeitos} de ${matches.length} jogos realizados` : null,
  ].filter(Boolean)

  const description = champ.description?.trim()
    ? `${champ.description.trim().slice(0, 150)} — tabela, classificação e artilharia no Tabelaço.`
    : `Tabela de jogos, classificação, artilharia e resultados do ${champ.name}${temporada}. ${partes.join(' · ')}. Acompanhe ao vivo no Tabelaço.`

  return {
    path: `/c/${champ.id}`,
    title: `${champ.name}${temporada} — tabela, classificação e artilharia | Tabelaço`,
    description,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'SportsEvent',
      name: `${champ.name}${temporada}`.trim(),
      url: `${SITE_URL}/c/${champ.id}`,
      inLanguage: 'pt-BR',
      sport: SPORT_LABELS[champ.sport],
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      description,
      organizer: { '@type': 'Organization', name: 'Tabelaço', url: `${SITE_URL}/` },
      ...datasDoCampeonato(matches),
      competitor: teams.slice(0, 50).map((t) => ({ '@type': 'SportsTeam', name: t.name })),
    },
  }
}

/**
 * `startDate`/`endDate` a partir dos jogos agendados.
 *
 * O Schema.org exige `startDate` em `SportsEvent`; sem jogo com data marcada
 * não há o que declarar, e é melhor omitir do que inventar — data errada em
 * dado estruturado é motivo de o Google descartar o bloco inteiro.
 */
function datasDoCampeonato(matches: Match[]): Record<string, string> {
  const datas = matches
    .map((m) => m.scheduledAt)
    .filter((d): d is string => Boolean(d))
    .sort()
  if (datas.length === 0) return {}
  return { startDate: datas[0], endDate: datas[datas.length - 1] }
}
