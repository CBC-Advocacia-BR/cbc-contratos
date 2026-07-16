// (aba Trafego 14/07/2026) Protege o cerebro da aba: agregacao por periodo com
// comparacao, serie diaria, metricas derivadas (CTR/CPM/CPL/hook), fadiga de
// criativo, rankings com anti-ruido e a ponte comercial mensal.
import { describe, it, expect } from 'vitest';
import {
  computeTrafego, computeComercialMensal,
  FREQ_SATURACAO, QUEDA_CTR_FADIGA, MIN_IMPRESSOES_RANKING,
} from '../../components/trafego/compute';

const AGORA = new Date('2026-07-14T12:00:00');

// helper de linha diaria (level campaign por default)
const d = (dia, over = {}) => ({
  dia, level: 'campaign', entity_id: 'c1', campaign_id: 'c1', gasto: 100,
  conversas_iniciadas: 10, leads_form: 0, impressoes: 10000, alcance: 8000,
  cliques: 200, cliques_link: 120, frequencia: 1.2, video_3s: 3000, ...over,
});

const CAMPANHAS = [
  { campaign_id: 'c1', nome: 'CTWA Distratos', status: 'ACTIVE', orcamento_diario: 150 },
  { campaign_id: 'c2', nome: 'Zumbi', status: 'ACTIVE', orcamento_diario: 50 },
];
const ANUNCIOS = [
  { ad_id: 'a1', campaign_id: 'c1', nome: 'Video Hook', thumbnail_url: 't1.jpg', status: 'ACTIVE' },
  { ad_id: 'a2', campaign_id: 'c1', nome: 'Arte Estatica', thumbnail_url: 't2.jpg', status: 'ACTIVE' },
];

describe('computeTrafego — KPIs do periodo com comparacao', () => {
  // periodo 08-14/07 (7 dias) + periodo anterior 01-07/07
  const diario = [
    ...Array.from({ length: 7 }, (_, i) => d(`2026-07-0${i + 1}`, { gasto: 50, conversas_iniciadas: 5 })),  // anterior
    ...Array.from({ length: 7 }, (_, i) => d(`2026-07-${String(i + 8).padStart(2, '0')}`)),                  // atual
    // linha de AD no mesmo dia — NAO pode dobrar os KPIs (que usam level=campaign)
    d('2026-07-10', { level: 'ad', entity_id: 'a1', gasto: 999, conversas_iniciadas: 99 }),
  ];
  const r = computeTrafego({ diario, campanhas: CAMPANHAS, anuncios: ANUNCIOS, inicio: '2026-07-08', fim: '2026-07-14', agora: AGORA });

  it('agrega SO level=campaign nos KPIs (linha de anuncio nao dobra)', () => {
    expect(r.kpis.gasto).toBe(700);
    expect(r.kpis.leads).toBe(70);
    expect(r.kpis.cpl).toBe(10);
  });

  it('CTR = cliques_link/impressoes; CPM = gasto/impressoes*1000', () => {
    expect(r.kpis.ctr).toBeCloseTo((120 * 7) / (10000 * 7) * 100, 5); // em %
    expect(r.kpis.cpm).toBeCloseTo(700 / 70000 * 1000, 5);
  });

  it('comparacao com o periodo anterior de mesma duracao (delta %)', () => {
    expect(r.kpis.prev.gasto).toBe(350);
    expect(r.kpis.prev.leads).toBe(35);
    expect(r.kpis.delta.gasto).toBe(100); // dobrou
    expect(r.kpis.delta.leads).toBe(100);
  });

  it('serie diaria ordenada, com cpl null em dia sem lead', () => {
    const diario2 = [d('2026-07-09', { conversas_iniciadas: 0 }), d('2026-07-08')];
    const r2 = computeTrafego({ diario: diario2, campanhas: CAMPANHAS, anuncios: [], inicio: '2026-07-08', fim: '2026-07-09', agora: AGORA });
    expect(r2.serie.map((s) => s.dia)).toEqual(['2026-07-08', '2026-07-09']);
    expect(r2.serie[0].cpl).toBe(10);
    expect(r2.serie[1].cpl).toBe(null);
  });
});

