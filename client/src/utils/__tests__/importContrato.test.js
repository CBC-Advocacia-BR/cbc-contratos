// (auditoria 01/08/2026 — item 298) Importacao manual de contrato assinado.
//
// POR QUE IMPORTA: este e o unico caminho em que um contrato entra no sistema SEM ter
// passado pelo formulario, pela validacao e pelo ZapSign. `buildContractRow` decide o que
// vai para cada coluna, e depois dele nao ha nenhuma conferencia: se um campo for para o
// lugar errado, o contrato fica no sistema com cara de certo (honorario zerado, CPF do
// contratante 2 sobrando de uma importacao anterior, resort gravado como a palavra
// "outro") e so aparece quando alguem confere a mao — ou quando a cobranca sai errada.
import { describe, it, expect } from 'vitest';
import { buildContractRow, checkAutomacaoRequisitos } from '../importContrato';

const base = (over = {}) => ({
  numContratantes: 1,
  contratantes: [{ nome: 'MARIA SILVA', cpf: '123.456.789-09', email: 'maria@ex.com' }],
  resort: 'ONDAS PRAIA',
  tipoAcao: 'Distrato',
  honorarios: { total: 3000, parcelas: 3, valorParcela: 1000, percentualExito: 20, dataPrimeiraParcela: '2026-09-10' },
  dataAssinatura: '2026-07-15',
  ...over,
});

describe('buildContractRow — colunas do contrato importado', () => {
  it('leva os dados do contratante 1 para as colunas certas', () => {
    const r = buildContractRow(base(), 'paulo@advocaciacbc.com');
    expect(r.nome_contratante1).toBe('MARIA SILVA');
    expect(r.cpf_contratante1).toBe('123.456.789-09');
    expect(r.email_contratante1).toBe('maria@ex.com');
    expect(r.resort).toBe('ONDAS PRAIA');
    expect(r.tipo_acao).toBe('Distrato');
  });

  it('contrato importado ja nasce ASSINADO e marcado como importacao manual', () => {
    const r = buildContractRow(base(), 'paulo@advocaciacbc.com');
    expect(r.status).toBe('assinado');
    expect(r.imported_manually).toBe(true);
    expect(r.imported_by).toBe('paulo@advocaciacbc.com');
    expect(r.dados.importedManually).toBe(true);
  });

  it('com 1 contratante, as colunas do 2 ficam NULAS (nao sobra dado de ninguem)', () => {
    const r = buildContractRow(base({
      numContratantes: 1,
      // o formulario pode ter guardado um 2o contratante antes de o usuario voltar para 1
      contratantes: [{ nome: 'MARIA', cpf: '1' }, { nome: 'NAO DEVE APARECER', cpf: '2' }],
    }), 'x@y.com');
    expect(r.nome_contratante2).toBe(null);
    expect(r.cpf_contratante2).toBe(null);
    expect(r.email_contratante2).toBe(null);
  });

  it('com 2 contratantes, o segundo vai para as colunas dele', () => {
    const r = buildContractRow(base({
      numContratantes: 2,
      contratantes: [{ nome: 'A', cpf: '1', email: 'a@x' }, { nome: 'B', cpf: '2', email: 'b@x' }],
    }), 'x@y.com');
    expect(r.nome_contratante2).toBe('B');
    expect(r.cpf_contratante2).toBe('2');
    expect(r.email_contratante2).toBe('b@x');
  });

  it('resort/tipo "outro" gravam o texto DIGITADO, nunca a palavra "outro"', () => {
    const r = buildContractRow(base({
      resort: 'outro', resortCustom: 'RESORT NOVO XYZ',
      tipoAcao: 'outro', tipoAcaoCustom: 'Ação especial',
    }), 'x@y.com');
    expect(r.resort).toBe('RESORT NOVO XYZ');
    expect(r.tipo_acao).toBe('Ação especial');
  });

  it('a data de assinatura informada e respeitada e fixada ao MEIO-DIA', () => {
    // meio-dia evita que a conversao de fuso jogue a assinatura para o dia anterior
    const r = buildContractRow(base({ dataAssinatura: '2026-07-15' }), 'x@y.com');
    expect(r.signed_at.slice(0, 10)).toBe('2026-07-15');
  });

  it('sem data informada, usa agora (contrato nunca fica sem data de assinatura)', () => {
    const r = buildContractRow(base({ dataAssinatura: null }), 'x@y.com');
    expect(r.signed_at).toBeTruthy();
    expect(Number.isFinite(Date.parse(r.signed_at))).toBe(true);
  });
});

