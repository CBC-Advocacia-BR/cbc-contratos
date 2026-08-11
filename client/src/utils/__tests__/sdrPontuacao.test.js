import { describe, it, expect } from 'vitest';
import { pontuar, vaiParaTopo, CONFIG_PADRAO } from '../sdrPontuacao.js';

describe('pontuar — ausencia de dado nao e nota baixa', () => {
  it('sem resort e sem valor devolve null, nunca zero', () => {
    const r = pontuar({ lead_id: '1' });
    expect(r.nota).toBe(null);
    expect(r.faixa).toBe('apurar');
    expect(r.faltando).toEqual(['valor', 'resort']);
  });

  it('lead inexistente nao quebra', () => {
    expect(pontuar(null).nota).toBe(null);
    expect(pontuar(undefined).faixa).toBe('apurar');
  });

  it('com um dado so, a nota existe e diz o que falta', () => {
    const r = pontuar({ resort: 'Ondas Praia' });
    expect(r.nota).toBe(35);
    expect(r.faltando).toEqual(['valor']);
  });
});

describe('pontuar — os tres fatores', () => {
  it('valor acima do piso soma o peso cheio', () => {
    expect(pontuar({ valor_pago: 61000, resort: 'Ondas Praia' }).nota).toBe(75);
  });

  it('valor abaixo do piso soma uma fracao, nao zero', () => {
    expect(pontuar({ valor_pago: 10000, resort: 'Ondas Praia' }).nota).toBe(16 + 35);
  });

  it('resort fora da lista de prioritarios soma menos', () => {
    expect(pontuar({ resort: 'Hot Beach', valor_pago: 61000 }).nota).toBe(40 + 14);
  });

  it('cota quitada soma o peso proprio', () => {
    const semQuitar = pontuar({ resort: 'Solar das Águas', valor_pago: 61000 }).nota;
    const quitada = pontuar({ resort: 'Solar das Águas', valor_pago: 61000, situacao_cota: 'quitada' }).nota;
    expect(quitada - semQuitar).toBe(25);
  });
});

describe('pontuar — o julgamento do SDR sobrepoe a conta', () => {
  it('lead quente chega a 90 mesmo sem dado nenhum', () => {
    const r = pontuar({ quente: true });
    expect(r.nota).toBe(90);
    expect(r.faixa).toBe('quente');
  });

  it('lead quente com nota ja alta nao perde pontos', () => {
    const r = pontuar({ quente: true, resort: 'Hard Rock', valor_pago: 61000, situacao_cota: 'quitada' });
    expect(r.nota).toBe(100);
  });
});

describe('pontuar — os pesos vem da configuracao, nao do codigo', () => {
  it('mudar o peso do resort muda a nota na hora', () => {
    const lead = { resort: 'Hard Rock', valor_pago: 61000 };
    expect(pontuar(lead, CONFIG_PADRAO).nota).toBe(75);
    expect(pontuar(lead, { ...CONFIG_PADRAO, peso_resort: 60 }).nota).toBe(100);
  });

  it('mudar o piso de valor muda a faixa do mesmo lead', () => {
    const lead = { valor_pago: 30000, resort: 'Ondas Praia' };
    expect(pontuar(lead, CONFIG_PADRAO).nota).toBe(16 + 35);
    expect(pontuar(lead, { ...CONFIG_PADRAO, piso_valor: 20000 }).nota).toBe(40 + 35);
  });

  it('configuracao ausente ou quebrada cai no padrao, sem lancar', () => {
    expect(pontuar({ resort: 'Hard Rock' }, null).nota).toBe(35);
    expect(pontuar({ resort: 'Hard Rock' }, { peso_resort: 'abc' }).nota).toBe(35);
  });
});

describe('vaiParaTopo', () => {
  it('passa do limiar', () => {
    expect(vaiParaTopo({ resort: 'Hard Rock', valor_pago: 61000 })).toBe(true);
  });
  it('abaixo do limiar fica no rodizio', () => {
    expect(vaiParaTopo({ resort: 'Hot Beach' })).toBe(false);
  });
  it('sem dado nenhum nunca vai para o topo', () => {
    expect(vaiParaTopo({})).toBe(false);
  });
});
