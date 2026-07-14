// (leads Meta 14/07/2026) Protege o parser PURO dos insights da Meta
// (client/netlify/functions/_lib/metaAds.mjs) — conversas iniciadas (click-to-WhatsApp),
// lead forms e a montagem da linha mensal gravada em meta_ads_mensal.
import { describe, it, expect } from 'vitest';
import { actionsToCounts, insightRowToLinha, ymFirstDay, ACTION_CONVERSA } from '../../../netlify/functions/_lib/metaAds.mjs';

describe('actionsToCounts', () => {
  it('soma conversas iniciadas e lead forms, ignora o resto', () => {
    const r = actionsToCounts([
      { action_type: ACTION_CONVERSA, value: '42' },
      { action_type: ACTION_CONVERSA, value: 8 },
      { action_type: 'lead', value: '3' },
      { action_type: 'leadgen_grouped', value: 2 },
      { action_type: 'link_click', value: 999 },
      { action_type: 'post_engagement', value: '55' },
    ]);
    expect(r.conversas).toBe(50);
    expect(r.leadsForm).toBe(5);
  });

  it('tolera actions ausente/vazio e valores invalidos', () => {
    expect(actionsToCounts(undefined)).toEqual({ conversas: 0, leadsForm: 0 });
    expect(actionsToCounts([])).toEqual({ conversas: 0, leadsForm: 0 });
    expect(actionsToCounts([{ action_type: ACTION_CONVERSA, value: 'x' }])).toEqual({ conversas: 0, leadsForm: 0 });
  });
});

describe('insightRowToLinha', () => {
  it('monta a linha mensal no formato da RPC meta_ads_upsert', () => {
    const row = {
      date_start: '2026-06-01', date_stop: '2026-06-30',
      campaign_id: '1200', campaign_name: 'CTWA Distratos',
      spend: '1234.56', impressions: '9999', clicks: '321',
      actions: [{ action_type: ACTION_CONVERSA, value: '77' }, { action_type: 'lead', value: '3' }],
    };
    const l = insightRowToLinha(row, 'act_969110338250520');
    expect(l).toEqual({
      mes: '2026-06-01',
      account_id: 'act_969110338250520',
      campaign_id: '1200',
      campaign_name: 'CTWA Distratos',
      conversas_iniciadas: 77,
      leads_form: 3,
      gasto: 1234.56,
      impressoes: 9999,
      cliques: 321,
      raw: { actions: row.actions },
    });
  });

  it('numeros ausentes viram 0 e nome ausente vira vazio', () => {
    const l = insightRowToLinha({ date_start: '2026-05-03', campaign_id: '9' }, 'act_1');
    expect(l.mes).toBe('2026-05-01'); // sempre 1o dia do mes
    expect(l.conversas_iniciadas).toBe(0);
    expect(l.gasto).toBe(0);
    expect(l.campaign_name).toBe('');
  });
});

describe('ymFirstDay', () => {
  it('devolve o 1o dia do mes em UTC (YYYY-MM-01)', () => {
    expect(ymFirstDay(new Date(Date.UTC(2026, 6, 14)))).toBe('2026-07-01');
    expect(ymFirstDay(new Date(Date.UTC(2025, 0, 31)))).toBe('2025-01-01');
  });
});
