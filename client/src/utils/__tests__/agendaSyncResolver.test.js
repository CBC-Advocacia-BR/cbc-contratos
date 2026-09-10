import { describe, it, expect } from 'vitest';
import { resolverAgendas } from '../../../netlify/functions/agenda-videochamadas-sync.mjs';

// CRITICAL sweep×férias: `ativa` governa SLOTS (quem recebe novo agendamento), NÃO o espelho.
// resolverAgendas NUNCA filtra por `ativa` — encolher aqui o universo consultado faria o
// agenda_videochamadas_sweep marcar como excluída toda a agenda de uma vendedora que ficou de
// fora só por estar inativa/de férias (ela continua com compromissos reais no Calendar).
const FALLBACK = ['fallback1@advocaciacbc.com', 'fallback2@advocaciacbc.com'];

describe('resolverAgendas', () => {
  it('config ok: retorna TODAS as vendedoras com email válido, incluindo as inativas', () => {
    const cfgAll = { agenda_bot: { vendedoras: [
      { email: 'a@advocaciacbc.com', ativa: true },
      { email: 'b@advocaciacbc.com', ativa: false },
      { email: 'c@advocaciacbc.com', ativa: true },
    ] } };
    expect(resolverAgendas(cfgAll, FALLBACK)).toEqual({ agendas: ['a@advocaciacbc.com', 'b@advocaciacbc.com', 'c@advocaciacbc.com'] });
  });

  it('vendedoras vazia ([]): cai no fallback', () => {
    const cfgAll = { agenda_bot: { vendedoras: [] } };
    expect(resolverAgendas(cfgAll, FALLBACK)).toEqual({ agendas: FALLBACK });
  });

  it('agenda_bot ausente: cai no fallback', () => {
    expect(resolverAgendas({}, FALLBACK)).toEqual({ agendas: FALLBACK });
  });

  it('vendedoras ausente dentro de agenda_bot (undefined): cai no fallback', () => {
    expect(resolverAgendas({ agenda_bot: {} }, FALLBACK)).toEqual({ agendas: FALLBACK });
  });

  it('vendedoras é um objeto, não array (config malformada): ignora e cai no fallback', () => {
    const cfgAll = { agenda_bot: { vendedoras: { email: 'x@advocaciacbc.com' } } };
    expect(resolverAgendas(cfgAll, FALLBACK)).toEqual({ agendas: FALLBACK });
  });

  it('vendedoras é uma string (config malformada): ignora e cai no fallback', () => {
    const cfgAll = { agenda_bot: { vendedoras: 'oops' } };
    expect(resolverAgendas(cfgAll, FALLBACK)).toEqual({ agendas: FALLBACK });
  });

  it('itens null/sem email válido dentro do array: ignora só os inválidos, mantém os válidos', () => {
    const cfgAll = { agenda_bot: { vendedoras: [
      null,
      { email: 'valida@advocaciacbc.com', ativa: true },
      { nome: 'sem campo email' },
      { email: 123 },
      { email: 'sememarroba' },
      undefined,
    ] } };
    expect(resolverAgendas(cfgAll, FALLBACK)).toEqual({ agendas: ['valida@advocaciacbc.com'] });
  });

  it('cfgAll totalmente ausente (null/undefined): robusto, cai no fallback', () => {
    expect(resolverAgendas(null, FALLBACK)).toEqual({ agendas: FALLBACK });
    expect(resolverAgendas(undefined, FALLBACK)).toEqual({ agendas: FALLBACK });
  });
});
