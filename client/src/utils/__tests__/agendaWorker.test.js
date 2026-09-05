// Testes das partes PURAS do worker da Ana (agenda-bot-worker-background.mjs).
// A orquestracao (I/O: Kommo, Calendar, Supabase, LLM/STT) fica sem unit test —
// validada no piloto (Task 15). Aqui: parse do payload, allowlist de host do anexo
// e a decisao do teto de bytes do audio.
import { describe, it, expect } from 'vitest';
import { parsePayload, anexoPermitido, tetoBytes, excedeTeto, gatilhoAtende, ETAPAS_TERMINAIS, ehEventoHumano, chaveDedupeFallback, ultimaMsgDoEscritorio, temMeetNoHistorico, filtrarMsgAtual, tipoAnexoImagem } from '../../../netlify/functions/agenda-bot-worker-background.mjs';

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

// (pós-review Opus #3) gatilho passa a excluir etapas terminais (ganho/perdido) quando
// status_ids:'todas'; listas explícitas continuam literais.
describe('gatilhoAtende (gatilho x etapas terminais)', () => {
  const lead = (status_id, pipeline_id = 1) => ({ status_id, pipeline_id });

  it("ETAPAS_TERMINAIS exporta [142, 143] (ganho/perdido)", () => {
    expect(ETAPAS_TERMINAIS).toEqual([142, 143]);
  });

  it("status_ids:'todas' bate fora das etapas terminais", () => {
    expect(gatilhoAtende({ pipeline_id: 1, status_ids: 'todas' }, lead(10))).toBe(true);
  });

  it("status_ids:'todas' NÃO bate em etapa terminal (ganho=142)", () => {
    expect(gatilhoAtende({ pipeline_id: 1, status_ids: 'todas' }, lead(142))).toBe(false);
  });

  it("status_ids:'todas' NÃO bate em etapa terminal (perdido=143)", () => {
    expect(gatilhoAtende({ pipeline_id: 1, status_ids: 'todas' }, lead(143))).toBe(false);
  });

  it('lista explícita de status_ids continua literal — bate mesmo numa etapa terminal', () => {
    expect(gatilhoAtende({ pipeline_id: 1, status_ids: [142] }, lead(142))).toBe(true);
  });

  it('lista explícita sem o status do lead => não bate', () => {
    expect(gatilhoAtende({ pipeline_id: 1, status_ids: [10, 20] }, lead(30))).toBe(false);
  });

  it('pipeline diferente nunca bate, mesmo com "todas"', () => {
    expect(gatilhoAtende({ pipeline_id: 1, status_ids: 'todas' }, lead(10, 2))).toBe(false);
  });
});

// (pós-review Opus #2) auto-pausa cruzando eventos outgoing do Kommo com bot_messages
// 'out' da própria conversa — substitui a margem cega de 90s por uma correspondência real.
describe('ehEventoHumano (auto-pausa x bot_messages)', () => {
  it('evento casado por proximidade de tempo (Δt<=tolMs) conta como da Ana mesmo com texto diferente', () => {
    const eventoMs = 1753000100 * 1000;
    const eventos = [{ created_at: 1753000100, text: 'texto do evento (desconhecido no piloto)' }];
    const mensagensAnaOut = [{ created_at: new Date(eventoMs + 5000).toISOString(), text: 'oi, tudo bem?' }]; // Δt=5s
    expect(ehEventoHumano(eventos, mensagensAnaOut)).toBe(false);
  });

  it('evento casado por texto idêntico (trim) mesmo com Δt bem fora da tolerância', () => {
    const eventos = [{ created_at: 1753000000, text: '  Oi, tudo bem?  ' }];
    const mensagensAnaOut = [{ created_at: new Date((1753000000 + 999999) * 1000).toISOString(), text: 'Oi, tudo bem?' }];
    expect(ehEventoHumano(eventos, mensagensAnaOut)).toBe(false);
  });

  it('evento sem correspondência de tempo nem texto => humano (pausa)', () => {
    const eventos = [{ created_at: 1753000000, text: 'mensagem manual do atendente' }];
    const mensagensAnaOut = [{ created_at: new Date(1753000000 * 1000 + 999999000).toISOString(), text: 'oferta de horários da Ana' }];
    expect(ehEventoHumano(eventos, mensagensAnaOut)).toBe(true);
  });

  it('lista vazia de mensagens da Ana => qualquer evento outgoing é humano', () => {
    const eventos = [{ created_at: 1753000000, text: 'qualquer coisa' }];
    expect(ehEventoHumano(eventos, [])).toBe(true);
  });

  it('Δt exatamente no limite (120000ms) ainda conta como da Ana (<=, não <)', () => {
    const eventoMs = 1753000000 * 1000;
    const eventos = [{ created_at: 1753000000, text: 'x' }];
    const mensagensAnaOut = [{ created_at: new Date(eventoMs + 120000).toISOString(), text: 'y' }];
    expect(ehEventoHumano(eventos, mensagensAnaOut)).toBe(false);
  });

  it('sem eventos outgoing => nunca é humano (nada a avaliar)', () => {
    expect(ehEventoHumano([], [{ created_at: new Date().toISOString(), text: 'oi' }])).toBe(false);
  });

  it('tolMs customizado (mais estrito) rejeita Δt que passaria no default', () => {
    const eventoMs = 1753000000 * 1000;
    const eventos = [{ created_at: 1753000000, text: 'x' }];
    const mensagensAnaOut = [{ created_at: new Date(eventoMs + 60000).toISOString(), text: 'y' }]; // Δt=60s
    expect(ehEventoHumano(eventos, mensagensAnaOut, 120000)).toBe(false);
    expect(ehEventoHumano(eventos, mensagensAnaOut, 30000)).toBe(true);
  });
});