describe('computeTrafego — campanhas e atencao', () => {
  it('campanha ACTIVE sem gasto no periodo ganha atencao "zerada"', () => {
    const diario = [d('2026-07-10')]; // so c1 gastou
    const r = computeTrafego({ diario, campanhas: CAMPANHAS, anuncios: [], inicio: '2026-07-08', fim: '2026-07-14', agora: AGORA });
    const zumbi = r.campanhas.find((c) => c.campaign_id === 'c2');
    expect(zumbi.gasto).toBe(0);
    expect(zumbi.atencao).toBe('zerada');
    const ativa = r.campanhas.find((c) => c.campaign_id === 'c1');
    expect(ativa.atencao).toBe(null);
  });

  it('campanha com CPL muito acima da media da conta ganha atencao "cpl"', () => {
    const diario = [
      d('2026-07-10', { campaign_id: 'c1', entity_id: 'c1', gasto: 100, conversas_iniciadas: 20 }), // cpl 5
      d('2026-07-10', { campaign_id: 'c2', entity_id: 'c2', gasto: 100, conversas_iniciadas: 2 }),  // cpl 50 >> media
    ];
    const r = computeTrafego({ diario, campanhas: CAMPANHAS, anuncios: [], inicio: '2026-07-08', fim: '2026-07-14', agora: AGORA });
    expect(r.campanhas.find((c) => c.campaign_id === 'c2').atencao).toBe('cpl');
  });
});

describe('computeTrafego — criativos: hook rate e fadiga', () => {
  it('hookRate = video_3s/impressoes; null p/ criativo sem video', () => {
    const diario = [
      d('2026-07-10', { level: 'ad', entity_id: 'a1', video_3s: 4000, impressoes: 10000 }),
      d('2026-07-10', { level: 'ad', entity_id: 'a2', video_3s: 0, impressoes: 8000 }),
    ];
    const r = computeTrafego({ diario, campanhas: CAMPANHAS, anuncios: ANUNCIOS, inicio: '2026-07-08', fim: '2026-07-14', agora: AGORA });
    expect(r.criativos.find((c) => c.ad_id === 'a1').hookRate).toBeCloseTo(40, 5); // em %
    expect(r.criativos.find((c) => c.ad_id === 'a2').hookRate).toBe(null);
  });

  it(`saturando = frequencia >= ${FREQ_SATURACAO} E CTR < ${QUEDA_CTR_FADIGA}x o do periodo anterior`, () => {
    const diario = [
      // periodo anterior (01-07): CTR 2% e freq baixa
      d('2026-07-03', { level: 'ad', entity_id: 'a1', impressoes: 10000, cliques_link: 200, frequencia: 2 }),
      // periodo atual (08-14): CTR 1% (caiu 50%) e freq alta
      d('2026-07-10', { level: 'ad', entity_id: 'a1', impressoes: 10000, cliques_link: 100, frequencia: 4 }),
      // a2: freq alta mas CTR estavel -> NAO satura
      d('2026-07-03', { level: 'ad', entity_id: 'a2', impressoes: 10000, cliques_link: 100, frequencia: 4 }),
      d('2026-07-10', { level: 'ad', entity_id: 'a2', impressoes: 10000, cliques_link: 100, frequencia: 4 }),
    ];
    const r = computeTrafego({ diario, campanhas: CAMPANHAS, anuncios: ANUNCIOS, inicio: '2026-07-08', fim: '2026-07-14', agora: AGORA });
    expect(r.criativos.find((c) => c.ad_id === 'a1').saturando).toBe(true);
    expect(r.criativos.find((c) => c.ad_id === 'a2').saturando).toBe(false);
  });
});

