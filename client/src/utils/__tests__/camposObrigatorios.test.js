// (auditoria 01/08/2026 — item 205) A regra de "campos obrigatorios" tinha DUAS
// implementacoes: a lista que a tela usa (bolinhas de progresso, botoes desabilitados) e
// a sequencia de verificacoes do `validateChecklist`, que e o portao real do envio e o
// unico caminho do atalho de teclado. Duas implementacoes da mesma regra so ficam iguais
// por sorte.
//
// Estes testes sao a prova de que continuam iguais. Se alguem acrescentar um campo na
// lista e esquecer o portao — ou o contrario — a suite reprova antes de virar deploy.
// O sintoma que isso evita: a tela diz "pronto para enviar" e o envio recusa, ou pior, o
// envio passa sem um dado que o contrato precisa.
import { describe, it, expect } from 'vitest';
import { validateChecklist } from '../validarContrato';
import {
  camposObrigatorios, CONTRATANTE_FIELDS_PF, CONTRATANTE_FIELDS_PJ, CONTRATANTE_FIELDS_EMPRESA,
} from '../camposObrigatorios';

// De campo -> como o portao o chama na mensagem de erro. E o unico ponto de traducao
// entre as duas implementacoes; qualquer campo novo precisa entrar aqui tambem, o que
// e proposital: obriga quem mexe a olhar os dois lados.
const ROTULO = {
  nome: 'Nome', nacionalidade: 'Nacionalidade', profissao: 'Profissao',
  estadoCivil: 'Estado civil', rg: 'RG', cpf: 'CPF', email: 'E-mail',
  dataNascimento: 'Data de nascimento', telefone: 'Celular', linkKommo: 'Link Kommo',
  cep: 'CEP', uf: 'UF', endereco: 'Endereco', numero: 'Numero', bairro: 'Bairro',
  cidade: 'Cidade',
  razaoSocial: 'Razao social', cnpj: 'CNPJ', emailEmpresa: 'E-mail da empresa',
  cepEmpresa: 'CEP da empresa', ufEmpresa: 'UF da empresa',
  enderecoEmpresa: 'Endereco da empresa', numeroEmpresa: 'Numero da empresa',
  bairroEmpresa: 'Bairro da empresa', cidadeEmpresa: 'Cidade da empresa',
};

/** contrato com tudo preenchido MENOS o campo pedido */
const contratoCom = (over = {}) => ({
  numContratantes: 1,
  contratantes: [{
    nome: 'Fulano de Tal', nacionalidade: 'brasileiro', profissao: 'analista',
    estadoCivil: 'solteiro', rg: '12.345.678-9', cpf: '111.444.777-35',
    email: 'fulano@exemplo.com', dataNascimento: '1990-01-01', telefone: '(19) 99999-8888',
    linkKommo: 'https://advocaciacbc.kommo.com/leads/detail/5663434',
    cep: '13465-000', uf: 'SP', endereco: 'Rua A', numero: '10', bairro: 'Centro',
    cidade: 'Americana',
    ...over.contratante,
  }],
  resort: 'ONDAS PRAIA', tipoAcao: 'Ação de cobrança',
  honorarios: { total: 3600 },
  origemCliente: 'meta', dataPrimeiraMensagem: '2026-07-01',
  linkGoogleDrive: 'https://drive.google.com/drive/folders/abc',
  ...over.contrato,
});

