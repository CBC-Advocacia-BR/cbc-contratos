import { describe, it, expect } from 'vitest';
import { generateContractHTML, generateProcuracaoHTML, generateFullDocumentHTML } from '../contractHtml';

// Snapshot tests — qualquer mudanca no template do contrato derruba estes testes,
// forcando revisao explicita antes de afetar contratos em producao. Para regenerar
// o snapshot apos mudanca intencional: `npm test -- -u`.

const fixtureContratante1 = {
  nome: 'Maria Silva',
  nacionalidade: 'brasileira',
  profissao: 'engenheira',
  estadoCivil: 'casada',
  rg: '12.345.678-9',
  cpf: '123.456.789-00',
  email: 'maria@example.com',
  endereco: 'Rua das Flores',
  numero: '100',
  complemento: 'Apto 5',
  bairro: 'Centro',
  cidade: 'São Paulo',
  uf: 'SP',
  cep: '01310-100',
  dataNascimento: '1980-05-15',
  telefone: '(11) 98765-4321',
};

const fixtureContratante2 = {
  ...fixtureContratante1,
  nome: 'João Santos',
  cpf: '987.654.321-00',
  rg: '98.765.432-1',
  email: 'joao@example.com',
  profissao: 'medico',
  estadoCivil: 'casado',
  nacionalidade: 'brasileiro',
};

const fixtureBase = {
  numContratantes: 1,
  contratantes: [fixtureContratante1],
  resort: 'Resort Paradiso',
  tipoAcao: 'Ação de cobrança',
  honorarios: {
    somenteIniciais: false,
    somenteExito: false,
    total: 10000,
    parcelas: 1,
    valorParcela: 10000,
    percentualExito: 20,
    dataPrimeiraParcela: '2026-06-01',
  },
  clausulas: {},
  data: '2026-05-01',
};

describe('generateContractHTML — snapshots', () => {
  it('1 contratante, iniciais + exito', () => {
    const html = generateContractHTML(fixtureBase);
    expect(html).toMatchSnapshot();
  });

  it('2 contratantes, iniciais + exito', () => {
    const data = {
      ...fixtureBase,
      numContratantes: 2,
      contratantes: [fixtureContratante1, fixtureContratante2],
    };
    const html = generateContractHTML(data);
    expect(html).toMatchSnapshot();
  });

  it('1 contratante, somente exito (sem honorarios fixos)', () => {
    const data = {
      ...fixtureBase,
      honorarios: {
        ...fixtureBase.honorarios,
        somenteExito: true,
        total: 0,
        percentualExito: 30,
      },
    };
    const html = generateContractHTML(data);
    expect(html).toMatchSnapshot();
  });

  it('1 contratante, somente iniciais (sem exito)', () => {
    const data = {
      ...fixtureBase,
      honorarios: {
        ...fixtureBase.honorarios,
        somenteIniciais: true,
        total: 5000,
        parcelas: 2,
        valorParcela: 2500,
        percentualExito: 0,
      },
    };
    const html = generateContractHTML(data);
    expect(html).toMatchSnapshot();
  });
});

describe('generateProcuracaoHTML — snapshots', () => {
  it('1 contratante, acao de cobranca', () => {
    const html = generateProcuracaoHTML(fixtureBase);
    expect(html).toMatchSnapshot();
  });

  it('2 contratantes, rescisao', () => {
    const data = {
      ...fixtureBase,
      numContratantes: 2,
      contratantes: [fixtureContratante1, fixtureContratante2],
      tipoAcao: 'Ação de rescisão contratual',
    };
    const html = generateProcuracaoHTML(data);
    expect(html).toMatchSnapshot();
  });
});

describe('generateFullDocumentHTML', () => {
  it('inclui contrato e procuracao', () => {
    const html = generateFullDocumentHTML(fixtureBase);
    expect(html).toContain('Maria Silva'.toUpperCase());
    expect(html.length).toBeGreaterThan(500);
  });
});