describe('computeTrafego — rankings com anti-ruido', () => {
  const diario = [
    d('2026-07-10', { level: 'ad', entity_id: 'a1', impressoes: 10000, cliques_link: 500, gasto: 100, conversas_iniciadas: 20, video_3s: 5000 }), // ctr 5, cpl 5
    d('2026-07-10', { level: 'ad', entity_id: 'a2', impressoes: 10000, cliques_link: 200, gasto: 100, conversas_iniciadas: 4, video_3s: 0 }),     // ctr 2, cpl 25, SEM video
    // ruido: 100 impressoes (abaixo do minimo) com ctr 50% — NAO pode ranquear
    d('2026-07-10', { level: 'ad', entity_id: 'a3', impressoes: 100, cliques_link: 50, gasto: 10, conversas_iniciadas: 1 }),
  ];
  const anuncios = [...ANUNCIOS, { ad_id: 'a3', campaign_id: 'c1', nome: 'Ruido', thumbnail_url: null, status: 'ACTIVE' }];
  const r = computeTrafego({ diario, campanhas: CAMPANHAS, anuncios, inicio: '2026-07-08', fim: '2026-07-14', agora: AGORA });

  it(`exclui criativos com menos de ${MIN_IMPRESSOES_RANKING} impressoes`, () => {
    expect(r.rankings.ctr.find((c) => c.ad_id === 'a3')).toBeUndefined();
  });

  it('ordena: ctr desc, cpl asc (so com lead), leads desc, hook desc', () => {
    expect(r.rankings.ctr[0].ad_id).toBe('a1');
    expect(r.rankings.cpl[0].ad_id).toBe('a1');
    expect(r.rankings.leads[0].ad_id).toBe('a1');
    expect(r.rankings.hook[0].ad_id).toBe('a1');
    expect(r.rankings.hook.find((c) => c.ad_id === 'a2')).toBeUndefined(); // sem video
  });
});

describe('computeComercialMensal — do anuncio ao contrato', () => {
  const mensal = [
    { mes: '2026-06-01', conversas_iniciadas: 400, leads_form: 35, gasto: 6960 },
    { mes: '2026-07-01', conversas_iniciadas: 260, leads_form: 0, gasto: 3164 },
  ];
  const videochamadas = [
    { status: 'realizada', scheduled_at: '2026-06-20T10:00:00Z' },
    { status: 'agendada', scheduled_at: '2026-06-10T10:00:00Z' },
    { status: 'excluida', scheduled_at: '2026-06-11T10:00:00Z' }, // fora
    { status: 'realizada', scheduled_at: '2026-07-02T10:00:00Z' },
  ];
  const contratos = [
    { status: 'assinado', zapsign_sent_at: '2026-06-05T00:00:00Z', signed_at: '2026-06-08T00:00:00Z', arquivado_em: null },
    { status: 'enviado_zapsign', zapsign_sent_at: '2026-06-20T00:00:00Z', arquivado_em: null },
    { status: 'assinado', zapsign_sent_at: '2026-07-01T00:00:00Z', advbox_date: '2026-07-03T00:00:00Z', signed_at: null, arquivado_em: null },
    { status: 'cancelado', zapsign_sent_at: '2026-06-21T00:00:00Z', arquivado_em: null },              // fora
    { status: 'assinado', signed_at: '2026-06-09T00:00:00Z', arquivado_em: '2026-06-30T00:00:00Z' },   // arquivado fora
  ];
  const r = computeComercialMensal({ mensal, videochamadas, contratos, meses: 2, agora: AGORA });

  it('mapeia os ultimos N meses com leads/gasto/videochamadas/enviados/assinados', () => {
    expect(r.map((m) => m.mes)).toEqual(['2026-06', '2026-07']);
    const jun = r[0];
    expect(jun.leads).toBe(435);
    expect(jun.videochamadas).toBe(2); // excluida fora
    expect(jun.enviados).toBe(2);      // assinado enviado em jun + enviado_zapsign (cancelado fora)
    expect(jun.assinados).toBe(1);
    expect(jun.custoPorAssinado).toBe(6960);
  });

  it('assinado usa data efetiva (advbox_date como fallback) e mes sem assinatura -> custo null', () => {
    const jul = r[1];
    expect(jul.assinados).toBe(1); // advbox_date 03/07
    expect(jul.custoPorAssinado).toBe(3164);
    const r2 = computeComercialMensal({ mensal, videochamadas: [], contratos: [], meses: 2, agora: AGORA });
    expect(r2[1].assinados).toBe(0);
    expect(r2[1].custoPorAssinado).toBe(null);
  });
});

