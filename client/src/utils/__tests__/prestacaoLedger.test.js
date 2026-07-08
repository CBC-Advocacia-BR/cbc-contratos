import { describe, it, expect } from 'vitest';
import { buildLedgers } from '../prestacaoLedger';

// Item real (acordo EDNILSON PELLARIN BONAN) devolvido pela RPC
// cliente_prestacao_financeiro — usado p/ travar o mapeamento das verbas.
const ACORDO = {
  sistema: 'acordos', id: 'be06b5fc', processo: '4001614-62.2025.8.26.0400',
  empreendimento: 'Hot Beach', status: 'ativo', valorRefLabel: 'Valor do acordo',
  valorRef: 22216.67, cli_total: 16173.336, esc_total: 6043.334,
  devol: 20216.67, multa: 0, honPct: 20, honVal: 4043.334, honAberto: 0,
  condominio: 0, sucumbContraria: 0, custC: 0, corrCli: 0,
  sucumb: 2000, custE: 0, h523: 0, corrAdv: 0, omitirSucumb: false,
};

describe('buildLedgers', () => {
  it('retorna null p/ item vazio', () => {
    expect(buildLedgers(null)).toBeNull();
  });

  it('monta o lado do cliente na ordem da Prestação (devolução, honorários deduzidos)', () => {
    const led = buildLedgers(ACORDO);
    expect(led.cli.rows.map((r) => r.label)).toEqual([
      'Devolução', 'Honorários Contratuais (20%)',
    ]);
    expect(led.cli.rows[0].valor).toBeCloseTo(20216.67, 2);
    expect(led.cli.rows[0].neg).toBeUndefined();
    expect(led.cli.rows[1].valor).toBeCloseTo(4043.334, 2);
    expect(led.cli.rows[1].neg).toBe(true); // honorários são dedução do cliente
    expect(led.cli.total).toBeCloseTo(16173.336, 2);
  });

  it('monta o lado do escritório (contratuais + sucumbenciais)', () => {
    const led = buildLedgers(ACORDO);
    expect(led.esc.rows.map((r) => r.label)).toEqual([
      'Honorários Contratuais', 'Honorários Sucumbenciais',
    ]);
    expect(led.esc.rows[1].valor).toBeCloseTo(2000, 2);
    expect(led.esc.total).toBeCloseTo(6043.334, 2);
  });

  it('a proporção cliente/escritório fecha em 100%', () => {
    const led = buildLedgers(ACORDO);
    expect(led.cli.pct + led.esc.pct).toBe(100);
    expect(led.cli.pct).toBe(73); // 16173 / 22217 ≈ 73%
  });

  it('marca custas como positivo (reembolso) e correção como plus', () => {
    const led = buildLedgers({
      ...ACORDO, custC: 1403.9, custE: 3164.8, corrCli: 28.66, corrAdv: 14.73,
    });
    const custaCli = led.cli.rows.find((r) => r.label === 'Reembolso de Custas Processuais');
    expect(custaCli).toMatchObject({ valor: 1403.9 });
    expect(custaCli.neg).toBeUndefined();
    expect(led.cli.rows.find((r) => r.label === 'Correção Monetária / Juros')).toMatchObject({ plus: true });
    expect(led.esc.rows.find((r) => r.label === 'Reembolso de Custas Pagas pelo Escritório')).toMatchObject({ valor: 3164.8 });
  });

  it('omite linhas de verba zeradas', () => {
    const led = buildLedgers(ACORDO);
    // sem multa, condomínio, custas, art.523 → não aparecem
    const todas = [...led.cli.rows, ...led.esc.rows].map((r) => r.label);
    expect(todas).not.toContain('Multa Art. 523 do CPC');
    expect(todas).not.toContain('Despesas Condominiais em Aberto');
    expect(todas).not.toContain('Honorários Art. 523 do CPC');
  });
});
