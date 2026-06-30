// (#8/#17) Protege a logica da Saude do Funil: contagens, conversoes, mediana e gargalos.
import { describe, it, expect } from 'vitest';
import { computeFunnel, mediana, dataAssinatura } from '../../components/funnel/funnelCompute';

const NOW = new Date('2026-06-25T12:00:00Z');

const base = (over) => ({
  id: Math.random().toString(36).slice(2), nome_contratante1: 'X', resort: 'R',
  status: 'rascunho', created_at: '2026-06-01T00:00:00Z', zapsign_sent_at: null,
  signed_at: null, advbox_date: null, updated_at: null, arquivado_em: null, ...over,
});

describe('mediana', () => {
  it('par e impar, ignora nulos', () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([1, 2, 3, 4])).toBe(2.5);
    expect(mediana([5, null, undefined, NaN])).toBe(5);
    expect(mediana([])).toBe(null);
  });
});

describe('dataAssinatura — fallback signed_at -> advbox_date -> updated_at', () => {
  it('so p/ assinados, na ordem certa', () => {
    expect(dataAssinatura(base({ status: 'rascunho', signed_at: 'x' }))).toBe(null);
    expect(dataAssinatura(base({ status: 'assinado', signed_at: 'A', advbox_date: 'B' }))).toBe('A');
    expect(dataAssinatura(base({ status: 'assinado', advbox_date: 'B', updated_at: 'C' }))).toBe('B');
    expect(dataAssinatura(base({ status: 'assinado', updated_at: 'C' }))).toBe('C');
  });
});

describe('computeFunnel', () => {
  const contratos = [
    base({ status: 'rascunho' }),                                                   // criado
    base({ status: 'enviado_zapsign', zapsign_sent_at: '2026-06-23T00:00:00Z' }),   // enviado recente (2 dias)
    base({ status: 'enviado_zapsign', zapsign_sent_at: '2026-06-10T00:00:00Z' }),   // enviado travado (15 dias)
    base({ status: 'assinado', zapsign_sent_at: '2026-06-03T00:00:00Z', signed_at: '2026-06-05T00:00:00Z' }), // assinado
    base({ status: 'assinado', zapsign_sent_at: '2026-06-04T00:00:00Z', advbox_date: '2026-06-08T00:00:00Z' }), // assinado (fallback advbox)
    base({ status: 'cancelado' }),                                                  // fora
    base({ status: 'assinado', signed_at: '2026-06-09T00:00:00Z', arquivado_em: '2026-06-20T00:00:00Z' }), // arquivado -> fora
  ];
  const r = computeFunnel(contratos, NOW);

  it('conta criados/enviados/assinados ignorando cancelado e arquivado', () => {
    expect(r.funil.criados).toBe(5);   // 7 - cancelado - arquivado
    expect(r.funil.enviados).toBe(4);  // 2 enviados + 2 assinados
    expect(r.funil.assinados).toBe(2);
  });

  it('conversoes em %', () => {
    expect(Math.round(r.conversao.criadoAssinado)).toBe(40); // 2/5
    expect(Math.round(r.conversao.enviadoAssinado)).toBe(50); // 2/4
  });

  it('detecta gargalo (enviado ha >7 dias sem assinar)', () => {
    expect(r.gargalo.travados).toBe(1);
    expect(r.gargalo.lista[0].dias).toBeGreaterThan(7);
  });

  it('tempos sao numeros (mediana) ou null', () => {
    expect(r.tempos.envioAssinaturaDias).toBeGreaterThan(0);
    expect(typeof r.tempos.jornadaTotalDias === 'number').toBe(true);
  });

  it('nao quebra com lista vazia', () => {
    const z = computeFunnel([], NOW);
    expect(z.funil.criados).toBe(0);
    expect(z.conversao.criadoAssinado).toBe(0);
    expect(z.gargalo.travados).toBe(0);
    expect(z.distribuidos.total).toBe(0);
  });
});