// ═══ v2 (16/07/2026) — onda de 64 melhorias ═══════════════════════════════════
import {
  computeCurvaCriativo, computeTemas, montarResumoPeriodo, computeRecomendacoes,
  ORIGENS_META,
} from '../../components/trafego/compute';

const CAMP_V2 = [
  { campaign_id: 'c1', nome: 'CTWA Distratos', status: 'ACTIVE', orcamento_diario: 150 },
  { campaign_id: 'c2', nome: 'Remarketing', status: 'ACTIVE', orcamento_diario: 50 },
  { campaign_id: 'rh1', nome: '[VAGA] Advogado', status: 'ACTIVE', orcamento_diario: 30 },
];

describe('v2 — campanhas de RH fora de TODA a captacao', () => {
  const diario = [
    d('2026-07-10', { entity_id: 'c1', campaign_id: 'c1', gasto: 100, conversas_iniciadas: 10 }),
    d('2026-07-10', { entity_id: 'rh1', campaign_id: 'rh1', gasto: 500, conversas_iniciadas: 50 }), // RH: fora
    d('2026-07-10', { level: 'ad', entity_id: 'a1', campaign_id: 'c1', impressoes: 10000, cliques_link: 500, gasto: 100, conversas_iniciadas: 10 }),
    d('2026-07-10', { level: 'ad', entity_id: 'aRH', campaign_id: 'rh1', impressoes: 90000, cliques_link: 9000, gasto: 500, conversas_iniciadas: 50 }),
  ];
  const anuncios = [
    { ad_id: 'a1', campaign_id: 'c1', nome: '[VD] Bom', status: 'ACTIVE' },
    { ad_id: 'aRH', campaign_id: 'rh1', nome: 'Curriculo Já', status: 'ACTIVE' },
  ];
  const r = computeTrafego({ diario, campanhas: CAMP_V2, anuncios, inicio: '2026-07-08', fim: '2026-07-14' });

  it('KPIs ignoram gasto/leads de campanhas de vaga', () => {
    expect(r.kpis.gasto).toBe(100);
    expect(r.kpis.leads).toBe(10);
  });
  it('campanha RH vem flagada e fora do donut; criativo de RH fora dos rankings', () => {
    expect(r.campanhas.find((c) => c.campaign_id === 'rh1').rh).toBe(true);
    expect(r.donut.find((x) => x.campaign_id === 'rh1')).toBeUndefined();
    expect(r.rankings.ctr.find((x) => x.ad_id === 'aRH')).toBeUndefined();
  });
});

describe('v2 — serie com media movel 7d e leads de hoje', () => {
  const diario = Array.from({ length: 10 }, (_, i) => d(`2026-07-${String(i + 5).padStart(2, '0')}`, { conversas_iniciadas: i + 1 }));
  const r = computeTrafego({ diario, campanhas: CAMP_V2, anuncios: [], inicio: '2026-07-08', fim: '2026-07-14', hoje: '2026-07-14' });
  it('mm7 = media dos 7 dias ate o dia (usa dias anteriores ao periodo)', () => {
    const ult = r.serie[r.serie.length - 1]; // dia 14 -> leads 8..2? dias 08..14 = leads 4..10; mm7 do dia 14 = media(4..10)=7
    expect(ult.mm7).toBe(7);
  });
  it('leadsHoje soma o dia corrente', () => {
    expect(r.kpis.leadsHoje).toBe(10); // dia 14 = i9 -> 10 conversas
  });
});

