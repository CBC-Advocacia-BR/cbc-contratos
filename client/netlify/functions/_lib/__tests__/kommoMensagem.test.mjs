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
    expect(r.msg.kommo_msg_id).toBe('abc-123');
    expect(r.msg.direcao).toBe('in');
    expect(r.msg.lead_id).toBe('22337966');
    expect(r.msg.contact_id).toBe('99887766');
    expect(r.msg.texto).toBe('Bom dia, quero cancelar minha cota');
    expect(r.msg.criado_em).toBe('2026-08-04T12:00:00.000Z');
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
    expect(r.msg.direcao).toBe('out');
    expect(r.msg.autor_id).toBe(15297447);
    expect(r.msg.autor_nome).toBe('Mariana Beraldo');
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
    expect(r.msg.tipo).toBe('audio');
    expect(r.msg.texto).toBe('[Áudio]');
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
});
