import { describe, it, expect } from 'vitest';
import { computePontualidade, fmtDur } from '../punctualityCompute';

const row = (o) => ({
  event_id: o.id || Math.random().toString(36).slice(2), vendedora_email: o.email, vendedor: o.email.split('@')[0],
  scheduled_at: o.at, cliente_nome: o.cli || 'Cliente', lead_entrou: o.lead || null, vendedor_entrou: o.vend || null,
  tem_lead: o.tem_lead !== false, vendedor_nao_entrou: !!o.naoEntrou, atraso_seg: o.atraso || 0, houve_atraso: !!o.atraso,
});

describe('computePontualidade', () => {
  it('agrega por vendedor e conta atrasos (Regra B)', () => {
    const rows = [
      row({ email: 'mariana@x.com', at: '2026-07-24T14:00:00Z', atraso: 120 }), // atraso 2min
      row({ email: 'mariana@x.com', at: '2026-07-24T13:00:00Z' }),              // pontual
      row({ email: 'mariana@x.com', at: '2026-07-24T12:00:00Z' }),              // pontual
      row({ email: 'beatriz@x.com', at: '2026-07-24T11:00:00Z', atraso: 300 }), // atraso 5min
    ];
    const r = computePontualidade(rows);
    const m = r.porVendedor.find((v) => v.vendedor === 'mariana');
    expect(m.total).toBe(3);
    expect(m.atrasos).toBe(1);
    expect(m.pontual).toBe(2);
    expect(m.pctPontual).toBe(67); // 2/3
    expect(m.piorSeg).toBe(120);
    const b = r.porVendedor.find((v) => v.vendedor === 'beatriz');
    expect(b.atrasos).toBe(1);
    expect(b.pctPontual).toBe(0);
    expect(r.geral.total).toBe(4);
    expect(r.geral.atrasos).toBe(2);
  });

  it('calls SEM lead nao entram no universo', () => {
    const rows = [
      row({ email: 'a@x.com', at: '2026-07-24T10:00:00Z', tem_lead: false }), // lead nao entrou -> ignora
      row({ email: 'a@x.com', at: '2026-07-24T11:00:00Z' }),                    // pontual
    ];
    const r = computePontualidade(rows);
    expect(r.geral.total).toBe(1);
    expect(r.porVendedor[0].total).toBe(1);
  });

  it('vendedor NAO entrou conta separado (nao como atraso)', () => {
    const rows = [row({ email: 'a@x.com', at: '2026-07-24T10:00:00Z', naoEntrou: true })];
    const r = computePontualidade(rows);
    expect(r.porVendedor[0].naoEntrou).toBe(1);
    expect(r.porVendedor[0].atrasos).toBe(0);
    expect(r.porVendedor[0].pontual).toBe(0);
    expect(r.geral.naoEntrou).toBe(1);
  });

  it('lista de casos so os atrasos, mais recente primeiro', () => {
    const rows = [
      row({ email: 'a@x.com', at: '2026-07-20T10:00:00Z', atraso: 60, cli: 'Ana' }),
      row({ email: 'a@x.com', at: '2026-07-24T10:00:00Z', atraso: 90, cli: 'Bruno' }),
      row({ email: 'a@x.com', at: '2026-07-22T10:00:00Z' }), // pontual, fora da lista
    ];
    const r = computePontualidade(rows);
    expect(r.casos).toHaveLength(2);
    expect(r.casos[0].cliente_nome).toBe('Bruno'); // 24/07 primeiro
    expect(r.casos[1].cliente_nome).toBe('Ana');
  });

  it('mediana e media do atraso', () => {
    const rows = [
      row({ email: 'a@x.com', at: '2026-07-24T10:00:00Z', atraso: 60 }),
      row({ email: 'a@x.com', at: '2026-07-24T11:00:00Z', atraso: 120 }),
      row({ email: 'a@x.com', at: '2026-07-24T12:00:00Z', atraso: 240 }),
    ];
    const v = computePontualidade(rows).porVendedor[0];
    expect(v.atrasoMedianoSeg).toBe(120);
    expect(v.atrasoMedioSeg).toBe(140); // (60+120+240)/3
    expect(v.esperaTotalSeg).toBe(420);
  });

  it('vazio', () => {
    const r = computePontualidade([]);
    expect(r.porVendedor).toEqual([]);
    expect(r.casos).toEqual([]);
    expect(r.geral.pctPontual).toBe(null);
  });
});

describe('fmtDur', () => {
  it('formata', () => {
    expect(fmtDur(45)).toBe('45s');
    expect(fmtDur(120)).toBe('2,0 min');
    expect(fmtDur(192)).toBe('3,2 min');
    expect(fmtDur(null)).toBe('—');
  });
});
