// ---------------------------------------------------------------------------
// O contrato da assinatura Diamante.
//
// O Asaas não tem fidelidade nem multa por cancelamento: a assinatura dele
// simplesmente recorre até alguém parar. O compromisso de 12 meses, portanto,
// não existe do lado do meio de pagamento — ele existe aqui, no aceite que o
// cliente dá antes de assinar.
//
// Por isso o texto é gerado com os números daquela negociação e guardado por
// INTEIRO junto do aceite (migration 0037). Guardar só um número de versão
// seria confiar que ninguém mexeu no arquivo depois — e a hora de provar o que
// foi combinado é justamente a hora em que alguém discorda.
// ---------------------------------------------------------------------------
import { formatBRL } from './pricing'

/**
 * Versão do modelo. Muda quando o TEXTO muda — serve para saber, olhando um
 * aceite antigo, qual modelo estava no ar naquele dia.
 *
 * `.2` acrescentou a cláusula de uso exclusivo da conta. Quem aceitou a `.1`
 * aceitou outro texto, e é o texto guardado no aceite que vale para ele.
 */
export const CONTRATO_VERSAO = 'diamante-2026-08.2'

export interface DadosContrato {
  /** Nome do campeonato pelo qual a negociação entrou. */
  campeonato: string
  /** Mensalidade, em centavos. */
  cents: number
  /** Meses de compromisso. */
  meses: number
}

/** Valor total do compromisso — o número que costuma faltar na conversa. */
export function totalDoContrato({ cents, meses }: Pick<DadosContrato, 'cents' | 'meses'>): number {
  return cents * meses
}

/**
 * O texto do contrato, com os números da negociação já dentro.
 *
 * Escrito para ser lido por um organizador de campeonato de várzea, não por
 * um advogado: frases curtas, sem "outrossim", e cada cláusula dizendo o que
 * acontece na prática.
 *
 * A cláusula de uso exclusivo vem logo depois do objeto porque é ele que a
 * torna necessária: a assinatura libera a CONTA inteira, com campeonatos
 * ilimitados. Sem limite de uso, um login pagante poderia atender meia dúzia
 * de organizadores — e cada cláusula proibindo algo termina dizendo o que
 * acontece a quem descumpre, senão é enfeite.
 */
export function contratoDiamante(d: DadosContrato): string {
  const mensal = formatBRL(d.cents)
  const total = formatBRL(totalDoContrato(d))

  return [
    'CONTRATO DE ASSINATURA — PLANO DIAMANTE (TABELAÇO)',
    '',
    `1. OBJETO. A contratação do plano Diamante do Tabelaço, que dá direito a campeonatos, categorias e equipes ilimitados enquanto a assinatura estiver em dia. A negociação teve origem no campeonato "${d.campeonato}", mas a assinatura vale para a CONTA do contratante: todos os campeonatos Diamante dela ficam liberados.`,
    '',
    '2. USO EXCLUSIVO DA CONTA. A conta e o login do plano Diamante são de uso EXCLUSIVO do contratante e da organização dele. O acesso é pessoal e intransferível.',
    '',
    '   2.1. É PROIBIDO vender, alugar, emprestar, ceder, sublicenciar ou compartilhar o login, a senha ou qualquer forma de acesso à conta com terceiros, com ou sem cobrança.',
    '',
    '   2.2. É PROIBIDO usar a conta para organizar campeonatos de terceiros como se fosse um serviço próprio — isto é, revender o Tabelaço sob outro nome. Quem organiza para terceiros precisa de contrato específico com a Tabelaço.',
    '',
    '   2.3. O contratante pode dar acesso às pessoas da própria equipe de trabalho, e responde por tudo o que for feito com o acesso dele.',
    '',
    '   2.4. Constatado o descumprimento deste item, a Tabelaço pode suspender ou encerrar a conta imediatamente, sem devolução de valores já pagos, e as mensalidades do período contratado continuam devidas.',
    '',
    `3. VALOR E FORMA DE PAGAMENTO. ${mensal} por mês, debitados no cartão de crédito informado, todo mês, pelo Asaas. Não é parcelamento: cada mês é uma cobrança de ${mensal}, e o limite do cartão não fica comprometido pelo valor total.`,
    '',
    `4. PRAZO. ${d.meses} meses, contados a partir da primeira cobrança confirmada. O total do compromisso é de ${total}. Ao fim do prazo a assinatura se encerra, e a renovação é combinada de novo.`,
    '',
    `5. ATRASO. Se uma cobrança não for paga, o contratante tem 7 (sete) dias de carência: nesse período tudo continua funcionando normalmente. Passada a carência sem pagamento, os campeonatos do plano Diamante são fechados até a regularização. Nada é apagado — times, atletas, tabelas e resultados ficam guardados e voltam ao ar quando o pagamento for confirmado.`,
    '',
    `6. CANCELAMENTO ANTES DO PRAZO. O contratante pode cancelar quando quiser. Cancelando antes dos ${d.meses} meses, ficam devidas as mensalidades restantes do período contratado, salvo acordo diferente por escrito com a Tabelaço.`,
    '',
    '7. DADOS. Os dados dos campeonatos são do contratante. A Tabelaço os trata para prestar o serviço e não os vende nem os cede a terceiros. Encerrado o contrato, o contratante pode pedir a exportação dos seus dados.',
    '',
    '8. SUPORTE. O plano Diamante inclui atendimento direto com um consultor pelos canais informados no aplicativo.',
    '',
    '9. ACEITE. Este contrato é aceito eletronicamente. Ficam registrados o nome, o documento, a data e a hora do aceite, e o texto integral desta versão — que é o que vale entre as partes.',
  ].join('\n')
}
