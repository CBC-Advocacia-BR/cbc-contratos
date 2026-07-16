// (leads Meta 14/07/2026) Protege o parser PURO dos insights da Meta
// (client/netlify/functions/_lib/metaAds.mjs) — conversas iniciadas (click-to-WhatsApp),
// lead forms e a montagem da linha mensal gravada em meta_ads_mensal.
import { describe, it, expect } from 'vitest';
import {
  actionsToCounts, insightRowToLinha, ymFirstDay, ACTION_CONVERSA,
  campaignToRow, adToRow, insightToDiario, avaliarAlertasTrafego,
} from '../../../netlify/functions/_lib/metaAds.mjs';

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

// ─── Aba Trafego (14/07/2026): catalogos + diario + motor de alertas ─────────

describe('campaignToRow — catalogo de campanhas', () => {
  it('converte campanha do Graph (budget em CENTAVOS) p/ linha meta_campanhas', () => {
    const l = campaignToRow(
      { id: '120', name: 'CTWA Distratos', effective_status: 'ACTIVE', objective: 'OUTCOME_ENGAGEMENT', daily_budget: '15000' },
      'act_1'
    );
    expect(l).toEqual({
      campaign_id: '120', account_id: 'act_1', nome: 'CTWA Distratos',
      status: 'ACTIVE', objetivo: 'OUTCOME_ENGAGEMENT', orcamento_diario: 150,
    });
  });

  it('sem daily_budget (orcamento no conjunto/CBO) -> orcamento_diario null', () => {
    const l = campaignToRow({ id: '9', name: 'X', effective_status: 'PAUSED' }, 'act_1');
    expect(l.orcamento_diario).toBe(null);
    expect(l.status).toBe('PAUSED');
  });
});

describe('adToRow — catalogo de criativos', () => {
  it('extrai miniatura e permalink do criativo', () => {
    const l = adToRow(
      { id: 'a1', name: 'Video Hook 3', effective_status: 'ACTIVE', campaign_id: '120',
        creative: { thumbnail_url: 'https://cdn.meta/t.jpg' }, preview_shareable_link: 'https://fb.com/p/a1' },
      'act_1'
    );
    expect(l).toEqual({
      ad_id: 'a1', campaign_id: '120', account_id: 'act_1', nome: 'Video Hook 3',
      status: 'ACTIVE', thumbnail_url: 'https://cdn.meta/t.jpg', permalink: 'https://fb.com/p/a1',
    });
  });

  it('sem creative/link -> campos null', () => {
    const l = adToRow({ id: 'a2', name: 'Arte', campaign_id: '120' }, 'act_1');
    expect(l.thumbnail_url).toBe(null);
    expect(l.permalink).toBe(null);
  });
});

describe('insightToDiario — metricas diarias', () => {
  const row = {
    date_start: '2026-07-10', date_stop: '2026-07-10', campaign_id: '120',
    spend: '250.50', impressions: '10000', reach: '8000', clicks: '150',
    inline_link_clicks: '90', frequency: '1.25',
    actions: [
      { action_type: 'video_view', value: '3000' },
      { action_type: ACTION_CONVERSA, value: '12' },
      { action_type: 'lead', value: '1' },
    ],
  };

  it('nivel campanha: linha completa com video_3s vindo de video_view', () => {
    const l = insightToDiario(row, 'campaign', 'act_1');
    expect(l).toEqual({
      dia: '2026-07-10', level: 'campaign', entity_id: '120', campaign_id: '120', account_id: 'act_1',
      gasto: 250.5, conversas_iniciadas: 12, leads_form: 1, impressoes: 10000, alcance: 8000,
      cliques: 150, cliques_link: 90, frequencia: 1.25, video_3s: 3000, raw: { actions: row.actions },
    });
  });

  it('nivel anuncio: entity_id = ad_id, mantem campaign_id', () => {
    const l = insightToDiario({ ...row, ad_id: 'a9' }, 'ad', 'act_1');
    expect(l.level).toBe('ad');
    expect(l.entity_id).toBe('a9');
    expect(l.campaign_id).toBe('120');
  });

  it('campos ausentes viram 0/null sem quebrar', () => {
    const l = insightToDiario({ date_start: '2026-07-01', campaign_id: '5' }, 'campaign', 'act_1');
    expect(l.gasto).toBe(0);
    expect(l.video_3s).toBe(0);
    expect(l.frequencia).toBe(null);
  });
});

