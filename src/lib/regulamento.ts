// ---------------------------------------------------------------------------
// Regulamento do campeonato, montado a partir do que já está cadastrado.
//
// A ideia é que o organizador não precise redigir nada: as regras que ele
// escolheu no formulário (formato, pontuação, categorias, desempate, prazo de
// inscrição, atletas federados) viram um documento que os times podem baixar.
//
// Esta parte é só o TEXTO — pura e testável. Quem transforma em arquivo é o
// `src/lib/pdf.ts`.
// ---------------------------------------------------------------------------
import {
  AUDIENCE_LABELS,
  DEFAULT_TIEBREAKERS,
  FORMAT_LABELS,
  SPORT_LABELS,
  TIEBREAKER_LABELS,
  type Championship,
} from '../types'
import { textoRegra } from './federated'
import type { Linha } from './pdf'

/** Data por extenso, para o rodapé do documento. */
function dataLonga(iso?: string): string {
  const d = iso ? new Date(iso) : new Date()
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

function secao(titulo: string, itens: string[]): Linha[] {
  if (!itens.length) return []
  return [
    { texto: titulo, estilo: 'secao' },
    ...itens.map((texto): Linha => ({ texto: `• ${texto}`, estilo: 'item' })),
  ]
}

/** Descreve o formato da competição em uma frase que um leigo entende. */
export function descreverFormato(c: Championship): string {
  const nome = FORMAT_LABELS[c.format] ?? c.format
  if (c.format === 'league') {
    const turno = c.doubleRound ? 'turno e returno (todos se enfrentam duas vezes)' : 'turno único (todos se enfrentam uma vez)'
    const classificados = c.leagueQualifiers
      ? ` Os ${c.leagueQualifiers} primeiros avançam ao mata-mata.`
      : ''
    return `${nome}, em ${turno}.${classificados}`
  }
  if (c.format === 'knockout') {
    return `${nome}: quem perde está eliminado.${c.thirdPlace ? ' Há disputa de 3º lugar.' : ''}`
  }
  const grupos = c.numGroups ? `${c.numGroups} grupo(s)` : 'grupos'
  const porGrupo = c.teamsPerGroup ? ` de ${c.teamsPerGroup} equipes` : ''
  const avancam = c.advancePerGroup ? `, classificando ${c.advancePerGroup} por grupo` : ''
  return `${nome}: fase de ${grupos}${porGrupo}${avancam}, seguida de mata-mata.${c.thirdPlace ? ' Há disputa de 3º lugar.' : ''}`
}

/** Prazo de inscrição em texto. */
export function descreverPrazo(c: Championship): string {
  const h = c.registrationCutoffHours ?? 0
  if (!h) return 'As inscrições ficam abertas durante todo o campeonato.'
  return (
    `As inscrições de cada equipe se encerram ${h} hora(s) antes da sua próxima partida ` +
    'e reabrem automaticamente depois que o jogo é finalizado.'
  )
}

/** As categorias e suas regras de idade. */
export function descreverCategorias(c: Championship): string[] {
  return (c.categories ?? []).map((cat) => {
    if (!cat.birthYear) return `${cat.name}: sem restrição de idade.`
    if (cat.birthYearMode === 'min') {
      return `${cat.name}: nascidos em ${cat.birthYear} ou depois.`
    }
    const excecoes = cat.exceptions
      ? ` Até ${cat.exceptions} atleta(s) por equipe podem ser de ${cat.birthYear - 1}.`
      : ''
    return `${cat.name}: nascidos em ${cat.birthYear} ou antes.${excecoes}`
  })
}

/**
 * Monta as linhas do regulamento.
 *
 * O documento é declaradamente derivado do cadastro: se o organizador mudar
 * uma regra no app, o próximo download já sai diferente. É por isso que ele
 * traz a data de emissão — a versão importa.
 */
export function montarRegulamento(c: Championship, emitidoEm?: string): Linha[] {
  const linhas: Linha[] = [
    { texto: 'REGULAMENTO', estilo: 'titulo' },
    { texto: c.name, estilo: 'secao' },
    {
      texto: [SPORT_LABELS[c.sport], AUDIENCE_LABELS[c.audience], c.season]
        .filter(Boolean)
        .join(' · '),
      estilo: 'subtitulo',
    },
  ]

  if (c.description?.trim()) {
    linhas.push({ texto: c.description.trim(), estilo: 'corpo' })
  }

  linhas.push(
    ...secao('1. Da competição', [
      `Modalidade: ${SPORT_LABELS[c.sport]}.`,
      `Público: ${AUDIENCE_LABELS[c.audience]}.`,
      c.season ? `Temporada: ${c.season}.` : '',
      `Formato: ${descreverFormato(c)}`,
    ].filter(Boolean)),
  )

  linhas.push(
    ...secao('2. Das categorias', descreverCategorias(c).length
      ? descreverCategorias(c)
      : ['Categoria única, sem restrição de idade.']),
  )

  linhas.push(
    ...secao('3. Das inscrições', [
      descreverPrazo(c),
      'A inscrição é feita pelo responsável da equipe, pelo link enviado pelo organizador.',
      'São exigidos nome completo, CPF e data de nascimento de cada atleta.',
      'Um mesmo CPF não pode ser inscrito em duas equipes do mesmo campeonato.',
      ...(c.audience === 'infantil' ? [`Atletas federados: ${textoRegra(c)}`] : []),
    ]),
  )

  const pontos = [
    `Vitória: ${c.pointsWin ?? 3} ponto(s).`,
    `Empate: ${c.pointsDraw ?? 1} ponto(s).`,
    'Derrota: 0 ponto.',
  ]
  const criterios = (c.tiebreakers?.length ? c.tiebreakers : DEFAULT_TIEBREAKERS).map(
    (t, i) => `${i + 1}º) ${TIEBREAKER_LABELS[t] ?? t}`,
  )

  linhas.push(...secao('4. Da pontuação', pontos))
  linhas.push(
    { texto: '5. Dos critérios de desempate', estilo: 'secao' },
    {
      texto:
        'Em caso de igualdade de pontos, a classificação é decidida nesta ordem:',
      estilo: 'corpo',
    },
    ...criterios.map((texto): Linha => ({ texto: `• ${texto}`, estilo: 'item' })),
  )

  if (c.format !== 'league') {
    linhas.push(
      ...secao('6. Do mata-mata', [
        'Empate no tempo normal é decidido na disputa por pênaltis.',
        c.thirdPlace ? 'Há disputa de 3º lugar.' : 'Não há disputa de 3º lugar.',
      ]),
    )
  }

  linhas.push(
    ...secao('7. Das súmulas e resultados', [
      'A súmula de cada partida é preenchida pela mesa e fica disponível para as equipes.',
      'Gols, cartões e substituições registrados na súmula alimentam a classificação e as estatísticas.',
      'A classificação é atualizada automaticamente ao encerrar cada partida.',
    ]),
  )

  linhas.push(
    ...secao('8. Dos casos omissos', [
      'Os casos não previstos neste regulamento serão resolvidos pela organização do campeonato.',
    ]),
  )

  linhas.push({
    texto:
      `Documento gerado pelo Tabelaço em ${dataLonga(emitidoEm)}, a partir das informações ` +
      'cadastradas no campeonato. Alterações feitas depois desta data não constam aqui.',
    estilo: 'nota',
  })

  return linhas
}

/** Nome do arquivo, sem acentos nem espaços. */
export function nomeArquivoRegulamento(c: Championship): string {
  const base = (c.name ?? 'campeonato')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return `regulamento-${base || 'campeonato'}.pdf`
}
