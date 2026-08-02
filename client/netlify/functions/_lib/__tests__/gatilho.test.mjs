// (auditoria 01/08/2026 — itens 9/15) Testes da trava de disparo dos robos agendados.
// Antes desta lib, `req.method === 'GET'` era tratado como "veio do agendador": bastava
// abrir a URL da function no navegador para disparar sincronizacoes pesadas (inclusive
// backfills que queimam cota paga de API de terceiros).
import { describe, it, expect, afterEach } from 'vitest';
import { verificarGatilho, respostaNegada } from '../gatilho.mjs';

afterEach(() => { delete process.env.BOT_PANEL_KEY; });

const req = ({ headers = {}, url = 'https://x/.netlify/functions/robo', method = 'GET' } = {}) => ({
  url, method,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
});

describe('agendador da Netlify', () => {
  it('aceita quando vem o cabecalho x-netlify-event: schedule', () => {
    const v = verificarGatilho(req({ headers: { 'x-netlify-event': 'schedule' } }));
    expect(v).toEqual({ ok: true, origem: 'cron' });
  });

  it('nao depende da BOT_PANEL_KEY (o cron roda mesmo sem env de painel)', () => {
    const v = verificarGatilho(req({ headers: { 'x-netlify-event': 'schedule' } }));
    expect(v.ok).toBe(true);
  });
});

describe('GET solto NAO dispara mais o robo (o defeito do item 9)', () => {
  it('GET sem chave e recusado', () => {
    process.env.BOT_PANEL_KEY = 'chave-forte';
    const v = verificarGatilho(req({ method: 'GET' }));
    expect(v.ok).toBe(false);
    expect(v.status).toBe(401);
  });

  it('POST sem chave tambem e recusado', () => {
    process.env.BOT_PANEL_KEY = 'chave-forte';
    expect(verificarGatilho(req({ method: 'POST' })).ok).toBe(false);
  });

  it('outro valor em x-netlify-event nao vale como cron', () => {
    process.env.BOT_PANEL_KEY = 'chave-forte';
    const v = verificarGatilho(req({ headers: { 'x-netlify-event': 'deploy' } }));
    expect(v.ok).toBe(false);
  });
});

describe('disparo manual', () => {
  it('aceita a chave no cabecalho x-bot-key', () => {
    process.env.BOT_PANEL_KEY = 'chave-forte';
    const v = verificarGatilho(req({ headers: { 'x-bot-key': 'chave-forte' } }));
    expect(v).toMatchObject({ ok: true, origem: 'manual' });
    expect(v.avisoChaveNaUrl).toBeUndefined();
  });

  it('recusa chave errada no cabecalho', () => {
    process.env.BOT_PANEL_KEY = 'chave-forte';
    expect(verificarGatilho(req({ headers: { 'x-bot-key': 'errada' } })).ok).toBe(false);
  });

  it('aceita ?key= (modo legado) e SINALIZA para migrar', () => {
    process.env.BOT_PANEL_KEY = 'chave-forte';
    const v = verificarGatilho(req({ url: 'https://x/f?key=chave-forte' }));
    expect(v).toMatchObject({ ok: true, origem: 'manual', avisoChaveNaUrl: true });
  });

  it('quando aceitarChaveNaUrl=false, a URL deixa de valer', () => {
    process.env.BOT_PANEL_KEY = 'chave-forte';
    const v = verificarGatilho(req({ url: 'https://x/f?key=chave-forte' }), { aceitarChaveNaUrl: false });
    expect(v.ok).toBe(false);
  });
});

describe('BOT_PANEL_KEY ausente DESATIVA o disparo manual', () => {
  it('responde 503 explicando, em vez de aceitar qualquer um', () => {
    const v = verificarGatilho(req({ headers: { 'x-bot-key': 'qualquer' } }));
    expect(v.ok).toBe(false);
    expect(v.status).toBe(503);
    expect(v.erro).toMatch(/nao configurada/i);
  });
});

describe('respostaNegada', () => {
  it('devolve o status do veredito e nunca cacheia', async () => {
    const r = respostaNegada({ status: 401, erro: 'nao autorizado' });
    expect(r.status).toBe(401);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(await r.json()).toEqual({ ok: false, error: 'nao autorizado' });
  });
});

// (correcao 02/08/2026, MEDIDA em producao) A premissa do item 9 estava errada: a Netlify
// responde 403 a qualquer requisicao HTTP externa feita a function AGENDADA — o bloqueio e
// na borda, antes do codigo. Testado nas 7 functions do item. Logo, para function agendada
// a trava daqui nao protegia de nada e QUEBROU o botao "Run now" do painel (unico jeito de
// disparar um cron a mao), que nao manda `x-netlify-event: schedule`.
describe('verificarGatilho — function AGENDADA (opcao `agendada: true`)', () => {
  const req = (headers = {}, url = 'https://x/.netlify/functions/f') => ({
    url, method: 'POST', headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  });

  it('scheduler da Netlify continua sendo reconhecido como cron', () => {
    const r = verificarGatilho(req({ 'x-netlify-event': 'schedule' }), { agendada: true });
    expect(r).toMatchObject({ ok: true, origem: 'cron' });
  });

  it('botao "Run now" (sem cabecalho, sem chave) PASSA e e marcado como manual', () => {
    const r = verificarGatilho(req({}), { agendada: true });
    expect(r.ok).toBe(true);
    expect(r.origem).toBe('manual');
  });

  it('sem a opcao, o mesmo pedido e RECUSADO — o estrito segue valendo p/ nao agendada', () => {
    const r = verificarGatilho(req({}));
    expect(r.ok).toBe(false);
  });
});
