// Erros TERMINAIS da fila do Kommo (02/08/2026).
// Contexto: 289 jobs presos em 'failed' em 30 dias, 271 deles com erro 226 do Kommo,
// concentrados em 37 leads. Investigacao provou (probe em producao no lead 999999999,
// que nunca existiu) que **erro 226 no POST /leads/{id}/notes significa "o lead nao
// existe"** — e o equivalente, no endpoint de notas, do "Lead not found" que o PATCH
// devolve. Nao e emoji (texto ASCII puro falha igual) nem duplicidade (marcador inedito
// falha igual). Lead que nao existe nunca volta a existir: retentar 6x e desperdicio
// (~1.600 chamadas inuteis a API). Ver _lib/kommoTerminal.mjs.
import { describe, it, expect } from 'vitest';
import { ehErroTerminal, leadIdAlvo } from '../../../netlify/functions/_lib/kommoTerminal.mjs';

// Erros REAIS colhidos da tabela kommo_queue em 02/08/2026.
const ERRO_226 = 'kommo-note: POST note HTTP 400 {"errors":[{"code":226,"message":"Error 226.","source":{"last_modified":1785664566,"element_id":18220764,"element_type":2,"note_type":4,"text":"⚖️ Nov';
const ERRO_NOT_FOUND = 'Kommo PATCH lead 6947534 HTTP 400 {"errors":{"6947534":"Lead not found"},"title":"Bad Request","type":"https://httpstatus.es/400","status":400,"detail":"I';

describe('ehErroTerminal — reconhece o que nunca vai passar', () => {
  it('erro 226 do Kommo e terminal (lead inexistente)', () => {
    const r = ehErroTerminal(ERRO_226);
    expect(r.terminal).toBe(true);
    expect(r.motivo).toBe('lead_inexistente');
  });

  it('"Lead not found" no PATCH e terminal', () => {
    const r = ehErroTerminal(ERRO_NOT_FOUND);
    expect(r.terminal).toBe(true);
    expect(r.motivo).toBe('lead_inexistente');
  });

  it('erro transitorio NAO e terminal — tem de continuar retentando', () => {
    for (const msg of [
      'Kommo GET /leads/123 HTTP 429',
      'Kommo POST tasks HTTP 500',
      'preso em processing por mais de 5 min (worker morreu no meio)',
      'kommo-note: checagem de duplicidade indisponivel — nao postado p/ evitar duplicata',
      'fetch failed',
      'The operation was aborted due to timeout',
    ]) {
      expect(ehErroTerminal(msg).terminal, msg).toBe(false);
    }
  });

  it('nao confunde 226 com codigo que apenas CONTEM 226', () => {
    // "2260" e "1226" nao podem disparar o caminho terminal
    expect(ehErroTerminal('HTTP 400 {"errors":[{"code":2260,"message":"x"}]}').terminal).toBe(false);
    expect(ehErroTerminal('HTTP 400 {"errors":[{"code":1226,"message":"x"}]}').terminal).toBe(false);
    // ...mas o id do lead ser 226 no meio do texto tambem nao pode disparar
    expect(ehErroTerminal('Kommo PATCH lead 226 HTTP 429').terminal).toBe(false);
  });

  it('tolera entrada vazia / nao-string sem quebrar', () => {
    for (const v of [null, undefined, '', 0, {}, []]) {
      expect(ehErroTerminal(v).terminal, String(v)).toBe(false);
    }
  });

  it('aceita variacoes de espacamento no JSON do Kommo', () => {
    expect(ehErroTerminal('{"code" : 226 }').terminal).toBe(true);
    expect(ehErroTerminal('{"errors":{"999":"lead not found"}}').terminal).toBe(true); // minusculo
  });
});

describe('leadIdAlvo — de qual lead o job depende', () => {
  it('extrai o lead das operacoes que escrevem no lead', () => {
    expect(leadIdAlvo('note', { leadId: '18219824', marker: 'x' })).toBe('18219824');
    expect(leadIdAlvo('lead_field', { leadId: 123, fieldId: 9 })).toBe('123');
    expect(leadIdAlvo('lead_move', { leadId: '456' })).toBe('456');
    expect(leadIdAlvo('cobranca_send', { leadId: '789', botId: 1 })).toBe('789');
    expect(leadIdAlvo('assinatura_send', { leadId: '790', botId: 1 })).toBe('790');
  });

  it('salesbot e task contam so quando a entidade e um LEAD', () => {
    expect(leadIdAlvo('salesbot', { entityId: '55', entityType: 'leads' })).toBe('55');
    expect(leadIdAlvo('salesbot', { entityId: '55' })).toBe('55'); // default do kommo.mjs e 'leads'
    expect(leadIdAlvo('task', { entityId: '66', entityType: 'leads' })).toBe('66');
    expect(leadIdAlvo('task', { entityId: '66', entityType: 'contacts' })).toBeNull();
  });

  it('operacao de CONTATO nao herda a morte do lead', () => {
    // contato e outra entidade: lead apagado nao implica contato apagado
    expect(leadIdAlvo('contact_field', { contactId: '99', fieldId: 1 })).toBeNull();
  });

  it('payload sem lead / kind desconhecido retorna null', () => {
    expect(leadIdAlvo('note', {})).toBeNull();
    expect(leadIdAlvo('kind_novo_qualquer', { leadId: '1' })).toBeNull();
    expect(leadIdAlvo('note', null)).toBeNull();
    expect(leadIdAlvo(null, null)).toBeNull();
  });
});