// (PJ 25/06) Cliente Empresa — espelha o contrato-exemplo da CBC
const fixtureContratantePJ = {
  tipo: 'pj',
  razaoSocial: 'MH Comercial Agricola LTDA',
  cnpj: '35.166.337/0001-58',
  emailEmpresa: 'contato@mh.com',
  enderecoEmpresa: 'Avenida Marechal Rondon',
  numeroEmpresa: '197',
  bairroEmpresa: 'Divineia',
  cidadeEmpresa: 'Unai',
  ufEmpresa: 'MG',
  cepEmpresa: '38613-473',
  complementoEmpresa: '',
  // representante legal (reaproveita os campos de pessoa)
  nome: 'Gessimere Vaz Oliveira',
  nacionalidade: 'brasileira',
  profissao: 'empresaria',
  estadoCivil: 'divorciada',
  rg: '5663975',
  cpf: '791.072.066-15',
  email: 'gessimere@mh.com',
  endereco: 'Avenida Castelo Branco',
  numero: '510',
  bairro: 'Centro',
  cidade: 'Formoso',
  uf: 'MG',
  cep: '38690-000',
  telefone: '(34) 99999-0000',
  linkKommo: 'https://advocaciacbc.kommo.com/leads/detail/123',
};

describe('Cliente Empresa (PJ) — contrato e procuracao', () => {
  const dataPJ = { ...fixtureBase, contratantes: [fixtureContratantePJ] };

  it('contrato qualifica a empresa + representante no padrao do exemplo', () => {
    const html = generateContractHTML(dataPJ);
    expect(html).toContain('MH COMERCIAL AGRICOLA LTDA');
    expect(html).toContain('pessoa jurídica de direito privado');
    expect(html).toContain('inscrita no CNPJ sob o nº 35.166.337/0001-58');
    expect(html).toContain('com sede na Avenida Marechal Rondon');
    expect(html).toContain('neste ato representada por');
    expect(html).toContain('GESSIMERE VAZ OLIVEIRA');
    expect(html).toContain('CPF: 791.072.066-15');
    expect(html).toContain('residente e domiciliado na Avenida Castelo Branco');
  });

  it('assinatura do contrato usa a razao social, nao o representante', () => {
    const html = generateContractHTML(dataPJ);
    expect(html).toContain('<strong>MH COMERCIAL AGRICOLA LTDA</strong><br/>CLIENTE — CONTRATANTE');
  });

  it('procuracao qualifica empresa + representante como OUTORGANTE', () => {
    const html = generateProcuracaoHTML(dataPJ);
    expect(html).toContain('MH COMERCIAL AGRICOLA LTDA');
    expect(html).toContain('inscrita no CNPJ sob o nº 35.166.337/0001-58');
    expect(html).toContain('neste ato representada por');
    expect(html).toContain('GESSIMERE VAZ OLIVEIRA');
    expect(html).toMatch(/<strong>MH COMERCIAL AGRICOLA LTDA<\/strong><br\/>OUTORGANTE/);
  });

  it('contrato misto PF + PJ qualifica cada contratante conforme seu tipo', () => {
    const data = { ...fixtureBase, numContratantes: 2, contratantes: [fixtureContratante1, fixtureContratantePJ] };
    const html = generateContractHTML(data);
    expect(html).toContain('MARIA SILVA'); // PF
    expect(html).toContain('MH COMERCIAL AGRICOLA LTDA'); // PJ
    expect(html).toContain('pessoa jurídica de direito privado');
  });
});

// (enderecos distintos 14/07/2026) 2 contratantes que NAO moram juntos: cada um
// leva o proprio endereco na qualificacao (como na procuracao) e o contrato nao
// pode declarar domicilio compartilhado. Enderecos iguais mantem a linha atual.
const fixtureContratante2OutroEndereco = {
  ...fixtureContratante2,
  endereco: 'Avenida Brasil',
  numero: '200',
  complemento: '',
  bairro: 'Jardim Paulista',
  cidade: 'Campinas',
  uf: 'SP',
  cep: '13010-000',
};

