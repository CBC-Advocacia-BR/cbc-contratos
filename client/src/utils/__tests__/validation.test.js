import { describe, it, expect } from 'vitest';
import { validateEmail, validateCPF, validateCNPJ, validateCEP, validateUF, validateContratante } from '../validation';

describe('validateEmail', () => {
  it('aceita emails validos', () => {
    expect(validateEmail('paulo@advocaciacbc.com')).toBe(true);
    expect(validateEmail('a@b.c')).toBe(true);
  });

  it('rejeita emails invalidos', () => {
    expect(validateEmail('semarroba.com')).toBe(false);
    expect(validateEmail('com@espaco @mail.com')).toBe(false);
    expect(validateEmail('semponto@mail')).toBe(false);
    expect(validateEmail('')).toBe(false);
  });
});

describe('validateCPF', () => {
  it('aceita CPF formatado e valido (checksum)', () => {
    expect(validateCPF('529.982.247-25')).toBe(true);
  });

  it('rejeita CPF com checksum invalido', () => {
    expect(validateCPF('123.456.789-00')).toBe(false); // formato ok, digitos errados
    expect(validateCPF('111.111.111-11')).toBe(false); // todos iguais
  });

  it('rejeita CPF sem mascara', () => {
    expect(validateCPF('52998224725')).toBe(false);
  });

  it('rejeita CPF com formato errado', () => {
    expect(validateCPF('529.982.247')).toBe(false);
    expect(validateCPF('5299.82.247-25')).toBe(false);
  });
});

describe('validateCNPJ', () => {
  it('aceita CNPJ formatado e valido (checksum)', () => {
    expect(validateCNPJ('11.222.333/0001-81')).toBe(true);
    expect(validateCNPJ('35.166.337/0001-58')).toBe(true);
  });

  it('rejeita CNPJ com checksum invalido', () => {
    expect(validateCNPJ('11.222.333/0001-80')).toBe(false); // formato ok, digito errado
    expect(validateCNPJ('11.111.111/1111-11')).toBe(false); // todos iguais
  });

  it('rejeita CNPJ sem mascara', () => {
    expect(validateCNPJ('11222333000181')).toBe(false);
  });

  it('rejeita CNPJ com formato errado', () => {
    expect(validateCNPJ('11.222.333/0001')).toBe(false);
    expect(validateCNPJ('1.222.333/0001-81')).toBe(false);
  });
});

describe('validateCEP', () => {
  it('aceita CEP formatado', () => {
    expect(validateCEP('01310-100')).toBe(true);
  });

  it('rejeita CEP sem hifen', () => {
    expect(validateCEP('01310100')).toBe(false);
  });
});

describe('validateUF', () => {
  it('aceita UFs validas', () => {
    expect(validateUF('SP')).toBe(true);
    expect(validateUF('rj')).toBe(true); // case insensitive
    expect(validateUF('DF')).toBe(true);
  });

  it('rejeita UFs invalidas', () => {
    expect(validateUF('XX')).toBe(false);
    expect(validateUF('SAO')).toBe(false);
    expect(validateUF('S')).toBe(false);
  });

  it('aceita todas as 27 UFs', () => {
    const todas = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
    for (const uf of todas) {
      expect(validateUF(uf)).toBe(true);
    }
  });
});

describe('validateContratante', () => {
  const valido = {
    nome: 'Paulo Silva',
    nacionalidade: 'brasileiro',
    profissao: 'advogado',
    estadoCivil: 'casado',
    rg: '12.345.678-9',
    cpf: '529.982.247-25',
    email: 'paulo@example.com',
    endereco: 'Rua A',
    bairro: 'Centro',
    cidade: 'Sao Paulo',
    uf: 'SP',
    cep: '01310-100',
  };

  it('contratante completo nao retorna erros', () => {
    expect(validateContratante(valido)).toEqual({});
  });

  it('detecta nome ausente', () => {
    const r = validateContratante({ ...valido, nome: '' });
    expect(r.nome).toBe('Obrigatório');
  });

  it('detecta CPF mal formatado', () => {
    const r = validateContratante({ ...valido, cpf: '123' });
    expect(r.cpf).toContain('inválido');
  });

  it('detecta UF invalida', () => {
    const r = validateContratante({ ...valido, uf: 'XX' });
    expect(r.uf).toBe('UF inválida');
  });

  it('detecta CEP mal formatado', () => {
    const r = validateContratante({ ...valido, cep: '12345' });
    expect(r.cep).toContain('inválido');
  });

  it('detecta email invalido', () => {
    const r = validateContratante({ ...valido, email: 'naoeumemail' });
    expect(r.email).toBe('E-mail inválido');
  });

  it('detecta multiplos erros simultaneos', () => {
    const r = validateContratante({});
    expect(Object.keys(r).length).toBeGreaterThan(5);
  });

  it('PF nao exige campos de empresa', () => {
    const r = validateContratante(valido);
    expect(r.razaoSocial).toBeUndefined();
    expect(r.cnpj).toBeUndefined();
  });
});

describe('validateContratante (PJ / Cliente Empresa)', () => {
  const valido = {
    tipo: 'pj',
    razaoSocial: 'MH Comercial Agricola LTDA',
    cnpj: '35.166.337/0001-58',
    emailEmpresa: 'contato@mh.com',
    enderecoEmpresa: 'Av. Marechal Rondon',
    numeroEmpresa: '197',
    bairroEmpresa: 'Divineia',
    cidadeEmpresa: 'Unai',
    ufEmpresa: 'MG',
    cepEmpresa: '38613-473',
    // representante legal (reaproveita campos de pessoa)
    nome: 'Gessimere Vaz Oliveira',
    nacionalidade: 'brasileira',
    profissao: 'empresaria',
    estadoCivil: 'divorciada',
    rg: '5663975',
    cpf: '791.072.066-15',
    email: 'gessimere@mh.com',
    endereco: 'Av. Castelo Branco',
    bairro: 'Centro',
    cidade: 'Formoso',
    uf: 'MG',
    cep: '38690-000',
  };

  it('PJ completo nao retorna erros', () => {
    expect(validateContratante(valido)).toEqual({});
  });

  it('detecta razao social ausente', () => {
    expect(validateContratante({ ...valido, razaoSocial: '' }).razaoSocial).toBe('Obrigatório');
  });

  it('detecta CNPJ invalido', () => {
    expect(validateContratante({ ...valido, cnpj: '11.111.111/1111-11' }).cnpj).toContain('inválido');
  });

  it('exige dados do representante (CPF) tambem na PJ', () => {
    expect(validateContratante({ ...valido, cpf: '123' }).cpf).toContain('inválido');
  });

  it('detecta UF da empresa invalida', () => {
    expect(validateContratante({ ...valido, ufEmpresa: 'XX' }).ufEmpresa).toBe('UF inválida');
  });
});
