import { describe, it, expect } from 'vitest';
import { buildLinhaCaso, buildEventos, prescricaoDe, aniversarioInfo, telefoneDiverge, idadeDe, dataBRLC, valorEmDiscussao, acoesProprias, acoesFases, mesBR } from '../linhaCaso';

const HOJE = '2026-07-21';

describe('prescricaoDe', () => {
  it('interrompe no ajuizamento (caso Ana: compra 2019, ajuizada 2026)', () => {
    const p = prescricaoDe('2019-10-08', '2026-01-06', HOJE);
    expect(p.interrompida).toBe(true);
    expect(p.pct).toBe(62);
    expect(p.alerta).toBe(false);
  });
  it('sem ajuizamento corre ate hoje e alerta em >=80%', () => {
    const p = prescricaoDe('2017-01-01', null, HOJE);
    expect(p.interrompida).toBe(false);
    expect(p.pct).toBeGreaterThanOrEqual(80);
    expect(p.alerta).toBe(true);
  });
  it('sem data de compra retorna null (branco honesto)', () => {
    expect(prescricaoDe(null, '2026-01-06', HOJE)).toBeNull();
  });
});

describe('aniversarioInfo / idade', () => {
  it('Ana faz 52 em 19/11 (121 dias a partir de 21/07)', () => {
    const a = aniversarioInfo('1974-11-19', HOJE);
    expect(a.dias).toBe(121);
    expect(a.fara).toBe(52);
  });
  it('idade correta antes do aniversario', () => {
    expect(idadeDe('1974-11-19', HOJE)).toBe(51);
  });
});

describe('telefoneDiverge', () => {
  it('compara os 8 finais ignorando formato', () => {
    expect(telefoneDiverge('(31) 98907-2567', '5531989072567')).toBe(false);
    expect(telefoneDiverge('(31) 98907-2567', '(31) 8845-2870')).toBe(true);
  });
  it('sem dado suficiente nao acusa', () => {
    expect(telefoneDiverge('', '31989072567')).toBe(false);
  });
});

describe('buildEventos', () => {
  const base = {
    info: {},
    acoes: [{ resort: 'Ondas Praia', unidade_cota: 'Apto 14', data_contrato_compra: '2019-10-08', valor_pago: 46091.46, data_contrato: '2025-06-17' }],
    lc: {
      processos: [{ numero: '1000794-84.2026.8.13.0024', distribuido: '2026-01-06', criado_advbox: '2026-01-16', entrou_execucao: '2026-02-12', responsavel: 'LORENZA' }],
      mudancas: [{ quando: '2026-07-08', campo: 'etapa', de: 'INTIMACAO', para: 'SISBAJUD' }],
      andamentos: [{ data: '2026-07-20', texto: 'Peticao — evento 37', tribunal: 'TJMG' }],
      tarefas: [{ nome: 'PROTOCOLAR SISBAJUD', concluida: '2026-07-20', quem: 'Arthur Suzuki' }],
      mles: [],
    },
    hoje: HOJE,
  };
  it('ordena cronologicamente e inclui todas as trilhas', () => {
    const ev = buildEventos(base);
    const datas = ev.map((e) => e.data);
    expect([...datas].sort()).toEqual(datas);
    expect(ev[0].titulo).toContain('Compra da cota');
    expect(ev.some((e) => e.tipo === 'tribunal')).toBe(true);
    expect(ev.some((e) => e.tipo === 'equipe' && /Arthur/.test(e.sub || ''))).toBe(true);
  });
  it('prescricao da cota usa a data de ajuizamento', () => {
    const ev = buildEventos(base);
    const compra = ev.find((e) => e.titulo.includes('Compra'));
    expect(compra.prescricao.interrompida).toBe(true);
    expect(compra.prescricao.pct).toBe(62);
  });
  it('contrato pre-sistema quando nao ha contrato_app', () => {
    const ev = buildEventos(base);
    expect(ev.some((e) => /pre-sistema/.test(e.sub || ''))).toBe(true);
  });
  it('nao inventa evento sem data e ignora datas futuras', () => {
    const ev = buildEventos({ ...base, lc: { ...base.lc, andamentos: [{ data: '2027-01-01', texto: 'futuro' }, { data: null, texto: 'sem data' }] } });
    expect(ev.some((e) => e.titulo === 'futuro' || e.titulo === 'sem data')).toBe(false);
  });
});

