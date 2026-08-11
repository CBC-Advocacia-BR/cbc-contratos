import { describe, it, expect } from 'vitest';
import { parseMensagemKommo } from '../kommoMensagem.mjs';

const form = (o) => new URLSearchParams(o).toString();

describe('parseMensagemKommo', () => {
  it('le uma mensagem recebida do cliente', () => {
    const raw = form({
      'message[add][0][id]': 'abc-123',
      'message[add][0][type]': 'incoming',
      'message[add][0][text]': 'Bom dia, quero cancelar minha cota',
      'message[add][0][created_at]': '1785844800',
      'message[add][0][entity_id]': '22337966',
      'message[add][0][contact_id]': '99887766',
      'message[add][0][author][id]': '0',
      'message[add][0][author][name]': 'Eduardo Paleari',
    });
    const r = parseMensagemKommo('application/x-www-form-urlencoded', raw);
    expect(r.ok).toBe(true);
    expect(r.msgs).toHaveLength(1);
    expect(r.msgs[0].kommo_msg_id).toBe('abc-123');
    expect(r.msgs[0].direcao).toBe('in');
    expect(r.msgs[0].lead_id).toBe('22337966');
    expect(r.msgs[0].contact_id).toBe('99887766');
    expect(r.msgs[0].texto).toBe('Bom dia, quero cancelar minha cota');
    expect(r.msgs[0].criado_em).toBe('2026-08-04T12:00:00.000Z');
  });

  it('mensagem nossa vira direcao out', () => {
    const raw = form({
      'message[add][0][id]': 'def-456',
      'message[add][0][type]': 'outgoing',
      'message[add][0][text]': 'Ola, tudo bem?',
      'message[add][0][created_at]': '1785844800',
      'message[add][0][entity_id]': '22337966',
      'message[add][0][author][id]': '15297447',
      'message[add][0][author][name]': 'Mariana Beraldo',
    });
    const r = parseMensagemKommo('application/x-www-form-urlencoded', raw);
    expect(r.msgs[0].direcao).toBe('out');
    expect(r.msgs[0].autor_id).toBe(15297447);
    expect(r.msgs[0].autor_nome).toBe('Mariana Beraldo');
  });

  it('audio sem texto vira tipo audio, nao mensagem vazia', () => {
    const raw = form({
      'message[add][0][id]': 'ghi-789',
      'message[add][0][type]': 'incoming',
      'message[add][0][text]': '',
      'message[add][0][attachment][type]': 'voice',
      'message[add][0][created_at]': '1785844800',
      'message[add][0][entity_id]': '22337966',
    });
    const r = parseMensagemKommo('application/x-www-form-urlencoded', raw);
    expect(r.ok).toBe(true);
    expect(r.msgs[0].tipo).toBe('audio');
    expect(r.msgs[0].texto).toBe('[Áudio]');
  });

  it('payload sem mensagem devolve motivo, nunca lanca', () => {
    expect(parseMensagemKommo('application/x-www-form-urlencoded', 'foo=bar').ok).toBe(false);
    expect(parseMensagemKommo('application/json', '{}').ok).toBe(false);
    expect(parseMensagemKommo('', '').ok).toBe(false);
  });

  it('mensagem sem lead_id nao entra no espelho', () => {
    const raw = form({
      'message[add][0][id]': 'jkl-000',
      'message[add][0][type]': 'incoming',
      'message[add][0][text]': 'oi',
      'message[add][0][created_at]': '1785844800',
    });
    const r = parseMensagemKommo('application/x-www-form-urlencoded', raw);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/lead/i);
  });

  it('payload com tres mensagens devolve as tres, na ordem', () => {
    const raw = form({
      'message[add][0][id]': 'msg-0',
      'message[add][0][type]': 'incoming',
      'message[add][0][text]': 'primeira',
      'message[add][0][created_at]': '1785844800',
      'message[add][0][entity_id]': '22337966',
      'message[add][1][id]': 'msg-1',
      'message[add][1][type]': 'outgoing',
      'message[add][1][text]': 'segunda',
      'message[add][1][created_at]': '1785844801',
      'message[add][1][entity_id]': '22337966',
      'message[add][2][id]': 'msg-2',
      'message[add][2][type]': 'incoming',
      'message[add][2][text]': 'terceira',
      'message[add][2][created_at]': '1785844802',
      'message[add][2][entity_id]': '22337966',
    });
    const r = parseMensagemKommo('application/x-www-form-urlencoded', raw);
    expect(r.ok).toBe(true);
    expect(r.msgs).toHaveLength(3);
    expect(r.msgs.map((m) => m.kommo_msg_id)).toEqual(['msg-0', 'msg-1', 'msg-2']);
    expect(r.msgs.map((m) => m.texto)).toEqual(['primeira', 'segunda', 'terceira']);
  });

  it('payload com tres mensagens onde a do meio nao tem lead devolve as duas validas', () => {
    const raw = form({
      'message[add][0][id]': 'msg-0',
      'message[add][0][type]': 'incoming',
      'message[add][0][text]': 'primeira',
      'message[add][0][created_at]': '1785844800',
      'message[add][0][entity_id]': '22337966',
      // mensagem do meio (indice 1) sem entity_id -> deve ser pulada, nao derruba as outras
      'message[add][1][id]': 'msg-1',
      'message[add][1][type]': 'outgoing',
      'message[add][1][text]': 'sem lead',
      'message[add][1][created_at]': '1785844801',
      'message[add][2][id]': 'msg-2',
      'message[add][2][type]': 'incoming',
      'message[add][2][text]': 'terceira',
      'message[add][2][created_at]': '1785844802',
      'message[add][2][entity_id]': '22337966',
    });
    const r = parseMensagemKommo('application/x-www-form-urlencoded', raw);
    expect(r.ok).toBe(true);
    expect(r.msgs).toHaveLength(2);
    expect(r.msgs.map((m) => m.kommo_msg_id)).toEqual(['msg-0', 'msg-2']);
  });

  it('author[id] igual a "0" vira autor_id igual a 0, nao null', () => {
    const raw = form({
      'message[add][0][id]': 'zero-id',
      'message[add][0][type]': 'incoming',
      'message[add][0][text]': 'oi',
      'message[add][0][created_at]': '1785844800',
      'message[add][0][entity_id]': '22337966',
      'message[add][0][author][id]': '0',
    });
    const r = parseMensagemKommo('application/x-www-form-urlencoded', raw);
    expect(r.ok).toBe(true);
    expect(r.msgs[0].autor_id).toBe(0);
    expect(r.msgs[0].autor_id).not.toBeNull();
  });

  it('author[id] ausente continua virando null', () => {
    const raw = form({
      'message[add][0][id]': 'sem-autor',
      'message[add][0][type]': 'incoming',
      'message[add][0][text]': 'oi',
      'message[add][0][created_at]': '1785844800',
      'message[add][0][entity_id]': '22337966',
    });
    const r = parseMensagemKommo('application/x-www-form-urlencoded', raw);
    expect(r.ok).toBe(true);
    expect(r.msgs[0].autor_id).toBeNull();
  });
});
