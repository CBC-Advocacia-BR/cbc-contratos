// (Task 10, agenda-admin.mjs) setEventColor é I/O puro (fetch) — mesmo padrão de
// patchEventHorario/cancelEvent, mas aqui dá pra testar com vi.stubGlobal('fetch', ...):
// confere a URL/verbo/corpo da requisição e a propagação de erro, sem bater na API real do
// Google. (vi.stubGlobal em vez de reatribuir `global.fetch` direto — `global` não existe no
// set de globals do eslint deste projeto, que é browser-only; ver client/eslint.config.js.)
import { describe, it, expect, vi, afterEach } from 'vitest';
import { setEventColor } from '../../../netlify/functions/_lib/googleAgenda.mjs';

describe('setEventColor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('faz PATCH no evento certo, com o colorId no corpo e o Bearer certo', async () => {
    let captured = null;
    const fetchMock = vi.fn(async (url, opts) => {
      captured = { url: String(url), ...opts };
      return { json: async () => ({ id: 'ev1', colorId: '10' }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    await setEventColor({ calendarId: 'beatriz@advocaciacbc.com', eventId: 'ev1', colorId: '10', accessToken: 'tok123' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captured.url).toBe('https://www.googleapis.com/calendar/v3/calendars/beatriz%40advocaciacbc.com/events/ev1');
    expect(captured.method).toBe('PATCH');
    expect(captured.headers.Authorization).toBe('Bearer tok123');
    expect(captured.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(captured.body)).toEqual({ colorId: '10' });
  });

  it('aceita colorId numerico e converte p/ string no corpo (Google espera string)', async () => {
    let body;
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => { body = opts.body; return { json: async () => ({}) }; }));
    await setEventColor({ calendarId: 'v@advocaciacbc.com', eventId: 'e2', colorId: 11, accessToken: 't' });
    expect(JSON.parse(body)).toEqual({ colorId: '11' });
  });

  // Revisão final #2: colorId null precisa LIMPAR a cor do evento real (usado ao reagendar).
  // Bug corrigido: `String(colorId)` sempre rodava, e `String(null)` vira a STRING "null" —
  // não um colorId válido (1-11) — o Google rejeitaria isso em vez de limpar a cor.
  it('colorId null manda { colorId: null } (JSON null de verdade, nunca a string "null")', async () => {
    let body;
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => { body = opts.body; return { json: async () => ({}) }; }));
    await setEventColor({ calendarId: 'v@advocaciacbc.com', eventId: 'e3', colorId: null, accessToken: 't' });
    expect(body).toBe('{"colorId":null}');
    expect(JSON.parse(body).colorId).toBeNull();
  });

  it('colorId undefined tambem limpa a cor (mesmo tratamento de null)', async () => {
    let body;
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => { body = opts.body; return { json: async () => ({}) }; }));
    await setEventColor({ calendarId: 'v@advocaciacbc.com', eventId: 'e4', colorId: undefined, accessToken: 't' });
    expect(JSON.parse(body)).toEqual({ colorId: null });
  });

  it('lanca erro quando a API do Google retorna { error }', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ error: { message: 'Not Found' } }) })));
    await expect(
      setEventColor({ calendarId: 'v@advocaciacbc.com', eventId: 'ev-inexistente', colorId: '7', accessToken: 'tok' })
    ).rejects.toThrow('setEventColor: Not Found');
  });
});
