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
});
