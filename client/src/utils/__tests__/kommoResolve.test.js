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

  it('cliente conhecido: qualificacao do Cadastro + 1a msg do CBC Conversas; nunca nome/origem', () => {
    const r = montarPreenchimento({
      contato: { telefone: '(19) 99709-9607' },
      tags: [],
      cliente: {
        rg: '34.567.890-2', nascimento: '1966-03-14', profissao: 'Aposentado(a)',
        estado_civil: 'CASADO(A)', genero: 'F', nacionalidade: 'brasileira',
        cep: '13480-000', logradouro: 'Rua das Palmeiras', numero: '210', bairro: 'Centro',
        cidade: 'Limeira', uf: 'SP', complemento: 'Apto 32', email: 'maria@x.com',
        empreendimentos: 'SOLAR DAS AGUAS',
      },
      primeiraMsgConversas: '2026-07-18T13:00:00Z',
      leadCriadoEm: '2026-07-21T13:24:00Z',
    });
    expect(r.clienteConhecido).toBe(true);
    expect(r.campos.estadoCivil).toBe('Casado(a)');
    expect(r.campos.sexo).toBe('F');
    expect(r.campos.dataNascimento).toBe('1966-03-14');
    expect(r.campos.cidade).toBe('Limeira');
    expect(r.campos.resort).toBe('Solar das Águas');
    expect(r.proveniencia.resort).toBe('cadastro');
    expect(r.campos.dataPrimeiraMensagem).toBe('2026-07-18');
    expect(r.proveniencia.dataPrimeiraMensagem).toBe('conversas');
    expect(r.campos.nome).toBeUndefined();
    expect(r.campos.origemCliente).toBeUndefined();
  });

  it('nao sobrescreve o que ja foi digitado', () => {
    const r = montarPreenchimento(
      { contato: { telefone: '(22) 99104-8383' }, tags: [], cliente: null },
      { telefone: 'já digitado' },
    );
    expect(r.campos.telefone).toBeUndefined();
  });
});
