import { describe, it, expect } from 'vitest';
import {
  extrairLeadId, matchResort, normalizeSexo, normalizeEstadoCivil, montarPreenchimento, montarRegistroSemKommo,
} from '../kommoResolve';

describe('montarRegistroSemKommo', () => {
  it('estrutura quem/quando/motivo (email minusculo, motivo aparado)', () => {
    const r = montarRegistroSemKommo('Paulo@Advocaciacbc.com', '  Cliente anterior ao Kommo  ', '2026-07-23T17:30:00Z');
    expect(r).toEqual({ user: 'paulo@advocaciacbc.com', ts: '2026-07-23T17:30:00Z', motivo: 'Cliente anterior ao Kommo' });
  });
  it('tolera vazios', () => {
    expect(montarRegistroSemKommo(null, null, null)).toEqual({ user: '', ts: null, motivo: '' });
  });
});

describe('extrairLeadId', () => {
  it('extrai o id do link de detalhe', () => {
    expect(extrairLeadId('https://advocaciacbc.kommo.com/leads/detail/21501586')).toBe('21501586');
    expect(extrairLeadId('https://advocaciacbc.kommo.com/leads/detail/123?x=1')).toBe('123');
  });
  it('retorna null p/ link invalido', () => {
    expect(extrairLeadId('nao eh link')).toBe(null);
    expect(extrairLeadId('')).toBe(null);
    expect(extrairLeadId(null)).toBe(null);
  });
});

describe('normalizeSexo', () => {
  it('mapeia p/ M/F', () => {
    expect(normalizeSexo('M')).toBe('M');
    expect(normalizeSexo('f')).toBe('F');
    expect(normalizeSexo('Masculino')).toBe('M');
    expect(normalizeSexo('feminino')).toBe('F');
    expect(normalizeSexo('')).toBe('');
    expect(normalizeSexo(null)).toBe('');
  });
});

describe('normalizeEstadoCivil (bagunca do Cadastro -> 5 opcoes)', () => {
  it('mapeia variantes', () => {
    expect(normalizeEstadoCivil('CASADO(A)')).toBe('Casado(a)');
    expect(normalizeEstadoCivil('casado')).toBe('Casado(a)');
    expect(normalizeEstadoCivil('CASADO (A)')).toBe('Casado(a)');
    expect(normalizeEstadoCivil('Casado(a) Reg. Comunhão Bens: PARCIAL')).toBe('Casado(a)');
    expect(normalizeEstadoCivil('solteira')).toBe('Solteiro(a)');
    expect(normalizeEstadoCivil('SOLTEIRO(A)')).toBe('Solteiro(a)');
    expect(normalizeEstadoCivil('DIVORCIADO')).toBe('Divorciado(a)');
    expect(normalizeEstadoCivil('VIÚVO(A)')).toBe('Viúvo(a)');
    expect(normalizeEstadoCivil('viúva')).toBe('Viúvo(a)');
    expect(normalizeEstadoCivil('UNIÃO ESTÁVEL')).toBe('União Estável');
    expect(normalizeEstadoCivil('Amasiado(a)')).toBe('União Estável');
    expect(normalizeEstadoCivil('convivente em união estável')).toBe('União Estável');
  });
  it('vazio ou desconhecido -> vazio (usuario preenche)', () => {
    expect(normalizeEstadoCivil('')).toBe('');
    expect(normalizeEstadoCivil(null)).toBe('');
    expect(normalizeEstadoCivil('outros')).toBe('');
  });
});

describe('matchResort (tag/cadastro -> nome canonico da lista)', () => {
  it('casa por normalizacao (sem acento, caixa)', () => {
    expect(matchResort('ONDAS PRAIA')).toBe('Ondas Praia');
    expect(matchResort('SOLAR DAS AGUAS')).toBe('Solar das Águas');
    expect(matchResort('solar das águas')).toBe('Solar das Águas');
  });
  it('sem match -> vazio', () => {
    expect(matchResort('Resort Inexistente XYZ')).toBe('');
    expect(matchResort('')).toBe('');
  });
});