describe('campos obrigatorios — as duas implementacoes tem de concordar', () => {
  it('o contrato completo passa no portao (o gabarito e valido)', () => {
    expect(validateChecklist(contratoCom())).toEqual([]);
  });

  it('TODO campo da lista de pessoa fisica e barrado pelo portao', () => {
    // este e o teste que impede a divergencia: campo na lista que o portao ignora
    // significa tela pedindo o que o envio nao exige
    for (const campo of CONTRATANTE_FIELDS_PF) {
      const issues = validateChecklist(contratoCom({ contratante: { [campo]: '' } }));
      expect(issues.length, `${campo} nao e barrado pelo portao de envio`).toBeGreaterThan(0);
      const texto = issues.map((i) => i.msg).join(' | ');
      expect(texto, `${campo}: portao reclamou de outra coisa -> ${texto}`)
        .toContain(ROTULO[campo]);
    }
  });

  it('TODO campo do bloco de empresa e barrado quando o cliente e pessoa juridica', () => {
    const empresaOk = {
      tipo: 'pj', razaoSocial: 'ACME LTDA', cnpj: '11.222.333/0001-81',
      emailEmpresa: 'contato@acme.com', cepEmpresa: '13465-000', ufEmpresa: 'SP',
      enderecoEmpresa: 'Av B', numeroEmpresa: '100', bairroEmpresa: 'Centro',
      cidadeEmpresa: 'Americana',
    };
    expect(validateChecklist(contratoCom({ contratante: empresaOk }))).toEqual([]);

    for (const campo of CONTRATANTE_FIELDS_EMPRESA) {
      const issues = validateChecklist(contratoCom({ contratante: { ...empresaOk, [campo]: '' } }));
      const texto = issues.map((i) => i.msg).join(' | ');
      expect(issues.length, `${campo} nao e barrado quando o cliente e empresa`).toBeGreaterThan(0);
      expect(texto, `${campo}: portao reclamou de outra coisa -> ${texto}`).toContain(ROTULO[campo]);
    }
  });

  it('o portao NAO exige nada alem da lista (senao a tela libera e o envio recusa)', () => {
    // o inverso do teste acima: com todos os campos da lista preenchidos, o portao tem
    // de estar satisfeito — em PF e em PJ
    expect(validateChecklist(contratoCom())).toEqual([]);
  });
});

describe('camposObrigatorios — a lista em si', () => {
  it('empresa exige o bloco da empresa MAIS os campos do representante legal', () => {
    // decisao de 25/06: no cliente empresa, os campos de pessoa descrevem o representante
    for (const campo of CONTRATANTE_FIELDS_PF) {
      expect(CONTRATANTE_FIELDS_PJ).toContain(campo);
    }
    for (const campo of CONTRATANTE_FIELDS_EMPRESA) {
      expect(CONTRATANTE_FIELDS_PJ).toContain(campo);
    }
  });

  it('escolhe a lista pelo tipo do contratante', () => {
    expect(camposObrigatorios({ tipo: 'pj' })).toBe(CONTRATANTE_FIELDS_PJ);
    expect(camposObrigatorios({ tipo: 'pf' })).toBe(CONTRATANTE_FIELDS_PF);
    expect(camposObrigatorios({})).toBe(CONTRATANTE_FIELDS_PF);
    expect(camposObrigatorios(null)).toBe(CONTRATANTE_FIELDS_PF);
  });

  it('nao ha campo repetido (repetido vira bolinha de progresso errada)', () => {
    expect(new Set(CONTRATANTE_FIELDS_PJ).size).toBe(CONTRATANTE_FIELDS_PJ.length);
    expect(new Set(CONTRATANTE_FIELDS_PF).size).toBe(CONTRATANTE_FIELDS_PF.length);
  });

  it('todo campo da lista tem rotulo conhecido no portao', () => {
    // guarda de manutencao: campo novo sem rotulo faria o teste de divergencia passar
    // por acidente, comparando com `undefined`
    for (const campo of CONTRATANTE_FIELDS_PJ) {
      expect(ROTULO[campo], `${campo} sem rotulo no de-para do teste`).toBeTruthy();
    }
  });
});

describe('validateChecklist — o que a lista sozinha nao sabe conferir', () => {
  it('CPF com formato certo mas digito verificador errado e barrado', () => {
    const issues = validateChecklist(contratoCom({ contratante: { cpf: '111.111.111-11' } }));
    expect(issues.map((i) => i.msg).join(' ')).toContain('CPF invalido');
  });

  it('link do Kommo fora do formato /leads/detail/{id} e barrado', () => {
    // qualquer outra URL quebra em silencio o mover-lead e as notas automaticas
    const issues = validateChecklist(contratoCom({
      contratante: { linkKommo: 'https://advocaciacbc.kommo.com/leads/pipeline/123' },
    }));
    expect(issues.map((i) => i.msg).join(' ')).toContain('Link Kommo invalido');
  });

  it('honorario zerado so passa se for somente exito', () => {
    expect(validateChecklist(contratoCom({ contrato: { honorarios: { total: 0 } } })).length)
      .toBeGreaterThan(0);
    expect(validateChecklist(contratoCom({ contrato: { honorarios: { total: 0, somenteExito: true } } })))
      .toEqual([]);
  });

  it('campos do contrato fora do contratante tambem barram', () => {
    for (const campo of ['origemCliente', 'dataPrimeiraMensagem', 'linkGoogleDrive']) {
      const issues = validateChecklist(contratoCom({ contrato: { [campo]: '' } }));
      expect(issues.length, `${campo} nao barra o envio`).toBeGreaterThan(0);
    }
  });
});