describe('v2 — meta mensal, projecao e share', () => {
  const diario = Array.from({ length: 14 }, (_, i) => d(`2026-07-${String(i + 1).padStart(2, '0')}`, { conversas_iniciadas: 10, gasto: 100 }));
  const r = computeTrafego({ diario, campanhas: CAMP_V2, anuncios: [], inicio: '2026-07-01', fim: '2026-07-14', hoje: '2026-07-14', metas: { leads_mes: 400 } });
  it('metaLeads: progresso do mes corrente contra a meta', () => {
    expect(r.metaMensal.leads).toBe(140);
    expect(r.metaMensal.metaLeads).toBe(400);
    expect(r.metaMensal.pct).toBe(35);
  });
  it('projecao de fim de mes pelo ritmo (140 em 14 dias -> 310 em 31)', () => {
    expect(r.metaMensal.projecaoLeads).toBe(310);
  });
  it('share da maior campanha', () => {
    expect(r.kpis.shareMaiorCampanha).toBe(100); // so c1 tem leads
  });
});

describe('v2 — retencao de video e queda do hook', () => {
  const diario = [
    d('2026-07-10', { level: 'ad', entity_id: 'a1', campaign_id: 'c1', impressoes: 10000, video_3s: 4000, video_thruplay: 1000, video_p25: 3000, video_p50: 2000, video_p75: 1200, video_p100: 600, gasto: 50, conversas_iniciadas: 5 }),
  ];
  const anuncios = [{ ad_id: 'a1', campaign_id: 'c1', nome: '[VD] X', status: 'ACTIVE' }];
  const r = computeTrafego({ diario, campanhas: CAMP_V2, anuncios, inicio: '2026-07-08', fim: '2026-07-14' });
  it('retencao p25..p100 em % das impressoes e thruplay rate', () => {
    const a = r.criativos.find((c) => c.ad_id === 'a1');
    expect(a.retencao.p25).toBeCloseTo(30, 3);
    expect(a.retencao.p100).toBeCloseTo(6, 3);
    expect(a.thruplayRate).toBeCloseTo(10, 3);
    expect(a.quedaHook).toBeCloseTo(25, 3); // thruplay/3s = 1000/4000
  });
});

describe('v2 — curva do criativo e previsao de saturacao', () => {
  const diario = [];
  for (let i = 0; i < 21; i++) {
    const dia = `2026-06-${String(i + 4).padStart(2, '0')}`;
    diario.push(d(dia, { level: 'ad', entity_id: 'a1', campaign_id: 'c1', impressoes: 1000, cliques_link: 30 - i, frequencia: 1 + i * 0.1, gasto: 10, conversas_iniciadas: 1 }));
  }
  it('computeCurvaCriativo agrupa por semana com ctr/freq', () => {
    const curva = computeCurvaCriativo(diario, 'a1');
    expect(curva.length).toBeGreaterThanOrEqual(3);
    expect(curva[0].ctr).toBeGreaterThan(curva[curva.length - 1].ctr); // caindo
  });
  it('previsao: dias ate freq 3.5 pela inclinacao recente', () => {
    const r = computeTrafego({ diario, campanhas: CAMP_V2, anuncios: [{ ad_id: 'a1', campaign_id: 'c1', nome: 'X', status: 'ACTIVE' }], inicio: '2026-06-18', fim: '2026-06-24' });
    const a = r.criativos.find((c) => c.ad_id === 'a1');
    expect(a.saturaEmDias).toBeGreaterThan(0);
    expect(a.saturaEmDias).toBeLessThan(30);
  });
});

describe('v2 — ranking dos piores e conjuntos', () => {
  const diario = [
    d('2026-07-10', { level: 'ad', entity_id: 'a1', campaign_id: 'c1', impressoes: 8000, cliques_link: 100, gasto: 300, conversas_iniciadas: 2 }),  // cpl 150 (ruim)
    d('2026-07-10', { level: 'ad', entity_id: 'a2', campaign_id: 'c1', impressoes: 8000, cliques_link: 100, gasto: 100, conversas_iniciadas: 20 }), // cpl 5 (bom)
    d('2026-07-10', { level: 'adset', entity_id: 's1', campaign_id: 'c1', gasto: 200, conversas_iniciadas: 10, impressoes: 9000, cliques_link: 90 }),
  ];
  const anuncios = [
    { ad_id: 'a1', campaign_id: 'c1', nome: 'Ruim', status: 'ACTIVE' },
    { ad_id: 'a2', campaign_id: 'c1', nome: 'Bom', status: 'ACTIVE' },
  ];
  const conjuntos = [{ adset_id: 's1', campaign_id: 'c1', nome: 'LAL 3%', status: 'ACTIVE' }];
  const r = computeTrafego({ diario, campanhas: CAMP_V2, anuncios, conjuntos, inicio: '2026-07-08', fim: '2026-07-14' });
  it('piores = CPL alto com gasto relevante, ordem desc', () => {
    expect(r.rankings.piores[0].ad_id).toBe('a1');
    expect(r.rankings.piores.find((x) => x.ad_id === 'a2')).toBeUndefined(); // cpl bom nao entra
  });
  it('conjuntos agregados com metricas do periodo', () => {
    const s = r.conjuntos.find((x) => x.adset_id === 's1');
    expect(s.leads).toBe(10);
    expect(s.cpl).toBe(20);
  });
});

