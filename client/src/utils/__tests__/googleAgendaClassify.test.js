import { describe, it, expect } from 'vitest';
import { classifyEvent } from '../../../netlify/functions/_lib/googleAgenda.mjs';

const base = { id: 'ev1', status: 'confirmed', start: { dateTime: '2026-07-22T13:00:00-03:00' }, colorId: null };

describe('classifyEvent', () => {
  it('mantém: convidado externo + meet = atendimento', () => {
    const ev = { ...base, attendees: [{ email: 'cliente@gmail.com' }], hangoutLink: 'https://meet.google.com/x' };
    const r = classifyEvent(ev, 'v@advocaciacbc.com');
    expect(r).toMatchObject({ event_id: 'ev1', status: 'agendada', origem: 'manual' });
  });
  it('novo: evento da Ana SEM convidado, com extendedProperties', () => {
    const ev = { ...base, hangoutLink: 'https://meet.google.com/x',
      extendedProperties: { private: { cbc_origem: 'ana', cbc_lead_id: '123', cbc_telefone: '5511999998888' } } };
    const r = classifyEvent(ev, 'v@advocaciacbc.com');
    expect(r).toMatchObject({ origem: 'ana', lead_id: 123, telefone: '5511999998888', status: 'agendada' });
  });
  it('segue ignorando evento interno sem meet e sem marca da Ana', () => {
    expect(classifyEvent({ ...base, attendees: [{ email: 'x@advocaciacbc.com' }] }, 'v@advocaciacbc.com')).toBe(null);
  });
});
