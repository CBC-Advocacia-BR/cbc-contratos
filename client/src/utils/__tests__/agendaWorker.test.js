// Testes das partes PURAS do worker da Ana (agenda-bot-worker-background.mjs).
// A orquestracao (I/O: Kommo, Calendar, Supabase, LLM/STT) fica sem unit test —
// validada no piloto (Task 15). Aqui: parse do payload, allowlist de host do anexo
// e a decisao do teto de bytes do audio.
import { describe, it, expect } from 'vitest';
import { parsePayload, anexoPermitido, tetoBytes, excedeTeto } from '../../../netlify/functions/agenda-bot-worker-background.mjs';

describe('parsePayload', () => {
  it('JSON: extrai texto, contato, msgId e anexo de message.add[0]', () => {
    const raw = JSON.stringify({ message: { add: [{ text: 'oi', contact_id: 123, id: 'M1', type: 'incoming',
      attachment: { link: 'https://x.kommo.com/a.ogg', type: 'voice' } }] } });
    const m = parsePayload('application/json', raw);
    expect(m).toMatchObject({ text: 'oi', contactId: 123, msgId: 'M1', type: 'incoming',
      anexoLink: 'https://x.kommo.com/a.ogg', anexoTipo: 'voice' });
  });

  it('JSON: chat_message_id tem prioridade p/ msgId', () => {
    const raw = JSON.stringify({ message: { add: [{ text: 't', contact_id: 9, chat_message_id: 'CM', id: 'ID' }] } });
    expect(parsePayload('application/json', raw).msgId).toBe('CM');
  });

  it('form-encoded: le message[add][0][...] + chat_message_id', () => {
    const raw = 'message[add][0][text]=ol%C3%A1&message[add][0][contact_id]=55&message[add][0][chat_message_id]=Z9&message[add][0][type]=incoming';
    const m = parsePayload('application/x-www-form-urlencoded', raw);
    expect(m).toMatchObject({ text: 'olá', contactId: '55', msgId: 'Z9', type: 'incoming' });
  });

  it('form-encoded: anexo aninhado [attachment][link]/[type]', () => {
    const raw = 'message[add][0][contact_id]=1&message[add][0][attachment][link]=https%3A%2F%2Fs3.amazonaws.com%2Fa.ogg&message[add][0][attachment][type]=audio';
    const m = parsePayload('', raw);
    expect(m.anexoLink).toBe('https://s3.amazonaws.com/a.ogg');
    expect(m.anexoTipo).toBe('audio');
  });

  it('form-encoded: tolera a grafia alternativa [attachment[link]] (defensivo p/ piloto)', () => {
    const raw = 'message[add][0][contact_id]=1&message[add][0][attachment[link]]=https%3A%2F%2Fx.kommo.com%2Fb.ogg&message[add][0][attachment[type]]=ptt';
    const m = parsePayload('', raw);
    expect(m.anexoLink).toBe('https://x.kommo.com/b.ogg');
    expect(m.anexoTipo).toBe('ptt');
  });

  it('form-encoded: cai em element_id quando nao ha contact_id', () => {
    const m = parsePayload('', 'message[add][0][element_id]=777&message[add][0][text]=x');
    expect(m.contactId).toBe('777');
  });

  it('JSON invalido: nao lanca, cai no form-encoded (campos nulos)', () => {
    const m = parsePayload('application/json', '{lixo');
    expect(m.contactId).toBeNull();
    expect(m.text).toBe('');
    expect(m.anexoLink).toBeNull();
  });

  it('raw vazio/undefined: retorna estrutura com nulos, sem lançar', () => {
    expect(() => parsePayload('', undefined)).not.toThrow();
    const m = parsePayload('', '');
    expect(m).toMatchObject({ text: '', contactId: null, msgId: null, anexoLink: null, anexoTipo: null });
  });
});

describe('anexoPermitido (allowlist de host — anti-SSRF)', () => {
  it('aceita https em host kommo / amocrm / amazonaws (inclui subdominios)', () => {
    expect(anexoPermitido('https://files.kommo.com/x.ogg')).toBe(true);
    expect(anexoPermitido('https://cdn.amocrm.com/x.ogg')).toBe(true);
    expect(anexoPermitido('https://my-bucket.s3.amazonaws.com/x.ogg')).toBe(true);
  });

  it('rejeita http (nao-https) mesmo em host confiavel', () => {
    expect(anexoPermitido('http://files.kommo.com/x.ogg')).toBe(false);
  });

  it('rejeita host arbitrario', () => {
    expect(anexoPermitido('https://evil.example.com/x.ogg')).toBe(false);
  });

  it('nao se deixa enganar por kommo no path/query (checa hostname, nao a string)', () => {
    expect(anexoPermitido('https://evil.com/kommo/x.ogg')).toBe(false);
    expect(anexoPermitido('https://evil.com/?u=amazonaws')).toBe(false);
  });

  it('rejeita entradas invalidas/nulas sem lançar', () => {
    expect(anexoPermitido(null)).toBe(false);
    expect(anexoPermitido('')).toBe(false);
    expect(anexoPermitido('nao-e-url')).toBe(false);
  });
});

describe('tetoBytes / excedeTeto', () => {
  it('tetoBytes usa cfg.stt.max_minutos * 1e6', () => {
    expect(tetoBytes({ stt: { max_minutos: 3 } })).toBe(3_000_000);
  });

  it('tetoBytes cai p/ 5MB quando max_minutos ausente/invalido', () => {
    expect(tetoBytes({})).toBe(5_000_000);
    expect(tetoBytes({ stt: {} })).toBe(5_000_000);
    expect(tetoBytes({ stt: { max_minutos: 0 } })).toBe(5_000_000);
    expect(tetoBytes(undefined)).toBe(5_000_000);
  });

  it('excedeTeto true apenas quando Content-Length > teto', () => {
    const cfg = { stt: { max_minutos: 3 } }; // teto 3MB
    expect(excedeTeto(3_000_001, cfg)).toBe(true);
    expect(excedeTeto('9000000', cfg)).toBe(true);
    expect(excedeTeto(3_000_000, cfg)).toBe(false); // no limite, nao excede
    expect(excedeTeto(1000, cfg)).toBe(false);
  });

  it('excedeTeto false quando Content-Length ausente/invalido (prossegue; 25MB do transcrever segura)', () => {
    const cfg = { stt: { max_minutos: 3 } };
    expect(excedeTeto(null, cfg)).toBe(false);
    expect(excedeTeto(undefined, cfg)).toBe(false);
    expect(excedeTeto('', cfg)).toBe(false);
    expect(excedeTeto('abc', cfg)).toBe(false);
    expect(excedeTeto(0, cfg)).toBe(false);
    expect(excedeTeto(-5, cfg)).toBe(false);
  });
});
