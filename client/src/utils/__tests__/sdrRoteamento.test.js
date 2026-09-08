import { describe, it, expect } from 'vitest';
import { calcularNota, escolherCloser, ROTEAMENTO_PADRAO } from '../../../netlify/functions/_lib/sdrRoteamento.mjs';

const sp = (s) => new Date(`${s}-03:00`);
const cfg = {
  vendedoras: [
    { nome: 'Mariana', email: 'marianamaciel@advocaciacbc.com', peso: 60, ativa: true },
    { nome: 'Beatriz', email: 'beatriz@advocaciacbc.com', peso: 20, ativa: true },
    { nome: 'Emerson', email: 'emerson@advocaciacbc.com', peso: 20, ativa: true },
  ],
  roteamento: {},
};

describe('calcularNota', () => {
  it('resort alto + quitada + valor alto + audio = 5; nao identificado = -2', () => {
    expect(calcularNota({ resort: 'Solar das Águas', situacao_cota: 'quitada', valor_pago: 45000, mandou_audio: true })).toBe(5);
    expect(calcularNota({ resort: null })).toBe(ROTEAMENTO_PADRAO.pontos.resort_nao_identificado);
    expect(calcularNota({ resort: 'Resort Qualquer', situacao_cota: 'pagando', valor_pago: 10000 })).toBe(0);
  });
});

describe('escolherCloser', () => {
  const slots = [
    { inicio: sp('2026-09-07T08:30:00'), vendedoras: ['marianamaciel@advocaciacbc.com', 'beatriz@advocaciacbc.com'] },
    { inicio: sp('2026-09-07T09:00:00'), vendedoras: ['emerson@advocaciacbc.com'] },
  ];
  it('nota >= limiar e Mariana com slot na janela -> Mariana', () => {
    expect(escolherCloser({ nota: 3, cfg, slots, seed: 'lead1' })).toEqual({ email: 'marianamaciel@advocaciacbc.com', motivo: 'nota' });
  });
  it('nota baixa -> rodizio entre as outras (nunca Mariana)', () => {
    const r = escolherCloser({ nota: 1, cfg, slots, seed: 'lead2' });
    expect(['beatriz@advocaciacbc.com', 'emerson@advocaciacbc.com']).toContain(r.email);
    expect(r.motivo).toBe('rodizio');
  });
  it('nota alta mas Mariana sem slot -> rodizio', () => {
    const semMariana = [{ inicio: sp('2026-09-07T09:00:00'), vendedoras: ['emerson@advocaciacbc.com'] }];
    expect(escolherCloser({ nota: 5, cfg, slots: semMariana, seed: 'lead3' })).toEqual({ email: 'emerson@advocaciacbc.com', motivo: 'rodizio' });
  });
  it('sem slot nenhum -> null', () => {
    expect(escolherCloser({ nota: 5, cfg, slots: [], seed: 'x' })).toBeNull();
  });
  it('janela conta dias uteis em SP, nao em UTC (slot 22h30 SP conta no mesmo dia util que 09h SP)', () => {
    // 2026-09-07 22:30 -03:00 (segunda, SP) = 2026-09-08 01:30 UTC (terca) -- o dia UTC muda,
    // o dia de SP nao. Com janela_dias_uteis:1 e a Mariana livre so as 22h30 de segunda (SP),
    // ela tem que ganhar por nota: e o mesmo dia util da outra closer, livre as 9h de segunda.
    const cfgJanela1 = { ...cfg, roteamento: { janela_dias_uteis: 1 } };
    const slotsSp = [
      { inicio: sp('2026-09-07T09:00:00'), vendedoras: ['beatriz@advocaciacbc.com'] },
      { inicio: sp('2026-09-07T22:30:00'), vendedoras: ['marianamaciel@advocaciacbc.com'] },
    ];
    expect(escolherCloser({ nota: 5, cfg: cfgJanela1, slots: slotsSp, seed: 'lead-sp' }))
      .toEqual({ email: 'marianamaciel@advocaciacbc.com', motivo: 'nota' });
  });
  it('nota abaixo do limiar e so a Mariana tem horario -> ela mesma, motivo rodizio', () => {
    const soMariana = [{ inicio: sp('2026-09-07T09:00:00'), vendedoras: ['marianamaciel@advocaciacbc.com'] }];
    expect(escolherCloser({ nota: 1, cfg, slots: soMariana, seed: 'lead-so-mariana' }))
      .toEqual({ email: 'marianamaciel@advocaciacbc.com', motivo: 'rodizio' });
  });
});
