// (auditoria #53) Protege o "cerebro" do Dashboard (components/dashboard/compute.js):
// data de assinatura efetiva, funil CUMULATIVO, exclusao de arquivados, janela por
// periodo e idsFiltrados. Esse redesign ja teve bugs de "numeros divergentes" — aqui
// fica a rede de seguranca que refaz as contas sozinha a cada mudanca.
import { describe, it, expect } from 'vitest';
import {
  getSignedDate,
  monthKeyOf,
  monthLabelOf,
  resolvePeriodo,
  normalizeContrato,
  computeDashboard,
} from '../../components/dashboard/compute';

// `now` fixo p/ determinismo (junho/2026).
const NOW = new Date('2026-06-15T12:00:00');

let _id = 0;
function contrato(over = {}) {
  return {
    id: over.id ?? ++_id,
    status: 'rascunho',
    created_at: '2026-06-10T10:00:00Z',
    arquivado_em: null,
    resort: 'Resort A',
    tipo_acao: 'Ação de cobrança',
    honorarios_total: 1000,
    honorarios_percentual_exito: 0,
    signed_at: null,
    advbox_date: null,
    updated_at: '2026-06-11T10:00:00Z',
    distribuido: false,
    guia_paga: false,
    ...over,
  };
}

describe('getSignedDate — data de assinatura efetiva', () => {
  it('retorna null quando o contrato nao esta assinado', () => {
    expect(getSignedDate(contrato({ status: 'enviado_zapsign', signed_at: '2026-06-01' }))).toBeNull();
  });
  it('usa signed_at quando existe', () => {
    const d = getSignedDate(contrato({ status: 'assinado', signed_at: '2026-06-05T00:00:00Z' }));
    expect(d).toBeInstanceOf(Date);
    expect(d.getUTCFullYear()).toBe(2026);
  });
  it('cai para advbox_date quando falta signed_at', () => {
    const d = getSignedDate(contrato({ status: 'assinado', signed_at: null, advbox_date: '2026-06-07T00:00:00Z' }));
    expect(d.getUTCMonth()).toBe(5); // junho
  });
  it('cai para updated_at quando faltam signed_at e advbox_date', () => {
    const d = getSignedDate(contrato({ status: 'assinado', signed_at: null, advbox_date: null, updated_at: '2026-06-09T00:00:00Z' }));
    expect(d).toBeInstanceOf(Date);
  });
  it('retorna null quando nao ha nenhuma data', () => {
    expect(getSignedDate(contrato({ status: 'assinado', signed_at: null, advbox_date: null, updated_at: null }))).toBeNull();
  });
});

describe('helpers de mes', () => {
  it('monthKeyOf formata AAAA-MM', () => {
    expect(monthKeyOf(new Date('2026-06-15T12:00:00'))).toBe('2026-06');
    expect(monthKeyOf(new Date('2026-01-02T12:00:00'))).toBe('2026-01');
  });
  it('monthLabelOf formata mes/ano-curto', () => {
    expect(monthLabelOf('2026-06')).toBe('jun/26');
    expect(monthLabelOf('2026-01')).toBe('jan/26');
  });
});

describe('resolvePeriodo', () => {
  it('"tudo"/default nao aplica intervalo', () => {
    const r = resolvePeriodo('tudo', null, null, NOW);
    expect(r.start).toBeNull();
    expect(r.end).toBeNull();
  });
  it('"mes" comeca no dia 1 do mes corrente', () => {
    const r = resolvePeriodo('mes', null, null, NOW);
    expect(r.start.getFullYear()).toBe(2026);
    expect(r.start.getMonth()).toBe(5); // junho
    expect(r.start.getDate()).toBe(1);
  });
  it('"ano" comeca em 1 de janeiro', () => {
    const r = resolvePeriodo('ano', null, null, NOW);
    expect(r.start.getMonth()).toBe(0);
    expect(r.start.getDate()).toBe(1);
  });
});

describe('normalizeContrato', () => {
  it('preserva contratantes de dados e monta o dados slim', () => {
    const n = normalizeContrato({ id: 1, status: 'rascunho', dados: { contratantes: [{ nome: 'X' }], origemCliente: 'Google', dataPrimeiraMensagem: '2026-01-01' } });
    expect(n.contratantes_j).toEqual([{ nome: 'X' }]);
    expect(n.dados.origemCliente).toBe('Google');
    expect(n.dados.dataPrimeiraMensagem).toBe('2026-01-01');
  });
  it('retorna null para linha vazia', () => {
    expect(normalizeContrato(null)).toBeNull();
  });
});