describe('montarPreenchimento', () => {
  it('lead novo: telefone(kommo) + resort da tag(confirmar) + 1a msg do lead; nunca nome/origem', () => {
    const r = montarPreenchimento({
      contato: { telefone: '(22) 99104-8383' },
      tags: ['Ondas Praia'],
      cliente: null,
      primeiraMsgConversas: null,
      leadCriadoEm: '2026-07-23T06:04:00Z',
    });
    expect(r.campos.telefone).toBe('(22) 99104-8383');
    expect(r.proveniencia.telefone).toBe('kommo');
    expect(r.campos.resort).toBe('Ondas Praia');
    expect(r.proveniencia.resort).toBe('tag');
    expect(r.resortConfirmar).toBe(true);
    expect(r.campos.dataPrimeiraMensagem).toBe('2026-07-23');
    expect(r.proveniencia.dataPrimeiraMensagem).toBe('kommo');
    expect(r.clienteConhecido).toBe(false);
    expect(r.campos.nome).toBeUndefined();
    expect(r.campos.origemCliente).toBeUndefined();
  });

  it('cliente conhecido (PF): puxa o MAXIMO do Cadastro (nome+cpf+qualificacao) + 1a msg do CBC Conversas; nunca origem', () => {
    const r = montarPreenchimento({
      contato: { telefone: '5519912345678' }, // Kommo (com 55)
      tags: [],
      cliente: {
        nome: 'Maria da Silva', cpf_cnpj: '12345678909', eh_pj: false,
        rg: '34.567.890-2', nascimento: '1966-03-14', profissao: 'Aposentado(a)',
        estado_civil: 'CASADO(A)', genero: 'F', nacionalidade: 'brasileira',
        cep: '13480000', logradouro: 'Rua das Palmeiras', numero: '210', bairro: 'Centro',
        cidade: 'Limeira', uf: 'SP', complemento: 'Apto 32', email: 'maria@x.com',
        empreendimentos: 'SOLAR DAS AGUAS', telefone: '19997099607', // Cadastro (canonico)
      },
      primeiraMsgConversas: '2026-07-18T13:00:00Z',
      leadCriadoEm: '2026-07-21T13:24:00Z',
    });
    expect(r.clienteConhecido).toBe(true);
    expect(r.campos.tipo).toBe('pf');
    expect(r.campos.nome).toBe('Maria da Silva');       // nome verificado do Cadastro
    expect(r.campos.cpf).toBe('123.456.789-09');         // CPF mascarado
    expect(r.campos.estadoCivil).toBe('Casado(a)');
    expect(r.campos.sexo).toBe('F');
    expect(r.campos.dataNascimento).toBe('1966-03-14');
    expect(r.campos.cep).toBe('13480-000');              // CEP mascarado
    expect(r.campos.cidade).toBe('Limeira');
    expect(r.campos.telefone).toBe('(19) 99709-9607');   // do Cadastro (canonico), nao do Kommo
    expect(r.proveniencia.telefone).toBe('cadastro');
    expect(r.campos.resort).toBe('Solar das Águas');
    expect(r.proveniencia.resort).toBe('cadastro');
    expect(r.campos.dataPrimeiraMensagem).toBe('2026-07-18');
    expect(r.proveniencia.dataPrimeiraMensagem).toBe('conversas');
    expect(r.campos.origemCliente).toBeUndefined();
  });

  it('caso REAL GUSTAVO (lead 5816760): Kommo manda "55DD+8dig" SEM o 9 -> telefone canonico vem do Cadastro', () => {
    const r = montarPreenchimento({
      contato: { telefone: '553192050577' }, // Kommo sem o 9 do celular
      tags: [],
      cliente: { nome: 'GUSTAVO SILVA GUIMARAES', cpf_cnpj: '02871309671', telefone: '31992050577' },
    });
    expect(r.campos.nome).toBe('GUSTAVO SILVA GUIMARAES');
    expect(r.campos.cpf).toBe('028.713.096-71');
    expect(r.campos.telefone).toBe('(31) 99205-0577'); // completo, do Cadastro (nao o (53)... torto do Kommo)
    expect(r.proveniencia.telefone).toBe('cadastro');
  });

  it('fmtTelefone dropa o 55 sem estragar DDD 55 nacional', () => {
    // lead novo (sem cadastro): so o telefone do Kommo, mas com 55 removido corretamente
    const a = montarPreenchimento({ contato: { telefone: '5511987654321' }, tags: [], cliente: null });
    expect(a.campos.telefone).toBe('(11) 98765-4321'); // 13 digitos: dropa 55
    const b = montarPreenchimento({ contato: { telefone: '55987654321' }, tags: [], cliente: null });
    expect(b.campos.telefone).toBe('(55) 98765-4321'); // 11 digitos: DDD 55 nacional, NAO dropa
  });

  it('cliente conhecido (PJ): liga modo empresa (tipo pj + razao social + cnpj + endereco da empresa)', () => {
    const r = montarPreenchimento({
      contato: { telefone: '(11) 98888-7777' },
      tags: [],
      cliente: {
        nome: 'ACME EMPREENDIMENTOS LTDA', cpf_cnpj: '12345678000199', eh_pj: true,
        email: 'contato@acme.com', cep: '01310100', logradouro: 'Av Paulista',
        numero: '1000', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP',
        empreendimentos: 'HOT BEACH',
      },
    });
    expect(r.campos.tipo).toBe('pj');
    expect(r.campos.razaoSocial).toBe('ACME EMPREENDIMENTOS LTDA');
    expect(r.campos.cnpj).toBe('12.345.678/0001-99');
    expect(r.campos.emailEmpresa).toBe('contato@acme.com');
    expect(r.campos.cepEmpresa).toBe('01310-100');
    expect(r.campos.enderecoEmpresa).toBe('Av Paulista');
    expect(r.campos.cidadeEmpresa).toBe('São Paulo');
    expect(r.campos.resort).toBe('Hot Beach');
    expect(r.campos.nome).toBeUndefined();   // nao poe razao social no nome do representante
    expect(r.campos.cpf).toBeUndefined();
  });

  it('detecta PJ pelo tamanho do documento (14 digitos) mesmo sem eh_pj', () => {
    const r = montarPreenchimento({
      contato: {}, tags: [], cliente: { nome: 'X LTDA', cpf_cnpj: '11222333000181' },
    });
    expect(r.campos.tipo).toBe('pj');
    expect(r.campos.cnpj).toBe('11.222.333/0001-81');
  });

  it('telefone: usa o do Cadastro quando o Kommo nao trouxe', () => {
    const r = montarPreenchimento({
      contato: {}, tags: [],
      cliente: { nome: 'João', cpf_cnpj: '12345678909', telefone: '5519997099607' },
    });
    expect(r.campos.telefone).toBe('(19) 99709-9607'); // fallback do cadastro
    expect(r.proveniencia.telefone).toBe('cadastro');
  });

  it('caso REAL do teste do Paulo (lead 12820604, Hot Beach, sem cadastro)', () => {
    // dados exatos vindos do Kommo + RPC resolve_kommo_dados (verificados em prod)
    const r = montarPreenchimento({
      contato: { telefone: '5515997312888', email: '' },
      tags: ['HOT BEACH', 'LIMBO'],
      cliente: null,
      primeiraMsgConversas: '2024-07-22T08:54:43.275+00:00',
      leadCriadoEm: '2024-07-22T08:54:00.000Z',
    });
    expect(r.campos.telefone).toBe('(15) 99731-2888'); // formatado, sem o 55
    expect(r.proveniencia.telefone).toBe('kommo');
    expect(r.campos.resort).toBe('Hot Beach');
    expect(r.proveniencia.resort).toBe('tag');
    expect(r.resortConfirmar).toBe(true);
    expect(r.campos.dataPrimeiraMensagem).toBe('2024-07-22');
    expect(r.proveniencia.dataPrimeiraMensagem).toBe('conversas');
    expect(r.clienteConhecido).toBe(false);
    expect(r.campos.nome).toBeUndefined();
    expect(r.campos.origemCliente).toBeUndefined();
  });

  it('telefone 55DDDnumero vira (DD) numero', () => {
    const r = montarPreenchimento({ contato: { telefone: '5515997312888' }, tags: [], cliente: null });
    expect(r.campos.telefone).toBe('(15) 99731-2888');
  });

  it('resort SOBRESCREVE o que ja estava e marca resortAlterado', () => {
    const r = montarPreenchimento(
      { contato: {}, tags: ['Hot Beach'], cliente: null },
      { resort: 'Solar das Águas' }, // ja tinha outro resort no form
    );
    expect(r.campos.resort).toBe('Hot Beach');      // sobrescreveu
    expect(r.proveniencia.resort).toBe('tag');
    expect(r.resortConfirmar).toBe(true);
    expect(r.resortAlterado).toBe(true);            // avisa que trocou
  });

  it('vincular SOBRESCREVE a 1a msg de um vinculo anterior (lead diferente)', () => {
    const r = montarPreenchimento(
      { contato: {}, tags: [], cliente: null, leadCriadoEm: '2026-01-01T00:00:00Z' },
      { dataPrimeiraMensagem: '2020-05-05' }, // valor de um lead vinculado antes
    );
    expect(r.campos.dataPrimeiraMensagem).toBe('2026-01-01');
  });

  it('telefone SEMPRE reformata, mesmo se ja tinha valor cru (re-vincular)', () => {
    const r = montarPreenchimento(
      { contato: { telefone: '5515997312888' }, tags: [], cliente: null },
      { telefone: '5515997312888' }, // valor cru de um vincular anterior
    );
    expect(r.campos.telefone).toBe('(15) 99731-2888');
  });
});
