/**
 * (auditoria 01/08/2026 — item 296) Regra de DINHEIRO do webhook do Asaas, isolada aqui
 * para poder ser testada.
 *
 * POR QUE ISOLAR: esta decisao define se um boleto consta como PAGO ou VENCIDO. Se ela
 * inverter, ninguem percebe pelo sistema — percebe-se quando um cliente em dia recebe
 * cobranca, ou quando alguem inadimplente some do relatorio. Enquanto a regra vivia
 * dentro do handler, misturada a chamadas de banco e de rede, nao dava para testar: era
 * a unica parte do fluxo de dinheiro sem nenhuma protecao automatica.
 *
 * A REGRA (item 122): o webhook do Asaas pode chegar FORA DE ORDEM — a fila deles
 * reenvia e a rede nao garante sequencia. Um `PAYMENT_OVERDUE` atrasado que chegue
 * DEPOIS do `PAYMENT_RECEIVED` nao pode "despagar" o boleto: o cliente ja em dia
 * reapareceria na inadimplencia e na regua de cobranca.
 * Uma vez PAGO, so um evento de REVERSAO EXPLICITA (estorno, chargeback, exclusao)
 * tira o boleto desse estado.
 */
import { PAID_STATUSES } from './asaasMirror.mjs';

/** Evento do Asaas -> status final do boleto em `asaas_boletos`. */
export const EVENT_TO_STATUS = {
  PAYMENT_RECEIVED: 'RECEIVED',
  PAYMENT_CONFIRMED: 'CONFIRMED',
  PAYMENT_RECEIVED_IN_CASH: 'RECEIVED_IN_CASH',
  PAYMENT_OVERDUE: 'OVERDUE',
  PAYMENT_DELETED: 'DELETED',
  PAYMENT_REFUNDED: 'REFUNDED',
  PAYMENT_CHARGEBACK_REQUESTED: 'CHARGEBACK_REQUESTED',
  PAYMENT_CHARGEBACK_DISPUTE: 'CHARGEBACK_DISPUTE',
};

/** Status que DESFAZEM um pagamento — os unicos que podem rebaixar um boleto pago. */
export const REVERSOES = ['REFUNDED', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'DELETED'];

/** Status que registram a data de pagamento no espelho. */
const REGISTRAM_PAGAMENTO = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];

/**
 * Decide o que fazer com um evento do webhook.
 *
 * @param {string} evento      nome do evento do Asaas (ex.: 'PAYMENT_OVERDUE')
 * @param {string|null} atual  status que o boleto tem HOJE no espelho (null = nao existe)
 * @returns {{aplicar: boolean, novoStatus: string|null, gravaDataPagamento: boolean, motivo: string}}
 *   aplicar=false significa "ignorar em silencio e responder 200" (o Asaas re-tenta em erro,
 *   entao devolver erro para um evento que decidimos descartar geraria reenvio eterno).
 */
export function decidirEvento(evento, atual) {
  const novoStatus = EVENT_TO_STATUS[evento] || null;
  if (!novoStatus) {
    return { aplicar: false, novoStatus: null, gravaDataPagamento: false, motivo: 'evento sem status mapeado' };
  }

  const ehReversao = REVERSOES.includes(novoStatus);
  const jaEstaPago = !!atual && PAID_STATUSES.has(atual);

  // pagamento e reversao sempre passam; o resto so passa se o boleto ainda nao esta pago
  if (!PAID_STATUSES.has(novoStatus) && !ehReversao && jaEstaPago) {
    return {
      aplicar: false,
      novoStatus,
      gravaDataPagamento: false,
      motivo: `evento fora de ordem: boleto ja consta como ${atual}`,
    };
  }

  return {
    aplicar: true,
    novoStatus,
    gravaDataPagamento: REGISTRAM_PAGAMENTO.includes(novoStatus),
    motivo: 'ok',
  };
}
