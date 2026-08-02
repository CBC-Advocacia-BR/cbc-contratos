// (auditoria 01/08/2026 — item 235) Sanidade do ESPELHO da Meta, nao do negocio.
// O modo de falha que estes testes travam: espelho parado exibe zero gasto e zero leads,
// que na tela e IDENTICO a um dia fraco de campanha — e alguem mexe no orcamento por causa
// de um dado que nao existe.
import { describe, it, expect } from 'vitest';
import { avaliarSanidadeEspelho, SANIDADE_DEFAULT } from '../../../netlify/functions/_lib/metaAds.mjs';

/** serie saudavel: dias consecutivos, gasto estavel, leads coerentes */
const serieOk = (ate = '2026-08-01', dias = 20) => {
  const out = [];
  const base = Date.parse(`${ate}T12:00:00Z`);
  for (let i = dias - 1; i >= 0; i--) {
    out.push({ dia: new Date(base - i * 86400000).toISOString().slice(0, 10), gasto: 300 + (i % 5) * 10, leads: 15 });
  }
  return { conta: out };
};

const tipos = (r) => r.map((x) => x.tipo).sort();

describe('avaliarSanidadeEspelho — item 235', () => {
  it('espelho saudavel nao gera nenhum aviso', () => {
    expect(avaliarSanidadeEspelho(serieOk(), '2026-08-02', { diario: 120 })).toEqual([]);
  });

  it('rodada que gravou 0 linhas e sinalizada', () => {
    const r = avaliarSanidadeEspelho(serieOk(), '2026-08-02', { diario: 0 });
    expect(tipos(r)).toContain('espelho_vazio');
    expect(r[0].mensagem).toMatch(/nao gravou NENHUMA linha/i);
  });

  it('espelho parado ha varios dias vira aviso (com o numero de dias)', () => {
    const r = avaliarSanidadeEspelho(serieOk('2026-07-25'), '2026-08-02', { diario: 5 });
    const parado = r.find((x) => x.tipo === 'espelho_parado');
    expect(parado).toBeTruthy();
    expect(parado.valor).toBe(8);
  });

  it('atraso normal de 1 dia (a serie vai ate ontem) NAO alarma', () => {
    expect(avaliarSanidadeEspelho(serieOk('2026-08-01'), '2026-08-02', { diario: 5 })).toEqual([]);
  });

  it('buraco no meio da serie e detectado', () => {
    const s = serieOk();
    s.conta.splice(10, 2); // some com 2 dias do meio
    const r = avaliarSanidadeEspelho(s, '2026-08-02', { diario: 5 });
    expect(tipos(r)).toContain('buraco_serie');
  });

  it('gasto absurdo num dia (gravacao duplicada) e detectado pela MEDIANA', () => {
    const s = serieOk();
    s.conta[5].gasto = 9000; // ~30x a mediana
    const r = avaliarSanidadeEspelho(s, '2026-08-02', { diario: 5 });
    const g = r.find((x) => x.tipo === 'gasto_absurdo');
    expect(g).toBeTruthy();
    expect(g.valor).toBe(9000);
    // o proprio dia louco nao pode inflar o limite (por isso mediana, nao media)
    expect(g.limite).toBeLessThan(9000);
  });

  it('leads com gasto ZERO (insight truncado) e sinalizado', () => {
    const s = serieOk();
    s.conta[3].gasto = 0;
    const r = avaliarSanidadeEspelho(s, '2026-08-02', { diario: 5 });
    expect(tipos(r)).toContain('lead_sem_gasto');
  });

  it('serie vazia = espelho parado, e nao explode', () => {
    const r = avaliarSanidadeEspelho({ conta: [] }, '2026-08-02', null);
    expect(tipos(r)).toEqual(['espelho_parado']);
    expect(avaliarSanidadeEspelho(null, '2026-08-02')).toHaveLength(1);
  });

  it('desligado na config nao avalia nada', () => {
    expect(avaliarSanidadeEspelho({ conta: [] }, '2026-08-02', { diario: 0 }, { ativo: false })).toEqual([]);
  });

  it('serie curta nao inventa "gasto absurdo" (falta de historico nao e incidente)', () => {
    const s = { conta: [{ dia: '2026-08-01', gasto: 5000, leads: 1 }] };
    expect(tipos(avaliarSanidadeEspelho(s, '2026-08-02', { diario: 3 }))).not.toContain('gasto_absurdo');
  });

  it('defaults expostos para a config da aba', () => {
    expect(SANIDADE_DEFAULT.ativo).toBe(true);
    expect(SANIDADE_DEFAULT.gasto_mult).toBeGreaterThan(1);
  });
});
