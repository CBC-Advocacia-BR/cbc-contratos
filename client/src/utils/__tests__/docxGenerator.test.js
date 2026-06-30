import { describe, it, expect } from 'vitest';
import { generateContractDocxBlob, generateProcuracaoDocxBlob } from '../docxGenerator';

// Smoke tests dos blobs DOCX (sem DOM) — garantem que os caminhos PF e PJ geram o
// documento sem lancar (campos de empresa/representante existentes e bem referenciados).

const honorarios = {
  somenteIniciais: false, somenteExito: false,
  total: 3300, parcelas: 12, valorParcela: 275, percentualExito: 20,
  dataPrimeiraParcela: '2026-07-20',
};

const contratantePF = {
  tipo: 'pf', nome: 'Maria Silva', nacionalidade: 'brasileira', profissao: 'engenheira',
  estadoCivil: 'casada', rg: '12.345.678-9', cpf: '123.456.789-00', email: 'maria@example.com',
  endereco: 'Rua das Flores', numero: '100', bairro: 'Centro', cidade: 'Sao Paulo', uf: 'SP', cep: '01310-100',
};

const contratantePJ = {
  tipo: 'pj', razaoSocial: 'MH Comercial Agricola LTDA', cnpj: '35.166.337/0001-58', emailEmpresa: 'contato@mh.com',
  enderecoEmpresa: 'Avenida Marechal Rondon', numeroEmpresa: '197', bairroEmpresa: 'Divineia', cidadeEmpresa: 'Unai', ufEmpresa: 'MG', cepEmpresa: '38613-473',
  nome: 'Gessimere Vaz Oliveira', nacionalidade: 'brasileira', profissao: 'empresaria', estadoCivil: 'divorciada',
  rg: '5663975', cpf: '791.072.066-15', email: 'gessimere@mh.com',
  endereco: 'Avenida Castelo Branco', numero: '510', bairro: 'Centro', cidade: 'Formoso', uf: 'MG', cep: '38690-000',
};

const base = (contratantes) => ({
  numContratantes: contratantes.length, contratantes,
  resort: 'Porto 2 Life Resort', tipoAcao: 'Ação de rescisão contratual',
  honorarios, clausulas: {},
});

describe('docxGenerator — PJ (Cliente Empresa)', () => {
  it('gera o contrato DOCX (blob) para empresa sem lancar', async () => {
    const blob = await generateContractDocxBlob(base([contratantePJ]));
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('gera a procuracao DOCX (blob) para empresa sem lancar', async () => {
    const blob = await generateProcuracaoDocxBlob(base([contratantePJ]));
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('gera contrato misto PF + PJ sem lancar', async () => {
    const blob = await generateContractDocxBlob(base([contratantePF, contratantePJ]));
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('PF continua gerando normalmente', async () => {
    const blob = await generateContractDocxBlob(base([contratantePF]));
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });
});
