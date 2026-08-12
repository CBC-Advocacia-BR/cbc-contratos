// classifyEvent decide o que E e o que NAO E atendimento de venda, e alimenta o
// funil inteiro. Nao tinha teste nenhum ate 12/08/2026; ganhou um quando passou a
// guardar tambem o link do Meet, que e o botao principal do lembrete do dia.
import { describe, it, expect } from 'vitest';
import { classifyEvent, linkDoMeet, VENDEDORAS } from '../googleAgenda.mjs';

const evento = (extra = {}) => ({
  id: 'evt1', status: 'confirmed',
  summary: 'Fatima +5518997479595',
  start: { dateTime: '2026-08-14T18:00:00Z' },
  hangoutLink: 'https://meet.google.com/abc-defg-hij',
  attendees: [
    { email: 'beatriz@advocaciacbc.com' },
    { email: 'Cliente@Exemplo.com', displayName: 'Fatima' },
  ],
  ...extra,
});

describe('link do Meet', () => {
  it('usa o hangoutLink quando existe', () => {
    expect(linkDoMeet(evento())).toBe('https://meet.google.com/abc-defg-hij');
  });

  it('cai no ponto de entrada de video quando nao ha hangoutLink', () => {
    // conferencia criada pela API nem sempre preenche o hangoutLink
    const ev = evento({
      hangoutLink: undefined,
      conferenceData: { entryPoints: [
        { entryPointType: 'phone', uri: 'tel:+551139999999' },
        { entryPointType: 'video', uri: 'https://meet.google.com/xyz-1234-abc' },
      ] },
    });
    expect(linkDoMeet(ev)).toBe('https://meet.google.com/xyz-1234-abc');
  });

  it('devolve null quando nao ha conferencia', () => {
    expect(linkDoMeet({ id: 'x' })).toBe(null);
    expect(linkDoMeet(null)).toBe(null);
  });
});

describe('classificacao do atendimento', () => {
  it('aceita evento com convidado externo e Meet', () => {
    const r = classifyEvent(evento(), 'beatriz@advocaciacbc.com');
    expect(r.event_id).toBe('evt1');
    expect(r.cliente_email).toBe('cliente@exemplo.com');   // sempre minusculo
    expect(r.status).toBe('agendada');
    expect(r.raw.meetLink).toBe('https://meet.google.com/abc-defg-hij');
  });

  it('recusa evento sem convidado externo', () => {
    // reuniao interna nao e atendimento de venda
    const ev = evento({ attendees: [{ email: 'beatriz@advocaciacbc.com' }] });
    expect(classifyEvent(ev, 'beatriz@advocaciacbc.com')).toBe(null);
  });

  it('recusa evento sem Meet', () => {
    expect(classifyEvent(evento({ hangoutLink: undefined }), 'x@y.com')).toBe(null);
  });

  it('recusa evento cancelado', () => {
    expect(classifyEvent(evento({ status: 'cancelled' }), 'x@y.com')).toBe(null);
  });

  it('ignora sala de reuniao, que e recurso e nao pessoa', () => {
    const ev = evento({ attendees: [
      { email: 'beatriz@advocaciacbc.com' },
      { email: 'sala@resource.calendar.google.com', resource: true },
    ] });
    expect(classifyEvent(ev, 'beatriz@advocaciacbc.com')).toBe(null);
  });

  it('traduz a cor do evento em desfecho', () => {
    expect(classifyEvent(evento({ colorId: '10' }), 'x@y.com').status).toBe('realizada');
    expect(classifyEvent(evento({ colorId: '11' }), 'x@y.com').status).toBe('no_show');
    expect(classifyEvent(evento({ colorId: '7' }), 'x@y.com').status).toBe('fechou');
  });
});

describe('agendas monitoradas', () => {
  it('sao as quatro vendedoras atuais', () => {
    // 12/08/2026: entrou anacristina@ (Ana Piva), saiu mizael@
    expect(VENDEDORAS).toHaveLength(4);
    expect(VENDEDORAS).toContain('anacristina@advocaciacbc.com');
    expect(VENDEDORAS).not.toContain('mizael@advocaciacbc.com');
  });
});