describe('buildContractRow — honorarios (o que vira cobranca)', () => {
  it('modo completo leva todos os valores', () => {
    const r = buildContractRow(base(), 'x@y.com');
    expect(r.honorarios_total).toBe(3000);
    expect(r.honorarios_parcelas).toBe(3);
    expect(r.honorarios_valor_parcela).toBe(1000);
    expect(r.honorarios_percentual_exito).toBe(20);
    expect(r.data_primeira_parcela).toBe('2026-09-10');
  });

  it('SOMENTE EXITO zera os iniciais — senao viraria boleto que o cliente nao deve', () => {
    const r = buildContractRow(base({
      honorarios: { somenteExito: true, total: 3000, parcelas: 3, valorParcela: 1000, percentualExito: 30 },
    }), 'x@y.com');
    expect(r.honorarios_total).toBe(0);
    expect(r.honorarios_parcelas).toBe(0);
    expect(r.honorarios_valor_parcela).toBe(0);
    expect(r.honorarios_percentual_exito).toBe(30);
  });

  it('SOMENTE INICIAIS zera o percentual de exito', () => {
    const r = buildContractRow(base({
      honorarios: { somenteIniciais: true, total: 3000, parcelas: 3, valorParcela: 1000, percentualExito: 30 },
    }), 'x@y.com');
    expect(r.honorarios_total).toBe(3000);
    expect(r.honorarios_percentual_exito).toBe(0);
  });

  it('valor em TEXTO vira numero (o formulario devolve string)', () => {
    const r = buildContractRow(base({
      honorarios: { total: '2500', parcelas: '5', valorParcela: '500', percentualExito: '15' },
    }), 'x@y.com');
    expect(r.honorarios_total).toBe(2500);
    expect(r.honorarios_parcelas).toBe(5);
  });

  it('valor invalido/ausente vira 0 — NUNCA NaN indo para o banco', () => {
    const r = buildContractRow(base({ honorarios: { total: 'abc', parcelas: undefined } }), 'x@y.com');
    expect(r.honorarios_total).toBe(0);
    expect(r.honorarios_parcelas).toBe(0);
    expect(Number.isNaN(r.honorarios_total)).toBe(false);
  });

  it('sem bloco de honorarios nao quebra', () => {
    const r = buildContractRow(base({ honorarios: undefined }), 'x@y.com');
    expect(r.honorarios_total).toBe(0);
    expect(r.data_primeira_parcela).toBe(null);
  });
});

describe('checkAutomacaoRequisitos — o que da para automatizar nesta importacao', () => {
  const anexos = (over = {}) => ({ contratoPdf: null, procuracaoPdf: null, ...over });

  it('ADVBOX exige nome E CPF do contratante 1', () => {
    expect(checkAutomacaoRequisitos(base(), anexos()).advbox).toBe(true);
    expect(checkAutomacaoRequisitos(base({ contratantes: [{ nome: 'X' }] }), anexos()).advbox).toBe(false);
    expect(checkAutomacaoRequisitos(base({ contratantes: [{ cpf: '1' }] }), anexos()).advbox).toBe(false);
    expect(checkAutomacaoRequisitos(base({ contratantes: [] }), anexos()).advbox).toBe(false);
  });

  it('Drive exige pasta E pelo menos um PDF (link sozinho nao basta)', () => {
    const comLink = base({ linkGoogleDrive: 'https://drive.google.com/drive/folders/abc' });
    expect(checkAutomacaoRequisitos(comLink, anexos()).drive).toBe(false);
    expect(checkAutomacaoRequisitos(comLink, anexos({ contratoPdf: { base64: 'x' } })).drive).toBe(true);
    expect(checkAutomacaoRequisitos(comLink, anexos({ procuracaoPdf: { base64: 'x' } })).drive).toBe(true);
    expect(checkAutomacaoRequisitos(base(), anexos({ contratoPdf: { base64: 'x' } })).drive).toBe(false);
  });

  it('Asaas exige valor, parcelas E data da 1a — os 3, senao a cobranca sai torta', () => {
    expect(checkAutomacaoRequisitos(base(), anexos()).asaas).toBe(true);
    expect(checkAutomacaoRequisitos(base({ honorarios: { total: 0, parcelas: 3, dataPrimeiraParcela: '2026-09-10' } }), anexos()).asaas).toBe(false);
    expect(checkAutomacaoRequisitos(base({ honorarios: { total: 3000, parcelas: 0, dataPrimeiraParcela: '2026-09-10' } }), anexos()).asaas).toBe(false);
    expect(checkAutomacaoRequisitos(base({ honorarios: { total: 3000, parcelas: 3 } }), anexos()).asaas).toBe(false);
  });

  it('contrato so de exito NAO habilita cobranca (nao ha o que cobrar agora)', () => {
    const soExito = base({ honorarios: { somenteExito: true, percentualExito: 30, total: 0, parcelas: 0 } });
    expect(checkAutomacaoRequisitos(soExito, anexos()).asaas).toBe(false);
  });

  it('dados vazios nao quebram (o modal chama isso a cada tecla)', () => {
    expect(() => checkAutomacaoRequisitos({}, null)).not.toThrow();
    expect(checkAutomacaoRequisitos({}, null)).toEqual({ advbox: false, drive: false, asaas: false });
  });
});