describe('avaliarAlertasTrafego — motor de alertas (ontem = ultimo dia da serie)', () => {
  const config = { cpl_mult: 2, cpl_gasto_min_dia: 100, queda_leads_pct: 50 };
  // 27 dias estaveis (gasto 100, 10 leads => CPL 10) + ontem
  const diasEstaveis = Array.from({ length: 27 }, (_, i) => ({
    dia: `2026-06-${String(i + 1).padStart(2, '0')}`, gasto: 100, leads: 10,
  }));

  it('cpl_estourado dispara quando CPL de ontem > mult x media historica', () => {
    const conta = [...diasEstaveis, { dia: '2026-06-28', gasto: 300, leads: 5 }]; // CPL 60 vs media 10
    const alertas = avaliarAlertasTrafego({ conta, ontem_campanhas: [] }, config);
    const a = alertas.find((x) => x.tipo === 'cpl_estourado');
    expect(a).toBeTruthy();
    expect(a.valor).toBe(60);
    expect(a.limite).toBe(20); // 2 x media 10
  });

  it('cpl_estourado NAO dispara com gasto de ontem abaixo do minimo (anti-ruido)', () => {
    const conta = [...diasEstaveis, { dia: '2026-06-28', gasto: 50, leads: 1 }]; // CPL 50 mas gasto < 100
    const alertas = avaliarAlertasTrafego({ conta, ontem_campanhas: [] }, config);
    expect(alertas.find((x) => x.tipo === 'cpl_estourado')).toBeUndefined();
  });

  it('entrega_zerada: campanha ACTIVE com gasto 0 ontem dispara; PAUSED nao', () => {
    const alertas = avaliarAlertasTrafego({
      conta: [...diasEstaveis, { dia: '2026-06-28', gasto: 100, leads: 10 }],
      ontem_campanhas: [
        { campaign_id: '1', nome: 'Ativa Zerada', status: 'ACTIVE', gasto: 0, leads: 0 },
        { campaign_id: '2', nome: 'Pausada', status: 'PAUSED', gasto: 0, leads: 0 },
        { campaign_id: '3', nome: 'Ativa OK', status: 'ACTIVE', gasto: 80, leads: 7 },
      ],
    }, config);
    const zeradas = alertas.filter((x) => x.tipo === 'entrega_zerada');
    expect(zeradas).toHaveLength(1);
    expect(zeradas[0].campanha).toBe('Ativa Zerada');
  });

  it('queda_leads: ultimos 7 dias < pct% dos 7 anteriores', () => {
    const anteriores = Array.from({ length: 7 }, (_, i) => ({ dia: `2026-06-1${i}`, gasto: 100, leads: 100 }));
    const recentes = Array.from({ length: 7 }, (_, i) => ({ dia: `2026-06-2${i}`, gasto: 100, leads: 30 }));
    const alertas = avaliarAlertasTrafego({ conta: [...anteriores, ...recentes], ontem_campanhas: [] }, config);
    const q = alertas.find((x) => x.tipo === 'queda_leads');
    expect(q).toBeTruthy();
    expect(q.valor).toBe(210);   // leads dos ultimos 7d
    expect(q.limite).toBe(350);  // 50% dos 700 anteriores
  });

  it('serie curta ou vazia -> sem alertas (sem dados nao e problema)', () => {
    expect(avaliarAlertasTrafego({ conta: [], ontem_campanhas: [] }, config)).toEqual([]);
    expect(avaliarAlertasTrafego({ conta: diasEstaveis.slice(0, 5), ontem_campanhas: [] }, config)).toEqual([]);
  });
});
