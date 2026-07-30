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

describe('computeDashboard — campanhas de VAGA/RH fora da captação (fix 28/07/2026)', () => {
  // Fixture com os numeros REAIS de julho/2026 (meta_ads_mensal) que expuseram o bug:
  // "[VAGA] Advogado" sao CURRICULOS e entravam como lead de venda. A aba Trafego ja
  // excluia essas campanhas (decisao Paulo 16/07) — as duas telas se contradiziam.
  // `leads_form` aqui ja e o valor CORRIGIDO (= action_type `lead`, o total da Meta),
  // depois que o parece foi consertado e o historico recalculado — antes vinha em
  // dobro (38/36/128/... ) e julho aparecia com 546 leads no lugar de 371.
  const NOW_JUL = new Date('2026-07-28T12:00:00');
  const metaJulho = [
    { mes: '2026-07-01', campaign_name: '[30.09][SOU][ABO][LEADS][WPP] - Ondas Praia', conversas_iniciadas: 130, leads_form: 22, gasto: 2348.14 },
    { mes: '2026-07-01', campaign_name: '[02.10][SOU][ABO][LEADS][WPP] - Hot Beach', conversas_iniciadas: 97, leads_form: 21, gasto: 1700.50 },
    { mes: '2026-07-01', campaign_name: '[VAGA] Advogado', conversas_iniciadas: 0, leads_form: 64, gasto: 255.59 },
    { mes: '2026-07-01', campaign_name: '[22/07][SOU][ABO][LEADS][WPP] - Novas Listas', conversas_iniciadas: 61, leads_form: 15, gasto: 662.64 },
    { mes: '2026-07-01', campaign_name: '[02.10][SOU][ABO][LEADS][WPP] - Thermas São Pedro', conversas_iniciadas: 9, leads_form: 5, gasto: 1339.07 },
    { mes: '2026-07-01', campaign_name: '[02.06][SOU][ABO][LEADS][WPP] - Geral - Novas Listas', conversas_iniciadas: 4, leads_form: 3, gasto: 670.48 },
    { mes: '2026-07-01', campaign_name: '[18.03][SOU][ABO][LEADS][WPP] - Gran Paradiso', conversas_iniciadas: 4, leads_form: 0, gasto: 563.66 },
  ];

  it('tira [VAGA] dos leads, do investimento e do CPL', () => {
    const d = computeDashboard([], { periodo: 'mes', metaAds: metaJulho, videochamadas: [] }, 15, NOW_JUL);
    expect(d.funil.leadsMeta).toBe(371);                    // 435 - 64 curriculos
    expect(d.funil.leadsMetaGasto).toBeCloseTo(7284.49, 2); // 7.540,08 - 255,59
    expect(d.funil.leadsMetaCpl).toBe(19.63);               // tela mostrava 13,81
  });

  it('conversão lead -> agendada usa só os leads de venda', () => {
    const vc = Array.from({ length: 191 }, () => ({ status: 'realizada', scheduled_at: '2026-07-10T10:00:00Z' }));
    const d = computeDashboard([], { periodo: 'mes', metaAds: metaJulho, videochamadas: vc }, 15, NOW_JUL);
    expect(d.funil.agendadas).toBe(191);
    expect(d.funil.pctLeadAgendada).toBe(51.5);             // 191/371 (tela mostrava 20,5%)
  });

  it('linha sem campaign_name (dado legado) segue contando como venda', () => {
    const d = computeDashboard([], { periodo: 'mes', videochamadas: [], metaAds: [{ mes: '2026-07-01', conversas_iniciadas: 10, leads_form: 0, gasto: 100 }] }, 15, NOW_JUL);
    expect(d.funil.leadsMeta).toBe(10);
  });

  it('só campanhas de RH no período -> etapa some (não vira 0 leads com gasto)', () => {
    const d = computeDashboard([], { periodo: 'mes', videochamadas: [], metaAds: [metaJulho[2]] }, 15, NOW_JUL);
    expect(d.funil.leadsMeta).toBeUndefined();
  });

  // ── Funil INTEIRO de julho/2026 com a forma real dos dados (conferida no banco em
  // 28/07). Trava as 7 etapas de uma vez: e o cenario que estava errado na tela, onde
  // o corte de 1000 linhas do PostgREST mostrava 112/87 no lugar de 191/147 e o RH
  // inflava os leads. Se qualquer uma das duas regressoes voltar, este teste cai.
  it('julho/2026 ponta a ponta: as 7 etapas batem com o banco', () => {
    const rep = (n, row) => Array.from({ length: n }, () => ({ ...row }));
    const videochamadas = [
      ...rep(147, { status: 'realizada', scheduled_at: '2026-07-10T10:00:00Z' }), // ocorridas
      ...rep(44, { status: 'no_show', scheduled_at: '2026-07-11T10:00:00Z' }),
      ...rep(25, { status: 'excluida', scheduled_at: '2026-07-12T10:00:00Z' }),   // fora da base
      ...rep(19, { status: 'agendada', scheduled_at: '2026-07-30T10:00:00Z' }),   // ainda vao ocorrer
      ...rep(1, { status: 'realizada', scheduled_at: '2026-07-30T11:00:00Z' }),
      ...rep(2, { status: 'no_show', scheduled_at: '2026-07-31T10:00:00Z' }),
    ];
    const jul = (over) => contrato({ created_at: '2026-07-15T10:00:00Z', ...over });
    const contratos = [
      ...Array.from({ length: 28 }, () => jul({ status: 'assinado', signed_at: '2026-07-20T10:00:00Z', distribuido: true, guia_paga: true })),
      ...Array.from({ length: 8 }, () => jul({ status: 'assinado', signed_at: '2026-07-20T10:00:00Z', distribuido: true })),
      ...Array.from({ length: 22 }, () => jul({ status: 'assinado', signed_at: '2026-07-20T10:00:00Z' })),
      ...Array.from({ length: 24 }, () => jul({ status: 'enviado_zapsign' })),
      jul({ status: 'rascunho' }),
    ];
    const d = computeDashboard(contratos, { periodo: 'mes', metaAds: metaJulho, videochamadas }, 15, NOW_JUL);

    expect(d.funil.leadsMeta).toBe(371);        // tela mostrava 546 (currículos + dobra)
    expect(d.funil.leadsMetaCpl).toBe(19.63);   // tela mostrava 13,81
    expect(d.funil.agendadas).toBe(191);        // tela mostrava 112 (corte de 1000)
    expect(d.funil.realizadas).toBe(147);       // tela mostrava 87
    expect(d.funil.futuras).toBe(22);           // tela mostrava 20
    expect(d.funil.pctComparecimento).toBe(77);
    expect(d.funil.pctLeadAgendada).toBe(51.5); // tela mostrava 20,5%
    expect(d.funil.enviados).toBe(82);          // já estavam certos
    expect(d.funil.assinados).toBe(58);
    expect(d.funil.distribuidos).toBe(36);
    expect(d.funil.guiaPaga).toBe(28);
  });
});
