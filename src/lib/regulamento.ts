// ---------------------------------------------------------------------------
// Regulamento do campeonato, montado a partir do que já está cadastrado.
//
// A ideia é que o organizador não precise redigir nada: as regras que ele
// escolheu no formulário (formato, pontuação, categorias, tempo de jogo,
// substituições, cartões, arbitragem, desempate, prazo de inscrição, atletas
// federados) viram um documento que os times podem baixar.
//
// Além disso, todo campeonato leva um bloco de cláusulas FIXAS — tolerância,
// troca de uniforme, bola de jogo, agressão, racismo. Elas não dependem do
// cadastro porque não são negociáveis: valem em qualquer competição da
// plataforma.
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
  type Category,
  type Championship,
} from '../types'
import { algumaPermite, textoRegra } from './federated'
import {
  descreverAmarelos,
  descreverArbitragem,
  descreverBanco,
  descreverExpulsao,
  descreverSubstituicoes,
  descreverTempo,
} from './regras'
import type { Linha } from './pdf'

/** Data por extenso, para o rodapé do documento. */
function dataLonga(iso?: string): string {
  const d = iso ? new Date(iso) : new Date()
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

/**
 * Uma seção do regulamento antes de virar linha.
 *
 * A numeração NÃO fica escrita no título: seções vazias somem, e um documento
 * que pula do "5" para o "7" faz o leitor procurar a página que falta.
 */
interface Secao {
  titulo: string
  intro?: string
  itens?: string[]
}

function renderizar(secoes: Secao[]): Linha[] {
  const linhas: Linha[] = []
  let n = 0
  for (const s of secoes) {
    const itens = (s.itens ?? []).filter(Boolean)
    if (!itens.length && !s.intro) continue
    n++
    linhas.push({ texto: `${n}. ${s.titulo}`, estilo: 'secao' })
    if (s.intro) linhas.push({ texto: s.intro, estilo: 'corpo' })
    for (const item of itens) linhas.push({ texto: `• ${item}`, estilo: 'item' })
  }
  return linhas
}

/** "Sub-13: 2 tempos de 25 minutos" — uma linha por categoria que definiu. */
function porCategoria(cats: Category[], descreve: (c: Category) => string): string[] {
  return cats
    .map((c) => {
      const txt = descreve(c)
      return txt ? `${c.name}: ${txt}.` : ''
    })
    .filter(Boolean)
}

/**
 * Rótulo do esporte e do público, com o valor cru como reserva.
 *
 * Campeonato antigo pode ter um `sport` que saiu da lista. `SPORT_LABELS[...]`
 * devolveria `undefined`, e o regulamento — um documento que as equipes leem —
 * sairia com "Modalidade: undefined.".
 */
function rotuloEsporte(c: Championship): string {
  return SPORT_LABELS[c.sport] ?? c.sport ?? ''
}

function rotuloPublico(c: Championship): string {
  return AUDIENCE_LABELS[c.audience] ?? c.audience ?? ''
}

function maiuscula(frase: string): string {
  return frase.charAt(0).toUpperCase() + frase.slice(1)
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

/**
 * As categorias, com a regra de idade e — na base — a de atletas federados.
 * Elas ficam juntas de propósito: quem lê a categoria precisa ver as duas
 * condições no mesmo lugar.
 */
export function descreverCategorias(c: Championship): string[] {
  return (c.categories ?? []).map((cat) => {
    let idade: string
    if (!cat.birthYear) {
      idade = 'sem restrição de idade'
    } else if (cat.birthYearMode === 'min') {
      idade = `nascidos em ${cat.birthYear} ou depois`
    } else {
      const excecoes = cat.exceptions
        ? `, com até ${cat.exceptions} atleta(s) por equipe de ${cat.birthYear - 1}`
        : ''
      idade = `nascidos em ${cat.birthYear} ou antes${excecoes}`
    }
    const federados = c.audience === 'infantil' ? ` ${maiuscula(textoRegra(cat))}` : ''
    return `${cat.name}: ${idade}.${federados}`
  })
}

/* -------------------------------------------------------------------------- */
/* Cláusulas fixas — valem em qualquer campeonato da plataforma                */
/* -------------------------------------------------------------------------- */

const TOLERANCIA: Secao = {
  titulo: 'Da tolerância',
  itens: [
    'Cada categoria terá 20 minutos de tolerância. Após esse prazo será aplicado o W.O. e, ' +
      'caso não haja justificativa, a equipe será automaticamente eliminada do campeonato.',
  ],
}

const UNIFORME: Secao = {
  titulo: 'Da troca de uniforme',
  itens: [
    'Cada categoria terá até 20 minutos de tolerância após o comunicado do delegado da partida. ' +
      'A troca do uniforme é de responsabilidade da equipe mandante.',
  ],
}

const BOLA: Secao = {
  titulo: 'Da bola de jogo',
  itens: [
    'Cada equipe deverá apresentar no mínimo 03 bolas em condições de jogo ao delegado da partida. ' +
      'O não cumprimento penaliza a equipe com a perda de 03 pontos e do mando de jogo.',
  ],
}

const AGRESSAO: Secao = {
  titulo: 'Da agressão e de qualquer forma de discriminação',
  itens: [
    'A partida deverá ser paralisada.',
    'Em caso de agressão física, a equipe infratora será penalizada após o julgamento da súmula ' +
      'pela organização do campeonato.',
    'Em caso de briga generalizada, a partida deverá ser encerrada, aguardando-se o posicionamento ' +
      'da organização mediante as informações da súmula.',
  ],
}

const RACISMO: Secao = {
  titulo: 'Em caso de racismo — o protocolo em campo',
  intro:
    'O árbitro, jogadores ou oficiais podem sinalizar um ato discriminatório cruzando os pulsos em ' +
    'formato de "X". O jogo deve seguir estas três etapas se houver ofensas ou cantos racistas:',
  itens: [
    '1ª etapa (paralisação): o árbitro interrompe a partida imediatamente e ordena um aviso público ' +
      'para que o comportamento cesse.',
    '2ª etapa (suspensão temporária): se o ato continuar após o reinício, o árbitro suspende o jogo ' +
      'por um período determinado e retira as equipes do gramado, que vão aos vestiários enquanto ' +
      'novos avisos são emitidos.',
    '3ª etapa (encerramento definitivo): caso as manifestações persistam após o retorno, o jogo é ' +
      'encerrado de forma definitiva e a equipe responsável pela conduta discriminatória — de ' +
      'jogadores ou de torcida — é punida com a derrota por W.O.',
  ],
}

const PUNICOES: Secao = {
  titulo: 'Das punições esportivas e disciplinares',
  itens: [
    'Multas e sanções severas: clubes e confederações podem receber multas altíssimas, que chegam ' +
      'a milhões de reais.',
    'Perda de pontos e portões fechados: os clubes podem jogar com portões fechados, perder pontos ' +
      'na tabela ou até sofrer rebaixamento e exclusão de campeonatos.',
  ],
}

const RESPONSABILIDADE: Secao = {
  titulo: 'Da responsabilidade legal',
  itens: [
    'Prisão em flagrante: o racismo é crime inafiançável e imprescritível no Brasil. Torcedores, ' +
      'atletas ou dirigentes que cometerem agressões racistas devem ser identificados, detidos pelas ' +
      'forças de segurança presentes no estádio e conduzidos a uma delegacia para autuação em flagrante.',
  ],
}

/**
 * Monta as linhas do regulamento.
 *
 * O documento é declaradamente derivado do cadastro: se o organizador mudar
 * uma regra no app, o próximo download já sai diferente. É por isso que ele
 * traz a data de emissão — a versão importa.
 */
export function montarRegulamento(c: Championship, emitidoEm?: string): Linha[] {
  const cats = c.categories ?? []

  const linhas: Linha[] = [
    { texto: 'REGULAMENTO', estilo: 'titulo' },
    { texto: c.name, estilo: 'secao' },
    {
      texto: [rotuloEsporte(c), rotuloPublico(c), c.season]
        .filter(Boolean)
        .join(' · '),
      estilo: 'subtitulo',
    },
  ]

  if (c.description?.trim()) {
    linhas.push({ texto: c.description.trim(), estilo: 'corpo' })
  }

  const criterios = (c.tiebreakers?.length ? c.tiebreakers : DEFAULT_TIEBREAKERS).map(
    (t, i) => `${i + 1}º) ${TIEBREAKER_LABELS[t] ?? t}`,
  )

  const banco = descreverBanco(c)
  const expulsao = descreverExpulsao(c)

  linhas.push(
    ...renderizar([
      {
        titulo: 'Da competição',
        itens: [
          `Modalidade: ${rotuloEsporte(c)}.`,
          `Público: ${rotuloPublico(c)}.`,
          c.season ? `Temporada: ${c.season}.` : '',
          `Formato: ${descreverFormato(c)}`,
        ],
      },
      {
        titulo: 'Das categorias',
        itens: descreverCategorias(c).length
          ? descreverCategorias(c)
          : ['Categoria única, sem restrição de idade.'],
      },
      {
        titulo: 'Do tempo de jogo',
        itens: porCategoria(cats, descreverTempo),
      },
      {
        titulo: 'Das inscrições',
        itens: [
          descreverPrazo(c),
          'A inscrição é feita pelo responsável da equipe, pelo link enviado pelo organizador.',
          'São exigidos nome completo, CPF e data de nascimento de cada atleta.',
          'Um mesmo CPF não pode ser inscrito em duas equipes do mesmo campeonato.',
          ...(algumaPermite(c, cats)
            ? ['A equipe deve indicar, na inscrição, quais atletas são federados e em qual modalidade (campo ou futsal). O limite de federados é por categoria — veja a seção Das categorias.']
            : c.audience === 'infantil'
              ? ['Nenhuma categoria deste campeonato aceita atletas federados.']
              : []),
        ],
      },
      {
        titulo: 'Do banco de reservas e das substituições',
        itens: [banco, ...porCategoria(cats, descreverSubstituicoes)],
      },
      {
        titulo: 'Da pontuação',
        itens: [
          `Vitória: ${c.pointsWin ?? 3} ponto(s).`,
          `Empate: ${c.pointsDraw ?? 1} ponto(s).`,
          'Derrota: 0 ponto.',
        ],
      },
      {
        titulo: 'Dos critérios de desempate',
        intro: 'Em caso de igualdade de pontos, a classificação é decidida nesta ordem:',
        itens: criterios,
      },
      ...(c.format !== 'league'
        ? [
            {
              titulo: 'Do mata-mata',
              itens: [
                'Empate no tempo normal é decidido na disputa por pênaltis.',
                c.thirdPlace ? 'Há disputa de 3º lugar.' : 'Não há disputa de 3º lugar.',
              ],
            },
          ]
        : []),
      {
        titulo: 'Da disciplina',
        itens: [expulsao, ...porCategoria(cats, descreverAmarelos)],
      },
      {
        titulo: 'Da arbitragem',
        itens: porCategoria(cats, descreverArbitragem),
      },
      TOLERANCIA,
      UNIFORME,
      BOLA,
      AGRESSAO,
      RACISMO,
      PUNICOES,
      RESPONSABILIDADE,
      {
        titulo: 'Das súmulas e resultados',
        itens: [
          'A súmula de cada partida é preenchida pela mesa e fica disponível para as equipes.',
          'Gols, cartões e substituições registrados na súmula alimentam a classificação e as estatísticas.',
          'A classificação é atualizada automaticamente ao encerrar cada partida.',
        ],
      },
      {
        titulo: 'Dos casos omissos',
        itens: [
          'Os casos não previstos neste regulamento serão resolvidos pela organização do campeonato.',
        ],
      },
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
