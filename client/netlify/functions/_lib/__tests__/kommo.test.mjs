// (auditoria 01/08/2026 — item 297) `_lib/kommo.mjs` (348 linhas, mexida vaias vezes nos
// ultimos meses) e a porta de TODA conversa com o CRM comercial: mover lead, postar nota,
// gravar campo, disparar Salesbot. Nao tinha um unico teste.
//
// O risco concreto: as funcoes de EXTRACAO abaixo decidem PARA QUEM a mensagem vai. Se
// `extrairLeadId` devolver o numero errado, o link de assinatura do cliente A e postado
// na conversa do cliente B — e o Kommo nao deixa apagar nota. Se `extractFieldValue`
// devolver vazio quando ha valor, o sistema acha que o campo nao foi gravado e reescreve.
//
// Aqui so entra logica PURA (nenhuma chamada de rede).
import { describe, it, expect } from 'vitest';
import { extrairLeadId, extrairHostKommo, extractPhones, firstLeadId, extractFieldValue } from '../kommo.mjs';

describe('extrairLeadId — de quem e a conversa', () => {
  it('aceita o link completo do lead', () => {
    expect(extrairLeadId('https://advocaciacbc.kommo.com/leads/detail/5663434')).toBe('5663434');
  });

  it('aceita o id puro (o formulario as vezes recebe so o numero)', () => {
    expect(extrairLeadId('5663434')).toBe('5663434');
    expect(extrairLeadId(5663434)).toBe('5663434');
  });

  it('link com parametro ou barra final ainda casa', () => {
    expect(extrairLeadId('https://advocaciacbc.kommo.com/leads/detail/123?from=x')).toBe('123');
    expect(extrairLeadId('https://advocaciacbc.kommo.com/leads/detail/123/')).toBe('123');
  });

  it('devolve null quando NAO da para saber — nunca chutar destinatario', () => {
    expect(extrairLeadId('')).toBe(null);
    expect(extrairLeadId(null)).toBe(null);
    expect(extrairLeadId('https://advocaciacbc.kommo.com/leads')).toBe(null);
    expect(extrairLeadId('conversa do cliente')).toBe(null);
  });

  it('link de CONTATO nao vira id de lead (sao entidades diferentes no Kommo)', () => {
    expect(extrairLeadId('https://advocaciacbc.kommo.com/contacts/detail/999')).toBe(null);
  });
});

describe('extrairHostKommo — separa a conta do escritorio de outras', () => {
  it('devolve o dominio em minusculas', () => {
    expect(extrairHostKommo('https://advocaciacbc.kommo.com/leads/detail/1')).toBe('advocaciacbc.kommo.com');
    expect(extrairHostKommo('HTTPS://ADVOCACIACBC.KOMMO.COM/x')).toBe('advocaciacbc.kommo.com');
  });

  it('aceita http e devolve null para o que nao e link', () => {
    expect(extrairHostKommo('http://outra.kommo.com/leads/detail/2')).toBe('outra.kommo.com');
    expect(extrairHostKommo('5663434')).toBe(null);
    expect(extrairHostKommo(null)).toBe(null);
  });
});

describe('extractPhones — telefones do contato', () => {
  const contato = {
    custom_fields_values: [
      { field_code: 'EMAIL', values: [{ value: 'a@b.com' }] },
      { field_code: 'PHONE', values: [{ value: '+55 (19) 99999-8888' }, { value: '1933334444' }] },
    ],
  };

  it('devolve so digitos, na ordem, e ignora campos que nao sao telefone', () => {
    expect(extractPhones(contato)).toEqual(['5519999998888', '1933334444']);
  });

  it('descarta valor vazio (campo criado e nunca preenchido)', () => {
    expect(extractPhones({ custom_fields_values: [{ field_code: 'PHONE', values: [{ value: '' }, { value: '—' }] }] }))
      .toEqual([]);
  });

  it('contato sem campos / nulo devolve lista vazia, sem quebrar', () => {
    expect(extractPhones({})).toEqual([]);
    expect(extractPhones(null)).toEqual([]);
    expect(extractPhones({ custom_fields_values: [{ field_code: 'PHONE' }] })).toEqual([]);
  });
});

describe('firstLeadId — lead vinculado ao contato', () => {
  it('devolve o id do primeiro lead', () => {
    expect(firstLeadId({ _embedded: { leads: [{ id: 11 }, { id: 22 }] } })).toBe(11);
  });

  it('sem lead vinculado devolve null (nao inventa destinatario)', () => {
    expect(firstLeadId({ _embedded: { leads: [] } })).toBe(null);
    expect(firstLeadId({})).toBe(null);
    expect(firstLeadId(null)).toBe(null);
  });
});

describe('extractFieldValue — leitura de campo personalizado', () => {
  const lead = {
    custom_fields_values: [
      { field_id: 2441560, values: [{ value: 'Olá, seu contrato está pronto' }] },
      { field_id: 2434598, values: [{ value: 'https://asaas.com/c/1' }, { value: 'https://asaas.com/c/2' }] },
      { field_id: 999, values: [{ value: null }, { value: 'sobrou' }] },
    ],
  };

  it('acha o campo pelo id', () => {
    expect(extractFieldValue(lead, 2441560)).toBe('Olá, seu contrato está pronto');
  });

  it('id como texto tambem casa (a config guarda numero em JSON)', () => {
    expect(extractFieldValue(lead, '2441560')).toBe('Olá, seu contrato está pronto');
  });

  it('varios valores no mesmo campo vem juntos, um por linha', () => {
    expect(extractFieldValue(lead, 2434598)).toBe('https://asaas.com/c/1\nhttps://asaas.com/c/2');
  });

  it('valor nulo e descartado, o resto continua', () => {
    expect(extractFieldValue(lead, 999)).toBe('sobrou');
  });

  it('campo inexistente devolve null — diferente de "existe e esta vazio"', () => {
    expect(extractFieldValue(lead, 1234)).toBe(null);
    expect(extractFieldValue({}, 1)).toBe(null);
    expect(extractFieldValue(null, 1)).toBe(null);
  });
});
