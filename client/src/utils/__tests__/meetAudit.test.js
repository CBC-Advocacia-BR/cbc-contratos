import { describe, it, expect } from 'vitest';
import { classifyMeetItems, deriveMeetStatus, buildMeetUrl } from '../../../netlify/functions/_lib/meetAudit.mjs';

// fixture com o formato REAL do call_ended (parametros name/value|intValue|boolValue)
const mk = (calId, id, ext, seg) => ({
  id: { time: '2026-07-23T12:00:00.000Z' },
  actor: { email: id.includes('@') ? id : undefined },
  events: [{ name: 'call_ended', parameters: [
    { name: 'calendar_event_id', value: calId },
    { name: 'identifier', value: id },
    { name: 'is_external', boolValue: ext },
    { name: 'duration_seconds', intValue: String(seg) },
  ] }],
});

describe('classifyMeetItems + deriveMeetStatus', () => {
  it('cliente externo > 5min => realizada', () => {
    const by = classifyMeetItems([
      mk('EV1', 'marianamaciel@advocaciacbc.com', false, 1500),
      mk('EV1', 'cliente@gmail.com', true, 1188),
    ]);
    expect(by.EV1.cliente_seg).toBe(1188);
    expect(deriveMeetStatus(by.EV1)).toBe('realizada');
  });

  it('so interno => no_show', () => {
    const by = classifyMeetItems([mk('EV2', 'beatriz@advocaciacbc.com', false, 900)]);
    expect(by.EV2.cliente_seg).toBe(0);
    expect(deriveMeetStatus(by.EV2)).toBe('no_show');
  });

  it('cliente anonimo (sem email, is_external true) conta como cliente', () => {
    const by = classifyMeetItems([
      mk('EV3', 'emerson@advocaciacbc.com', false, 800),
      { events: [{ name: 'call_ended', parameters: [
        { name: 'calendar_event_id', value: 'EV3' },
        { name: 'identifier', value: 'anon-abc123' },
        { name: 'is_external', boolValue: true },
        { name: 'duration_seconds', intValue: '600' },
      ] }] },
    ]);
    expect(deriveMeetStatus(by.EV3)).toBe('realizada');
  });

  it('cliente < 5min => no_show', () => {
    const by = classifyMeetItems([
      mk('EV4', 'mizael@advocaciacbc.com', false, 1000),
      mk('EV4', 'cliente2@hotmail.com', true, 200),
    ]);
    expect(deriveMeetStatus(by.EV4)).toBe('no_show');
  });

  it('soma multiplas sessoes do mesmo cliente', () => {
    const by = classifyMeetItems([
      mk('EV5', 'cliente3@gmail.com', true, 200),
      mk('EV5', 'cliente3@gmail.com', true, 200),
    ]);
    expect(by.EV5.cliente_seg).toBe(400);
    expect(deriveMeetStatus(by.EV5)).toBe('realizada'); // 400 > 300
  });

  it('ignora item sem calendar_event_id', () => {
    const by = classifyMeetItems([{ events: [{ name: 'call_ended', parameters: [
      { name: 'identifier', value: 'x@y.com' }, { name: 'duration_seconds', intValue: '999' },
    ] }] }]);
    expect(Object.keys(by).length).toBe(0);
  });
});

describe('buildMeetUrl', () => {
  it('monta a URL com eventName, startTime e pageToken', () => {
    const u = buildMeetUrl('2026-07-20T00:00:00Z', '2026-07-24T00:00:00Z', 'TK');
    expect(u).toContain('/applications/meet');
    expect(u).toContain('eventName=call_ended');
    expect(u).toContain('startTime=2026-07-20T00%3A00%3A00Z');
    expect(u).toContain('endTime=2026-07-24T00%3A00%3A00Z');
    expect(u).toContain('pageToken=TK');
    expect(u).toContain('maxResults=1000');
  });
});
