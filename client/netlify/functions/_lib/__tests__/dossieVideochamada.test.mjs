import { describe, it, expect } from 'vitest';
import { elegivel, quandoPorExtenso } from '../dossieVideochamada.mjs';

const AGORA = new Date('2026-08-12T18:00:00Z');   // 15h BRT
const CONFIG = { ativo: true, corte_em: '2026-08-10T00:00:00Z', max_tentativas: 3 };
const LINHA = {
  event_id: 'abc', cliente_email: 'lead@exemplo.com', status: 'agendada',
  scheduled_at: '2026-08-14T18:00:00Z', primeiro_visto_em: '2026-08-12T17:00:00Z',
  dossie_email_em: null, dossie_email_tentativas: 0,
};

describe('elegibilidade', () => {
  it('aprova o caso normal', () => {
    expect(elegivel(LINHA, CONFIG, AGORA)).toEqual({ ok: true, motivo: null });
  });

  it('barra tudo quando o kill-switch esta desligado', () => {
    expect(elegivel(LINHA, { ...CONFIG, ativo: false }, AGORA))
      .toEqual({ ok: false, motivo: 'desligado' });
  });

  it('barra evento visto ANTES do corte', () => {
    // a trava que impede 3.036 e-mails no primeiro disparo
    const r = elegivel({ ...LINHA, primeiro_visto_em: '2026-08-01T10:00:00Z' }, CONFIG, AGORA);
    expect(r).toEqual({ ok: false, motivo: 'anterior_ao_corte' });
  });

  it('barra quando nao ha corte configurado', () => {
    // sem corte definido o padrao e NAO enviar, nunca "enviar para todos"
    expect(elegivel(LINHA, { ...CONFIG, corte_em: null }, AGORA))
      .toEqual({ ok: false, motivo: 'sem_corte' });
  });

  it('barra videochamada que ja passou', () => {
    const r = elegivel({ ...LINHA, scheduled_at: '2026-08-11T18:00:00Z' }, CONFIG, AGORA);
    expect(r).toEqual({ ok: false, motivo: 'ja_passou' });
  });

  it('barra evento cancelado, excluido ou ja realizado', () => {
    for (const status of ['excluida', 'no_show', 'realizada', 'fechou']) {
      expect(elegivel({ ...LINHA, status }, CONFIG, AGORA).motivo).toBe('status_nao_agendada');
    }
  });

  it('barra sem e-mail do cliente', () => {
    expect(elegivel({ ...LINHA, cliente_email: '' }, CONFIG, AGORA).motivo).toBe('sem_email');
    expect(elegivel({ ...LINHA, cliente_email: null }, CONFIG, AGORA).motivo).toBe('sem_email');
  });

  it('barra e-mail interno do escritorio', () => {
    // nao e para acontecer (o classifyEvent so aceita convidado externo), mas uma
    // linha de backfill antiga poderia ter escapado
    const r = elegivel({ ...LINHA, cliente_email: 'beatriz@advocaciacbc.com' }, CONFIG, AGORA);
    expect(r.motivo).toBe('email_interno');
  });

  it('nao reenvia o que ja foi enviado', () => {
    const r = elegivel({ ...LINHA, dossie_email_em: '2026-08-12T17:30:00Z' }, CONFIG, AGORA);
    expect(r).toEqual({ ok: false, motivo: 'ja_enviado' });
  });

  it('desiste depois do teto de tentativas', () => {
    expect(elegivel({ ...LINHA, dossie_email_tentativas: 3 }, CONFIG, AGORA))
      .toEqual({ ok: false, motivo: 'tentativas_esgotadas' });
  });

  it('ainda tenta na segunda falha', () => {
    expect(elegivel({ ...LINHA, dossie_email_tentativas: 2 }, CONFIG, AGORA).ok).toBe(true);
  });

  it('config ausente nao vira envio', () => {
    // se getConfig devolver vazio, o padrao seguro e nao mandar nada
    expect(elegivel(LINHA, {}, AGORA).ok).toBe(false);
    expect(elegivel(LINHA, undefined, AGORA).ok).toBe(false);
  });
});

describe('data por extenso, sempre em BRT', () => {
  it('escreve o dia da semana, a data e a hora', () => {
    const q = quandoPorExtenso('2026-08-14T18:00:00Z');   // 15h BRT
    expect(q.diaSemana).toBe('sexta-feira');
    expect(q.dataExtenso).toBe('14 de agosto');
    expect(q.dataCurta).toBe('14/08');
    expect(q.hora).toBe('15h');
    expect(q.texto).toBe('sexta-feira, 14 de agosto, às 15h');
  });

  it('mostra os minutos quando nao e hora cheia', () => {
    expect(quandoPorExtenso('2026-08-13T20:30:00Z').hora).toBe('17h30');
  });

  it('usa o dia BRT, nao o UTC', () => {
    // 14/08 as 00h30 UTC e ainda 13/08 as 21h30 no Brasil. Escrever "sexta" numa
    // chamada que o cliente tem na quinta e o erro classico deste projeto (ver a
    // auditoria de datas de 31/07/2026)
    const q = quandoPorExtenso('2026-08-14T00:30:00Z');
    expect(q.diaSemana).toBe('quinta-feira');
    expect(q.dataExtenso).toBe('13 de agosto');
    expect(q.hora).toBe('21h30');
  });

  it('acerta o domingo e a segunda, que sao as bordas do vetor de dias', () => {
    expect(quandoPorExtenso('2026-08-16T15:00:00Z').diaSemana).toBe('domingo');
    expect(quandoPorExtenso('2026-08-17T15:00:00Z').diaSemana).toBe('segunda-feira');
  });

  it('acerta a virada de mes', () => {
    const q = quandoPorExtenso('2026-09-01T12:00:00Z');
    expect(q.dataExtenso).toBe('1 de setembro');
    expect(q.dataCurta).toBe('01/09');
  });
});