// (pós-review Opus #5) chave composta p/ dedupe quando o Kommo não manda msgId — nunca
// fica sem dedupe.
describe('chaveDedupeFallback (dedupe sem msgId)', () => {
  it('formato: agenda:c:<contactId>:<minuto>:<hash>', () => {
    const agora = Date.parse('2026-07-21T10:00:05Z');
    expect(chaveDedupeFallback('123', 'oi tudo bem', agora)).toMatch(/^agenda:c:123:\d+:[0-9a-f]+$/);
  });

  it('mesmo contactId+texto+minuto => mesma chave (determinístico)', () => {
    const agora = Date.parse('2026-07-21T10:00:05Z');
    expect(chaveDedupeFallback('1', 'abc', agora)).toBe(chaveDedupeFallback('1', 'abc', agora));
  });

  it('textos diferentes => chaves diferentes', () => {
    const agora = Date.parse('2026-07-21T10:00:05Z');
    expect(chaveDedupeFallback('1', 'abc', agora)).not.toBe(chaveDedupeFallback('1', 'xyz', agora));
  });

  it('minutos diferentes => chaves diferentes (mesmo contactId/texto)', () => {
    const t1 = Date.parse('2026-07-21T10:00:05Z');
    const t2 = Date.parse('2026-07-21T10:01:05Z');
    expect(chaveDedupeFallback('1', 'abc', t1)).not.toBe(chaveDedupeFallback('1', 'abc', t2));
  });

  it('trunca o texto em 80 chars — diferença só depois disso gera a MESMA chave', () => {
    const agora = Date.parse('2026-07-21T10:00:05Z');
    const base = 'x'.repeat(80);
    expect(chaveDedupeFallback('1', base + 'AAAA', agora)).toBe(chaveDedupeFallback('1', base + 'BBBB', agora));
  });

  it('texto vazio/nulo não lança — ainda produz chave estável', () => {
    const agora = Date.parse('2026-07-21T10:00:05Z');
    expect(() => chaveDedupeFallback('1', '', agora)).not.toThrow();
    expect(() => chaveDedupeFallback('1', null, agora)).not.toThrow();
    expect(chaveDedupeFallback('1', '', agora)).toBe(chaveDedupeFallback('1', null, agora));
  });
});