describe('computeDashboard — regras de precisao', () => {
  it('exclui arquivados por padrao e os inclui sob demanda', () => {
    const dados = [
      contrato({ id: 1, status: 'assinado' }),
      contrato({ id: 2, status: 'assinado', arquivado_em: '2026-06-01T00:00:00Z' }),
    ];
    const semArq = computeDashboard(dados, { periodo: 'tudo' }, 15, NOW);
    expect(semArq.scope.totalLinhas).toBe(2);
    expect(semArq.scope.arquivados).toBe(1);
    expect(semArq.total).toBe(1); // so o nao-arquivado entra nas metricas

    const comArq = computeDashboard(dados, { periodo: 'tudo', incluirArquivados: true }, 15, NOW);
    expect(comArq.total).toBe(2);
  });

  it('funil e CUMULATIVO: criados >= enviados >= assinados', () => {
    const dados = [
      contrato({ id: 1, status: 'rascunho' }),
      contrato({ id: 2, status: 'enviado_zapsign' }),
      contrato({ id: 3, status: 'assinado', signed_at: '2026-06-12T00:00:00Z' }),
    ];
    const d = computeDashboard(dados, { periodo: 'tudo' }, 15, NOW);
    expect(d.funil.criados).toBe(3);
    expect(d.funil.enviados).toBe(2); // enviado + assinado
    expect(d.funil.assinados).toBe(1);
    expect(d.funil.criados).toBeGreaterThanOrEqual(d.funil.enviados);
    expect(d.funil.enviados).toBeGreaterThanOrEqual(d.funil.assinados);
  });

  it('idsFiltrados casa com o total do escopo', () => {
    const dados = [contrato({ id: 1 }), contrato({ id: 2 }), contrato({ id: 3 })];
    const d = computeDashboard(dados, { periodo: 'tudo' }, 15, NOW);
    expect(d.idsFiltrados).toHaveLength(d.total);
    expect(new Set(d.idsFiltrados)).toEqual(new Set([1, 2, 3]));
  });

  it('filtra por resort sem afetar as opcoes de filtro (derivadas do conjunto todo)', () => {
    const dados = [
      contrato({ id: 1, resort: 'Resort A' }),
      contrato({ id: 2, resort: 'Resort B' }),
    ];
    const d = computeDashboard(dados, { periodo: 'tudo', resort: 'Resort A' }, 15, NOW);
    expect(d.total).toBe(1);
    expect(d.filtros.resorts).toEqual(expect.arrayContaining(['Resort A', 'Resort B']));
  });

  it('assinadosMes conta a assinatura do mes corrente pela data efetiva', () => {
    const dados = [
      contrato({ id: 1, status: 'assinado', signed_at: '2026-06-05T00:00:00Z' }), // mes corrente
      contrato({ id: 2, status: 'assinado', signed_at: '2026-04-05T00:00:00Z' }), // mes antigo
    ];
    const d = computeDashboard(dados, { periodo: 'tudo' }, 15, NOW);
    expect(d.assinadosMes).toBe(1);
  });
});

describe('computeDashboard — etapa "Leads de campanha (Meta)" no funil (14/07/2026)', () => {
  // meta_ads_mensal e MENSAL: entram os meses que intersectam o periodo selecionado
  // (mes parcial conta inteiro — granularidade dos insights e por mes-calendario).
  const metaAds = [
    { mes: '2026-04-01', conversas_iniciadas: 500, leads_form: 0, gasto: 5000 },
    { mes: '2026-05-01', conversas_iniciadas: 700, leads_form: 0, gasto: 7000 },
    { mes: '2026-06-01', conversas_iniciadas: 400, leads_form: 35, gasto: 6960 },
  ];
  const vcJunho = [
    { status: 'realizada', scheduled_at: '2026-06-05T10:00:00Z' },
    { status: 'agendada', scheduled_at: '2026-06-06T10:00:00Z' },
  ];

  it('mes_passado (NOW=15/06) = so maio: leads, gasto e CPL', () => {
    const d = computeDashboard([], { periodo: 'mes_passado', metaAds, videochamadas: [] }, 15, NOW);
    expect(d.funil.leadsMeta).toBe(700);
    expect(d.funil.leadsMetaGasto).toBe(7000);
    expect(d.funil.leadsMetaCpl).toBe(10);
  });

  it('mes corrente = junho (lead forms incluidos) + conversao lead -> agendada com 1 casa', () => {
    const d = computeDashboard([], { periodo: 'mes', metaAds, videochamadas: vcJunho }, 15, NOW);
    expect(d.funil.leadsMeta).toBe(435); // 400 conversas + 35 forms
    expect(d.funil.pctLeadAgendada).toBe(0.5); // 2/435 = 0,46% -> 1 casa
  });

  it('tudo = soma dos 3 meses', () => {
    const d = computeDashboard([], { periodo: 'tudo', metaAds, videochamadas: [] }, 15, NOW);
    expect(d.funil.leadsMeta).toBe(1635);
    expect(d.funil.leadsMetaGasto).toBe(18960);
  });

  it('custom so abril = 500 (maio/junho fora do range)', () => {
    const d = computeDashboard([], { periodo: 'custom', dataInicio: '2026-04-01', dataFim: '2026-04-30', metaAds, videochamadas: [] }, 15, NOW);
    expect(d.funil.leadsMeta).toBe(500);
  });

  it('sem dados Meta -> etapa ausente (undefined), funil intacto', () => {
    const d = computeDashboard([], { periodo: 'tudo', videochamadas: [] }, 15, NOW);
    expect(d.funil.leadsMeta).toBeUndefined();
    expect(d.funil.criados).toBe(0);
  });
});