describe('v2 — temas por regra de nome, anomalias e textos', () => {
  it('computeTemas agrupa pelo prefixo entre colchetes', () => {
    const temas = computeTemas([
      { ad_id: '1', nome: '[VD] Ondas 3', gasto: 100, leads: 10, impressoes: 5000, cliquesLink: 100 },
      { ad_id: '2', nome: '[VD] Praia', gasto: 100, leads: 10, impressoes: 5000, cliquesLink: 100 },
      { ad_id: '3', nome: '[IMG] Arte azul', gasto: 50, leads: 1, impressoes: 2000, cliquesLink: 20 },
      { ad_id: '4', nome: 'Sem tag', gasto: 10, leads: 1, impressoes: 500, cliquesLink: 5 },
    ]);
    const vd = temas.find((t) => t.tema === 'VD');
    expect(vd.n).toBe(2);
    expect(vd.leads).toBe(20);
    expect(temas.find((t) => t.tema === 'Sem tag' || t.tema === 'Outros')).toBeTruthy();
  });

  it('anomalias: z-score do CPL diario aponta o dia fora da curva', () => {
    const diario = [
      ...Array.from({ length: 20 }, (_, i) => d(`2026-06-${String(i + 1).padStart(2, '0')}`, { gasto: 100, conversas_iniciadas: 10 })),
      d('2026-06-21', { gasto: 100, conversas_iniciadas: 1 }), // cpl 100 vs 10
    ];
    const r = computeTrafego({ diario, campanhas: CAMP_V2, anuncios: [], inicio: '2026-06-01', fim: '2026-06-21' });
    expect(r.anomalias.length).toBeGreaterThanOrEqual(1);
    expect(r.anomalias[0].dia).toBe('2026-06-21');
  });

  it('resumo natural cita leads e variacao; recomendacoes apontam campanha cara', () => {
    const diario = [
      ...Array.from({ length: 7 }, (_, i) => d(`2026-07-0${i + 1}`, { gasto: 50, conversas_iniciadas: 5 })),
      ...Array.from({ length: 7 }, (_, i) => d(`2026-07-${String(i + 8).padStart(2, '0')}`, { gasto: 100, conversas_iniciadas: 10 })),
      d('2026-07-10', { entity_id: 'c2', campaign_id: 'c2', gasto: 400, conversas_iniciadas: 2 }),
    ];
    const r = computeTrafego({ diario, campanhas: CAMP_V2, anuncios: [], inicio: '2026-07-08', fim: '2026-07-14' });
    const resumo = montarResumoPeriodo(r);
    expect(resumo).toContain('leads');
    const recs = computeRecomendacoes(r);
    expect(recs.some((x) => x.texto.includes('Remarketing'))).toBe(true);
  });
});