// ===================== SDR de IA (Task 10) =====================
// Helpers puros do worker no modo agente: historico do espelho (ultima fala do
// escritorio, Meet ja enviado, deduplicacao da mensagem atual) e tipo da imagem.
describe('helpers do historico (SDR de IA)', () => {
  const h = [
    { autor: 'atendente', autor_nome: 'Salesbot', corpo: 'Combinado, vou reservar o seu horário', enviada_em: '2026-09-05T20:00:00Z' },
    { autor: 'cliente', autor_nome: 'X', corpo: 'De manhã', enviada_em: '2026-09-05T20:01:00Z' },
  ];

  it('ultimaMsgDoEscritorio pega a ultima do atendente', () => {
    expect(ultimaMsgDoEscritorio(h)).toMatch(/vou reservar/);
    expect(ultimaMsgDoEscritorio([])).toBeNull();
    expect(ultimaMsgDoEscritorio(null)).toBeNull();
  });

  it('ultimaMsgDoEscritorio ignora as do cliente mesmo sendo as ultimas', () => {
    const so = [{ autor: 'cliente', corpo: 'oi' }];
    expect(ultimaMsgDoEscritorio(so)).toBeNull();
  });

  it('temMeetNoHistorico detecta link enviado pelo escritorio', () => {
    expect(temMeetNoHistorico(h)).toBe(false);
    expect(temMeetNoHistorico([...h, { autor: 'atendente', corpo: 'Link: https://meet.google.com/abc-defg-hij' }])).toBe(true);
  });

  it('temMeetNoHistorico ignora link colado pelo proprio lead', () => {
    expect(temMeetNoHistorico([{ autor: 'cliente', corpo: 'https://meet.google.com/abc-defg-hij' }])).toBe(false);
    expect(temMeetNoHistorico(null)).toBe(false);
  });

  it('filtrarMsgAtual remove a propria mensagem se o espelho ja a tiver', () => {
    expect(filtrarMsgAtual(h, 'De manhã', new Date('2026-09-05T20:02:00Z'))).toHaveLength(1);
    expect(filtrarMsgAtual(h, 'Outra coisa', new Date('2026-09-05T20:02:00Z'))).toHaveLength(2);
  });

  it('filtrarMsgAtual so remove dentro da janela de 10 min', () => {
    expect(filtrarMsgAtual(h, 'De manhã', new Date('2026-09-05T20:30:00Z'))).toHaveLength(2);
  });

  it('filtrarMsgAtual nunca remove fala do atendente com o mesmo texto', () => {
    const eco = [{ autor: 'atendente', corpo: 'De manhã', enviada_em: '2026-09-05T20:01:00Z' }];
    expect(filtrarMsgAtual(eco, 'De manhã', new Date('2026-09-05T20:02:00Z'))).toHaveLength(1);
  });

  it('filtrarMsgAtual tolera historico vazio/nulo', () => {
    expect(filtrarMsgAtual(null, 'x', new Date())).toEqual([]);
    expect(filtrarMsgAtual([], 'x', new Date())).toEqual([]);
  });

  // (fix Task 10) mensagem so-imagem/audio chega com texto vazio (STT falhou ou e so
  // anexo) — nao pode casar por corpo vazio e apagar uma entrada real do espelho.
  it('filtrarMsgAtual com texto vazio devolve o historico intacto (nao casa por corpo vazio)', () => {
    const comImagem = [...h, { autor: 'cliente', autor_nome: 'X', corpo: '', enviada_em: '2026-09-05T20:02:00Z' }];
    expect(filtrarMsgAtual(comImagem, '', new Date('2026-09-05T20:02:30Z'))).toEqual(comImagem);
    expect(filtrarMsgAtual(comImagem, '   ', new Date('2026-09-05T20:02:30Z'))).toEqual(comImagem);
    expect(filtrarMsgAtual(comImagem, null, new Date('2026-09-05T20:02:30Z'))).toEqual(comImagem);
  });

  it('tipoAnexoImagem por tipo ou extensao', () => {
    expect(tipoAnexoImagem('picture', 'https://x.kommo.com/a.bin')).toBe('image/jpeg');
    expect(tipoAnexoImagem('file', 'https://x.kommo.com/a.png')).toBe('image/png');
    expect(tipoAnexoImagem('file', 'https://x.kommo.com/a.pdf')).toBeNull();
  });

  it('tipoAnexoImagem aceita extensao com querystring e maiuscula', () => {
    expect(tipoAnexoImagem('file', 'https://x.kommo.com/a.WEBP?sig=1')).toBe('image/webp');
    expect(tipoAnexoImagem('file', 'https://x.kommo.com/a.JPG')).toBe('image/jpeg');
    expect(tipoAnexoImagem('file', 'https://x.kommo.com/a.jpeg?x=1')).toBe('image/jpeg');
  });

  it('tipoAnexoImagem: audio/nulo nunca vira imagem', () => {
    expect(tipoAnexoImagem('voice', 'https://x.kommo.com/a.ogg')).toBeNull();
    expect(tipoAnexoImagem(null, null)).toBeNull();
  });
});

// (Task 10) A config da Ana IA traz gatilhos SEM status_ids: valem para qualquer etapa
// nao terminal do pipeline (as etapas de encerramento quem decide e situacaoDoLead).
describe('gatilhoAtende sem status_ids (config do SDR de IA)', () => {
  const lead = (status_id, pipeline_id = 1) => ({ status_id, pipeline_id });

  it('gatilho so com pipeline_id bate em etapa nao terminal', () => {
    expect(gatilhoAtende({ pipeline_id: 1 }, lead(10))).toBe(true);
  });

  it('gatilho so com pipeline_id NAO bate em etapa terminal', () => {
    expect(gatilhoAtende({ pipeline_id: 1 }, lead(142))).toBe(false);
    expect(gatilhoAtende({ pipeline_id: 1 }, lead(143))).toBe(false);
  });

  it('gatilho so com pipeline_id nao bate em outro pipeline', () => {
    expect(gatilhoAtende({ pipeline_id: 1, desde_inicio: true }, lead(10, 2))).toBe(false);
  });
});
