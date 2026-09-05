import { describe, it, expect } from 'vitest';
import { formatarOferta, etapaDeEncerramento } from '../../../netlify/functions/_lib/sdrFerramentas.mjs';

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