describe('computeFunnel — etapa Distribuídos (flag c.distribuido = tem nº de processo no ADVBOX)', () => {
  const contratos = [
    base({ status: 'assinado', signed_at: '2026-06-20T00:00:00Z', distribuido: true }),  // conta
    base({ status: 'assinado', signed_at: '2026-05-10T00:00:00Z', distribuido: true }),  // conta (all-time)
    base({ status: 'assinado', advbox_date: '2026-05-01T00:00:00Z', distribuido: true }), // conta
    base({ status: 'assinado', signed_at: '2026-06-18T00:00:00Z', distribuido: false }),  // flag false -> fora
    base({ status: 'assinado', signed_at: '2026-06-19T00:00:00Z' }),                      // sem flag -> fora
    base({ status: 'enviado_zapsign', zapsign_sent_at: '2026-06-10T00:00:00Z', distribuido: true }), // não-assinado -> fora
    base({ status: 'assinado', signed_at: '2026-06-19T00:00:00Z', distribuido: true, arquivado_em: '2026-06-26T00:00:00Z' }), // arquivado -> fora
  ];
  const r = computeFunnel(contratos, NOW);
  it('total = assinados ativos com distribuido=true (all-time)', () => {
    expect(r.distribuidos.total).toBe(3);
  });
});

describe('computeFunnel — videochamadas ALL-TIME, futuras fora do comparecimento', () => {
  const vc = [
    { status: 'realizada', scheduled_at: '2026-04-10T10:00:00Z' }, // mês passado -> CONTA (all-time)
    { status: 'agendada', scheduled_at: '2026-06-10T10:00:00Z' },
    { status: 'realizada', scheduled_at: '2026-06-20T10:00:00Z' },
    { status: 'no_show', scheduled_at: '2026-06-15T10:00:00Z' },
    { status: 'agendada', scheduled_at: '2026-06-30T10:00:00Z' }, // FUTURA (> NOW 06-25) -> fora do comparecimento
  ];
  const r = computeFunnel([], NOW, vc);
  it('agendada = todas que já aconteceram (all-time); futura fora, contada à parte', () => {
    expect(r.videochamadas.agendadas).toBe(4); // abr + 3 jun passadas; jun30 (futura) fora
    expect(r.videochamadas.futuras).toBe(1);
  });
  it('realizada = subset (Manjericão+Pavão) all-time; pct sobre as que aconteceram', () => {
    expect(r.videochamadas.realizadas).toBe(2); // abr realizada + jun20 realizada
    expect(r.videochamadas.pct).toBe(50);       // 2/4
  });
  it('sem videochamadas -> zeros, sem quebrar', () => {
    const z = computeFunnel([], NOW);
    expect(z.videochamadas.agendadas).toBe(0);
    expect(z.videochamadas.pct).toBe(null);
    expect(z.videochamadas.excluidas).toBe(0);
    expect(z.videochamadas.futuras).toBe(0);
  });
});

describe('computeFunnel — videochamada: Pavão conta como realizada, excluída sai da base', () => {
  const vc = [
    { status: 'agendada', scheduled_at: '2026-06-10T10:00:00Z' },
    { status: 'realizada', scheduled_at: '2026-06-11T10:00:00Z' },
    { status: 'fechou', scheduled_at: '2026-06-12T10:00:00Z' },    // Pavão -> conta como realizada
    { status: 'no_show', scheduled_at: '2026-06-13T10:00:00Z' },
    { status: 'excluida', scheduled_at: '2026-06-14T10:00:00Z' },  // evento apagado -> fora da base
  ];
  const r = computeFunnel([], NOW, vc);
  it('base de agendadas exclui as excluídas', () => {
    expect(r.videochamadas.agendadas).toBe(4); // 5 - 1 excluida
    expect(r.videochamadas.excluidas).toBe(1);
  });
  it('realizadas = realizada + fechou (Pavão); pct sobre a base sem excluídas', () => {
    expect(r.videochamadas.realizadas).toBe(2); // realizada + fechou
    expect(r.videochamadas.pct).toBe(50);       // 2/4
  });
});

describe('computeFunnel — etapa Guia Paga/JEC (passou da citação, all-time)', () => {
  const contratos = [
    base({ status: 'assinado', signed_at: '2026-06-20T00:00:00Z', guia_paga: true }),  // conta
    base({ status: 'assinado', signed_at: '2026-04-01T00:00:00Z', guia_paga: true }),  // conta (all-time, mês passado)
    base({ status: 'assinado', signed_at: '2026-06-18T00:00:00Z', guia_paga: false }), // flag false -> fora
    base({ status: 'assinado', signed_at: '2026-06-18T00:00:00Z' }),                   // sem flag -> fora
    base({ status: 'enviado_zapsign', guia_paga: true }),                              // não-assinado -> fora
    base({ status: 'assinado', signed_at: '2026-06-19T00:00:00Z', guia_paga: true, arquivado_em: '2026-06-26T00:00:00Z' }), // arquivado -> fora
  ];
  const r = computeFunnel(contratos, NOW);
  it('conta só assinados ativos com guia_paga=true (all-time)', () => {
    expect(r.guiaPaga).toBe(2);
  });
});