describe('v2 — comparacao custom e comercial expandido', () => {
  it('comparar: {inicio,fim} substitui o periodo anterior automatico', () => {
    const diario = [
      d('2026-05-10', { gasto: 100, conversas_iniciadas: 10 }),
      d('2026-07-10', { gasto: 300, conversas_iniciadas: 30 }),
    ];
    const r = computeTrafego({ diario, campanhas: CAMP_V2, anuncios: [], inicio: '2026-07-08', fim: '2026-07-14', comparar: { inicio: '2026-05-08', fim: '2026-05-14' } });
    expect(r.kpis.prev.gasto).toBe(100);
    expect(r.kpis.delta.gasto).toBe(200);
  });

  it('comercial v2: custos por etapa, taxas, ticket, origem Meta e payback', () => {
    const mensal = [{ mes: '2026-06-01', conversas_iniciadas: 100, leads_form: 0, gasto: 1000 }];
    const videochamadas = Array.from({ length: 20 }, (_, i) => ({ status: 'realizada', scheduled_at: `2026-06-${String(i + 1).padStart(2, '0')}T10:00:00Z` }));
    const contratos = [
      { status: 'assinado', zapsign_sent_at: '2026-06-05T00:00:00Z', signed_at: '2026-06-08T00:00:00Z', arquivado_em: null, honorarios_total: 3000, cpf: '111', origem: 'Facebook' },
      { status: 'assinado', zapsign_sent_at: '2026-06-06T00:00:00Z', signed_at: '2026-06-09T00:00:00Z', arquivado_em: null, honorarios_total: 5000, cpf: '222', origem: 'Indicacao' },
      { status: 'enviado_zapsign', zapsign_sent_at: '2026-06-20T00:00:00Z', arquivado_em: null, honorarios_total: 0, cpf: '333', origem: '' },
    ];
    const boletosPagos = [
      { cpf: '111', valor: 1000, pago_em: '2026-06-20' },
      { cpf: '111', valor: 500, pago_em: '2026-07-05' },
      { cpf: '999', valor: 800, pago_em: '2026-06-21' }, // cliente fora da coorte
    ];
    const r = computeComercialMensal({ mensal, videochamadas, contratos, boletosPagos, meses: 2, agora: new Date('2026-07-14T12:00:00') });
    const jun = r.find((m) => m.mes === '2026-06');
    expect(jun.custoPorVideochamada).toBe(50);      // 1000/20
    expect(jun.custoPorEnviado).toBeCloseTo(333.33, 1); // 1000/3
    expect(jun.taxaLeadVc).toBe(20);                 // 20/100
    expect(jun.taxaVcEnviado).toBe(15);              // 3/20
    expect(jun.taxaEnviadoAssinado).toBeCloseTo(66.7, 1); // 2/3
    expect(jun.ticketMedio).toBe(4000);
    expect(jun.receita).toBe(8000);
    expect(jun.assinadosMeta).toBe(1);               // origem Facebook
    expect(jun.recebido).toBe(1500);                 // boletos do cpf 111 (coorte jun)
    expect(jun.paybackPct).toBe(150);                // 1500/1000
    expect(ORIGENS_META).toContain('facebook');
  });
});

// (v2 #196/#200) Validacao com DADOS REAIS de producao: amostra do espelho
// (08-12/07/2026) com os totais esperados calculados por SQL independente.
// Prova de fogo da exclusao RH: a [VAGA] Advogado teve gasto e 6 lead forms
// no periodo e NAO pode entrar nos KPIs de captacao.
import fixtureReal from './fixtures/trafego-real.json';

describe('v2 — validacao com dados reais do espelho (fixture 08-12/07/2026)', () => {
  const r = computeTrafego({
    diario: fixtureReal.linhas,
    campanhas: fixtureReal.campanhas,
    anuncios: [],
    inicio: '2026-07-08',
    fim: '2026-07-12',
  });
  it('KPIs batem com o SQL independente (sem a campanha de RH)', () => {
    expect(r.kpis.gasto).toBeCloseTo(fixtureReal.esperado.gasto_capta, 2);
    expect(r.kpis.leads).toBe(fixtureReal.esperado.leads_capta);
  });
  it('a campanha de vaga aparece flagada e sem poluir o donut', () => {
    expect(r.campanhas.find((c) => c.nome === '[VAGA] Advogado').rh).toBe(true);
    expect(r.donut.every((x) => x.nome !== '[VAGA] Advogado')).toBe(true);
  });
  it('serie cobre os 5 dias reais', () => {
    expect(r.serie.map((s) => s.dia)).toEqual(['2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12']);
  });
});
