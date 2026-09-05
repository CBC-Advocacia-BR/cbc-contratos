import { describe, it, expect } from 'vitest';
import { formatarOferta, etapaDeEncerramento, podeMoverEtapa } from '../../../netlify/functions/_lib/sdrFerramentas.mjs';

const sp = (s) => new Date(`${s}-03:00`);
describe('formatarOferta', () => {
  it('lista id | data e hora, e diz quando nao ha horario', () => {
    const agora = sp('2026-09-05T21:00:00');
    const slots = [{ inicio: sp('2026-09-07T08:30:00'), vendedoras: ['a@x'] }, { inicio: sp('2026-09-07T09:00:00'), vendedoras: ['a@x'] }];
    const s = formatarOferta(slots, 'a@x', agora);
    expect(s.split('\n')).toHaveLength(3);
    expect(s).toContain(`${sp('2026-09-07T08:30:00').toISOString()}|a@x`);
    expect(s).toContain('segunda (07/09) às 8h30');
    expect(formatarOferta([], 'a@x', agora)).toMatch(/nenhum horário/i);
  });

  it('acrescenta o nome da closer quando informado', () => {
    const agora = sp('2026-09-05T21:00:00');
    const slots = [{ inicio: sp('2026-09-07T08:30:00'), vendedoras: ['a@x'] }, { inicio: sp('2026-09-07T09:00:00'), vendedoras: ['a@x'] }];
    const s = formatarOferta(slots, 'a@x', agora, 'Mariana');
    const linhas = s.split('\n');
    expect(linhas).toHaveLength(3);
    expect(linhas[1].endsWith(' (Mariana)')).toBe(true);
    expect(linhas[2].endsWith(' (Mariana)')).toBe(true);
  });
});
describe('etapaDeEncerramento', () => {
  const etapas = { nao_quer: 1, cliente: 2, precisa_humano: 3 };
  it('mapeia motivo -> etapa', () => {
    expect(etapaDeEncerramento('nao_quer', etapas)).toBe(1);
    expect(etapaDeEncerramento('ja_e_cliente', etapas)).toBe(2);
    expect(etapaDeEncerramento('nao_e_lead', etapas)).toBe(3);
    expect(etapaDeEncerramento('outro', etapas)).toBe(3);
  });
});

// (revisao final C1) leads do PILOTO vivem em outro pipeline (gatilho `desde_inicio`); mover
// a etapa deles com os status ids do funil SDR jogaria o lead num funil que nao e o dele.
// Fail-closed: sem pipeline conhecido (estado antigo, config sem pipeline_sdr) NAO move.
describe('podeMoverEtapa', () => {
  it('so libera quando o pipeline do lead e o pipeline do SDR', () => {
    expect(podeMoverEtapa(14170107, 14170107)).toBe(true);
    expect(podeMoverEtapa('14170107', 14170107)).toBe(true);
    expect(podeMoverEtapa(13916619, 14170107)).toBe(false);
  });
  it('fail-closed com pipeline desconhecido dos dois lados', () => {
    expect(podeMoverEtapa(null, 14170107)).toBe(false);
    expect(podeMoverEtapa(undefined, 14170107)).toBe(false);
    expect(podeMoverEtapa(14170107, null)).toBe(false);
    expect(podeMoverEtapa(null, null)).toBe(false);
    expect(podeMoverEtapa(undefined, undefined)).toBe(false);
    expect(podeMoverEtapa('abc', 14170107)).toBe(false);
  });
});
