import { describe, it, expect } from 'vitest';
import { grupoDoLead, ordenarFila, janelaAberta, minutosSemResposta, fmtEspera } from '../sdrRegras.js';

const AGORA = new Date('2026-08-03T17:05:00-03:00');
const hMenos = (h) => new Date(AGORA.getTime() - h * 3600000).toISOString();

describe('janelaAberta', () => {
  it('aberta antes de 24h', () => expect(janelaAberta(hMenos(23.9), AGORA)).toBe(true));
  it('fechada exatamente em 24h', () => expect(janelaAberta(hMenos(24), AGORA)).toBe(false));
  it('fechada depois de 24h', () => expect(janelaAberta(hMenos(30), AGORA)).toBe(false));
  it('sem data devolve false, nunca lanca', () => expect(janelaAberta(null, AGORA)).toBe(false));
});

describe('minutosSemResposta', () => {
  it('conta em minutos inteiros', () => expect(minutosSemResposta(hMenos(2), AGORA)).toBe(120));
  it('sem data devolve null', () => expect(minutosSemResposta(null, AGORA)).toBe(null));
});

describe('fmtEspera', () => {
  it('abaixo de um dia mostra horas e minutos', () => expect(fmtEspera(293)).toBe('04h 53m'));
  it('acima de um dia mostra dias e horas', () => expect(fmtEspera(10082)).toBe('7d 00h'));
  it('zero e valor invalido nao quebram', () => {
    expect(fmtEspera(0)).toBe('00h 00m');
    expect(fmtEspera(null)).toBe('—');
  });
  it('valor negativo vira zero (defeito 3: relogio do servidor atrasado)', () => {
    expect(fmtEspera(-30)).toBe('00h 00m');
  });
});

describe('grupoDoLead', () => {
  it('quem pediu remarcar vem antes de tudo', () => {
    expect(grupoDoLead({ pediu_remarcar_em: hMenos(8), call_em: hMenos(-2) }, AGORA)).toBe('risco');
  });
  it('call de hoje sem confirmacao', () => {
    expect(grupoDoLead({ call_em: hMenos(-2), confirmado: false }, AGORA)).toBe('call');
  });
  it('call ja confirmada sai da fila', () => {
    expect(grupoDoLead({ call_em: hMenos(-2), confirmado: true }, AGORA)).toBe(null);
  });
  it('cliente falou por ultimo e ninguem respondeu', () => {
    expect(grupoDoLead({ ultima_em: hMenos(30), ultima_direcao: 'in' }, AGORA)).toBe('espera');
  });
  it('conversou, foi respondido e nunca recebeu convite', () => {
    expect(grupoDoLead({ ultima_em: hMenos(30), ultima_direcao: 'out', total_mensagens: 11 }, AGORA)).toBe('semconvite');
  });
  it('faltou na ultima call', () => {
    expect(grupoDoLead({ faltou_em: hMenos(96) }, AGORA)).toBe('falta');
  });
  it('lead descartado nunca entra na fila', () => {
    expect(grupoDoLead({ estado: 'descartado', ultima_em: hMenos(30), ultima_direcao: 'in' }, AGORA)).toBe(null);
  });
  it('faltou_em posterior a call_em cai no grupo falta (defeito 2)', () => {
    expect(grupoDoLead({ call_em: hMenos(10), faltou_em: hMenos(5) }, AGORA)).toBe('falta');
  });
  it('call_em posterior a faltou_em (remarcada apos falta antiga) cai no grupo call', () => {
    expect(grupoDoLead({ call_em: hMenos(-2), faltou_em: hMenos(10), confirmado: false }, AGORA)).toBe('call');
  });
});

describe('ordenarFila', () => {
  it('respeita a ordem dos grupos e, dentro do grupo, o mais antigo primeiro', () => {
    const fila = ordenarFila([
      { id: 'b', ultima_em: hMenos(30), ultima_direcao: 'in' },
      { id: 'c', faltou_em: hMenos(96) },
      { id: 'a', pediu_remarcar_em: hMenos(8) },
      { id: 'd', ultima_em: hMenos(44), ultima_direcao: 'in' },
    ], AGORA);
    expect(fila.map((l) => l.id)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('grupo call ordena pela hora da call, nao pela ultima mensagem (defeito 1)', () => {
    const fila = ordenarFila([
      { id: 'atrasada', call_em: hMenos(1), confirmado: false, ultima_em: hMenos(0.05) },
      { id: 'daqui_a_pouco', call_em: hMenos(-0.1), confirmado: false, ultima_em: hMenos(20) },
    ], AGORA);
    expect(fila.map((l) => l.id)).toEqual(['atrasada', 'daqui_a_pouco']);
  });

  it('grupo falta ordena pela data da falta, nao pela ultima mensagem', () => {
    const fila = ordenarFila([
      { id: 'falta_recente', faltou_em: hMenos(2), ultima_em: hMenos(50) },
      { id: 'falta_antiga', faltou_em: hMenos(10), ultima_em: hMenos(1) },
    ], AGORA);
    expect(fila.map((l) => l.id)).toEqual(['falta_antiga', 'falta_recente']);
  });
});
