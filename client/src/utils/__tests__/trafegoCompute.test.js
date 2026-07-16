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