describe('Enderecos distintos entre contratantes', () => {
  const dataDistintos = {
    ...fixtureBase,
    numContratantes: 2,
    contratantes: [fixtureContratante1, fixtureContratante2OutroEndereco],
  };

  it('contrato descreve o endereco proprio de cada contratante quando diferem', () => {
    const html = generateContractHTML(dataDistintos);
    expect(html).toContain('residente e domiciliado na Rua das Flores, nº 100, Apto 5, no bairro Centro, na cidade São Paulo/SP, CEP: 01310-100');
    expect(html).toContain('residente e domiciliado na Avenida Brasil, nº 200, no bairro Jardim Paulista, na cidade Campinas/SP, CEP: 13010-000');
  });

  it('contrato NAO declara domicilio compartilhado quando os enderecos diferem', () => {
    const html = generateContractHTML(dataDistintos);
    expect(html).not.toContain('Residentes e domiciliados em');
    expect(html).not.toContain('Residente e domiciliado em');
  });

  it('enderecos iguais mantem a linha compartilhada (sem endereco inline)', () => {
    const data = { ...fixtureBase, numContratantes: 2, contratantes: [fixtureContratante1, fixtureContratante2] };
    const html = generateContractHTML(data);
    expect(html).toContain('Residentes e domiciliados em');
    expect(html).not.toContain('residente e domiciliado na');
  });

  it('1 contratante mantem a linha singular atual', () => {
    const html = generateContractHTML(fixtureBase);
    expect(html).toContain('Residente e domiciliado em');
    expect(html).not.toContain('Residentes e domiciliados em');
  });

  it('PJ em 1o + PF em 2o: endereco residencial do PF aparece na qualificacao', () => {
    const data = { ...fixtureBase, numContratantes: 2, contratantes: [fixtureContratantePJ, fixtureContratante1] };
    const html = generateContractHTML(data);
    expect(html).toContain('residente e domiciliado na Rua das Flores');
    expect(html).not.toContain('Residentes e domiciliados em');
  });

  it('PF + PJ: linha compartilhada sai no singular (so ha 1 PF)', () => {
    const data = { ...fixtureBase, numContratantes: 2, contratantes: [fixtureContratante1, fixtureContratantePJ] };
    const html = generateContractHTML(data);
    expect(html).toContain('Residente e domiciliado em');
    expect(html).not.toContain('Residentes e domiciliados em');
  });

  it('procuracao segue com o endereco proprio de cada outorgante', () => {
    const html = generateProcuracaoHTML(dataDistintos);
    expect(html).toContain('residente e domiciliado na Rua das Flores');
    expect(html).toContain('residente e domiciliado na Avenida Brasil');
  });
});

describe('generateContractHTML — invariantes basicas', () => {
  it('inclui nome do contratante em maiusculas', () => {
    const html = generateContractHTML(fixtureBase);
    expect(html).toContain('MARIA SILVA');
  });

  it('inclui CPF formatado', () => {
    const html = generateContractHTML(fixtureBase);
    expect(html).toContain('123.456.789-00');
  });

  it('inclui resort', () => {
    const html = generateContractHTML(fixtureBase);
    expect(html).toContain('Resort Paradiso');
  });

  it('inclui valor honorarios em extenso quando ha total', () => {
    const html = generateContractHTML(fixtureBase);
    expect(html.toLowerCase()).toContain('reais');
  });

  it('contratante 2 aparece quando numContratantes=2', () => {
    const data = {
      ...fixtureBase,
      numContratantes: 2,
      contratantes: [fixtureContratante1, fixtureContratante2],
    };
    const html = generateContractHTML(data);
    expect(html).toContain('JOÃO SANTOS');
  });
});
