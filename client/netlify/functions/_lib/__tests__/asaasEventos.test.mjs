// (auditoria 01/08/2026 — item 296) Regra de DINHEIRO do webhook do Asaas.
//
// Esta e a decisao que define se um boleto consta como PAGO ou VENCIDO. Se ela inverter,
// o sistema nao acusa nada: descobre-se quando um cliente em dia recebe cobranca, ou
// quando um inadimplente some do relatorio. Ate agora era a unica parte do fluxo de
// dinheiro sem nenhuma protecao automatica.
import { describe, it, expect } from 'vitest';
import { decidirEvento, EVENT_TO_STATUS, REVERSOES } from '../asaasEventos.mjs';

describe('decidirEvento — boleto ainda EM ABERTO', () => {
  it('pagamento recebido marca como pago e grava a data', () => {
    const d = decidirEvento('PAYMENT_RECEIVED', 'PENDING');
    expect(d).toMatchObject({ aplicar: true, novoStatus: 'RECEIVED', gravaDataPagamento: true });
  });

  it('vencimento marca como vencido (e NAO grava data de pagamento)', () => {
    const d = decidirEvento('PAYMENT_OVERDUE', 'PENDING');
    expect(d).toMatchObject({ aplicar: true, novoStatus: 'OVERDUE', gravaDataPagamento: false });
  });

  it('boleto que ainda nao existe no espelho (status nulo) aceita qualquer evento', () => {
    expect(decidirEvento('PAYMENT_OVERDUE', null).aplicar).toBe(true);
    expect(decidirEvento('PAYMENT_RECEIVED', undefined).aplicar).toBe(true);
  });
});

describe('decidirEvento — boleto JA PAGO (o caso que motivou a regra)', () => {
  // O webhook do Asaas chega fora de ordem: a fila deles reenvia e a rede nao garante
  // sequencia. Antes desta regra, um PAYMENT_OVERDUE atrasado voltava o boleto para
  // "vencido" e o cliente em dia reaparecia na inadimplencia e na regua de cobranca.
  for (const pago of ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED']) {
    it(`OVERDUE atrasado NAO despaga um boleto ${pago}`, () => {
      const d = decidirEvento('PAYMENT_OVERDUE', pago);
      expect(d.aplicar).toBe(false);
      expect(d.motivo).toMatch(/fora de ordem/);
      expect(d.motivo).toContain(pago);
    });
  }

  it('outro evento de pagamento sobre boleto pago continua passando (RECEIVED -> CONFIRMED)', () => {
    expect(decidirEvento('PAYMENT_CONFIRMED', 'RECEIVED').aplicar).toBe(true);
  });

  it('DUNNING_RECEIVED conta como pago — negativado que quitou nao volta a vencido', () => {
    // regressao do fix de inadimplencia: DUNNING_RECEIVED e pagamento, nao cobranca aberta
    expect(decidirEvento('PAYMENT_OVERDUE', 'DUNNING_RECEIVED').aplicar).toBe(false);
  });
});

describe('decidirEvento — reversoes explicitas SEMPRE passam', () => {
  const casos = {
    PAYMENT_REFUNDED: 'REFUNDED',
    PAYMENT_CHARGEBACK_REQUESTED: 'CHARGEBACK_REQUESTED',
    PAYMENT_CHARGEBACK_DISPUTE: 'CHARGEBACK_DISPUTE',
    PAYMENT_DELETED: 'DELETED',
  };
  for (const [evento, status] of Object.entries(casos)) {
    it(`${evento} rebaixa um boleto pago (estorno/chargeback/exclusao sao reais)`, () => {
      const d = decidirEvento(evento, 'RECEIVED');
      expect(d).toMatchObject({ aplicar: true, novoStatus: status, gravaDataPagamento: false });
    });
  }

  it('a lista de reversoes e exatamente a esperada (mudar aqui muda dinheiro)', () => {
    expect(REVERSOES).toEqual(['REFUNDED', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'DELETED']);
  });
});

describe('decidirEvento — evento desconhecido', () => {
  it('evento fora do mapa nao aplica nada (nunca inventa status)', () => {
    const d = decidirEvento('PAYMENT_ALGUMA_COISA_NOVA', 'PENDING');
    expect(d).toMatchObject({ aplicar: false, novoStatus: null });
  });

  it('evento vazio/nulo tambem nao aplica', () => {
    expect(decidirEvento('', 'PENDING').aplicar).toBe(false);
    expect(decidirEvento(null, 'PENDING').aplicar).toBe(false);
  });
});

describe('EVENT_TO_STATUS — mapa completo', () => {
  it('cobre os 8 eventos que o Asaas envia e nenhum a mais', () => {
    expect(Object.keys(EVENT_TO_STATUS).sort()).toEqual([
      'PAYMENT_CHARGEBACK_DISPUTE', 'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_CONFIRMED',
      'PAYMENT_DELETED', 'PAYMENT_OVERDUE', 'PAYMENT_RECEIVED', 'PAYMENT_RECEIVED_IN_CASH',
      'PAYMENT_REFUNDED',
    ]);
  });

  it('so os 3 de recebimento gravam data de pagamento', () => {
    const comData = Object.keys(EVENT_TO_STATUS)
      .filter((e) => decidirEvento(e, 'PENDING').gravaDataPagamento).sort();
    expect(comData).toEqual(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_RECEIVED_IN_CASH']);
  });
});