describe('buildLinhaCaso', () => {
  it('no HOJE traz etapa/permanencia e repasse pendente quando MLE recebido sem repasse', () => {
    const r = buildLinhaCaso({
      row: { nascimento: '1989-04-30' },
      info: { tem_portal: true, proximo_venc: '2026-09-20' },
      acoes: [{ resort: 'Royal Prime', data_contrato_compra: '2024-01-25', valor_pago: 16481, honorarios_perc: 0 }],
      lc: {
        processos: [{ numero: '4000620-34.2025.8.26.0400', distribuido: '2025-10-10', quadro: 'ARQUIVAMENTO', etapa: 'EM CUMPRIMENTO' }],
        etapa_atual: { etapa: 'EM CUMPRIMENTO', quadro: 'ARQUIVAMENTO', dias: 141 },
        mles: [{ protocolo: '2026-06-29', recebido_em: '2026-07-01', valor_recebido: 24085.13, valor_cliente: 19927.25, valor_escritorio: 4157.88, repassado_em: null }],
        portal: { ativo: true, acessos: 0 },
        tarefas_abertas: 0,
      },
      hoje: HOJE,
    });
    expect(r.hojeNode.etapa).toBe('EM CUMPRIMENTO');
    expect(r.hojeNode.repassePendente).toBeTruthy();
    expect(r.hojeNode.repassePendente.diasAguardando).toBe(20);
    expect(r.chips.some((c) => /Portal/.test(c.txt))).toBe(true);
    expect(r.futuros.some((f) => f.urgente)).toBe(true);
  });
  it('estado vazio honesto: sem acoes/processos nao quebra', () => {
    const r = buildLinhaCaso({ row: {}, info: {}, acoes: [], lc: {}, hoje: HOJE });
    expect(r.eventos).toEqual([]);
    expect(r.hojeNode.etapa).toBeNull();
    expect(r.investimento.total).toBeNull();
  });
  it('alerta de prescricao so para contratado sem ajuizamento', () => {
    const r = buildLinhaCaso({
      row: {}, info: {},
      acoes: [{ resort: 'Hot Beach', data_contrato_compra: '2017-05-01', valor_pago: 30000 }],
      lc: { processos: [] }, hoje: HOJE,
    });
    expect(r.chips.some((c) => c.tipo === 'danger' && /Prescricao/.test(c.txt))).toBe(true);
  });
});

describe('dataBRLC', () => {
  it('formata ISO como pt-BR e devolve null p/ vazio', () => {
    expect(dataBRLC('2026-07-21')).toBe('21/07/2026');
    expect(dataBRLC(null)).toBeNull();
  });
});

// Fases processuais (regra Paulo 29/07/2026)
describe('fase processual e valor atualizado', () => {
  it('SISBAJUD vence a fase e o contratado, e traz o mes do pedido', () => {
    const d = valorEmDiscussao({ valor_pago: 30000, valor_atualizado: 41000,
      valor_atualizado_fonte: 'cumprimento', sisbajud_valor: 52000, sisbajud_mes: '2026-03-01' });
    expect(d).toEqual({ valor: 52000, fonte: 'sisbajud', mes: '2026-03-01' });
    expect(mesBR('2026-03-01')).toBe('03/2026');
  });
  it('sem SISBAJUD, o valor calculado na fase vence o contratado', () => {
    const d = valorEmDiscussao({ valor_pago: 30052.31, valor_atualizado: 23600.04,
      valor_atualizado_fonte: 'liquidacao', valor_atualizado_data: '2024-08-01' });
    expect(d.valor).toBe(23600.04);
    expect(d.fonte).toBe('liquidacao');
  });
  it('sem fase, cai no valor contratado', () => {
    expect(valorEmDiscussao({ valor_pago: 30000 })).toEqual({ valor: 30000, fonte: 'contratado', mes: null });
    expect(valorEmDiscussao({})).toBeNull();
  });
  it('liquidacao/cumprimento nao duplicam o valor investido', () => {
    const acoes = [
      { id: 'a', resort: 'Porto 2 Life', valor_pago: 30052.31, valor_atualizado: 23600.04,
        valor_atualizado_fonte: 'liquidacao', fase_atual: 'liquidacao' },
      { id: 'b', resort: 'SPE LTDA', valor_pago: 26428.85, eh_fase_de: 'a', fase_atual: 'liquidacao' },
    ];
    expect(acoesProprias(acoes)).toHaveLength(1);
    expect(acoesFases(acoes)).toHaveLength(1);
    const r = buildLinhaCaso({ row: {}, info: {}, acoes, lc: { processos: [] }, hoje: HOJE });
    expect(r.investimento.total).toBe(30052.31);          // nao soma os 26.428,85 da fase
    expect(r.investimento.emDiscussao).toBe(23600.04);    // valor recalculado na liquidacao
    expect(r.investimento.atualizadoPorFase).toBe(true);
    expect(r.investimento.fases).toHaveLength(1);
  });
  it('chip de SISBAJUD com valor e mes do pedido', () => {
    const r = buildLinhaCaso({ row: {}, info: {},
      acoes: [{ id: 'a', resort: 'Ondas', valor_pago: 40000, sisbajud_valor: 61000, sisbajud_mes: '2026-05-01', fase_atual: 'sisbajud' }],
      lc: { processos: [] }, hoje: HOJE });
    expect(r.chips.some((c) => c.tipo === 'gold' && /SISBAJUD/.test(c.txt) && /05\/2026/.test(c.txt))).toBe(true);
  });
  it('pedido SISBAJUD entra na linha do tempo', () => {
    const ev = buildEventos({
      acoes: [{ id: 'a', resort: 'Ondas', valor_pago: 40000, sisbajud_valor: 61000, sisbajud_mes: '2026-05-01' }],
      lc: { processos: [] }, hoje: HOJE });
    expect(ev.some((e) => e.tipo === 'financeiro' && /SISBAJUD/.test(e.titulo) && e.data === '2026-05-01')).toBe(true);
  });
  it('telefone suspeito virou chip de alerta', () => {
    const r = buildLinhaCaso({ row: {}, info: {}, acoes: [],
      lc: { processos: [], telefones: [{ fone: '16981489703', principal: true }, { fone: '5540770276', suspeito: true }] },
      hoje: HOJE });
    expect(r.telefones).toHaveLength(2);
    expect(r.chips.some((c) => /telefone\(s\) com n/.test(c.txt))).toBe(true);
  });
});
