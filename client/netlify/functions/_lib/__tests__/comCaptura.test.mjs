// (auditoria 01/08/2026 — item 155) Testes da rede de captura de erro das functions.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// o wrapper grava no Monitor via botDb — trocado por espiões para o teste não tocar no banco
const logAdvbox = vi.fn(async () => {});
const heartbeat = vi.fn(async () => {});
vi.mock('../botDb.mjs', () => ({ logAdvbox: (...a) => logAdvbox(...a), heartbeat: (...a) => heartbeat(...a) }));

const { comCaptura } = await import('../comCaptura.mjs');

const req = (metodo = 'POST', url = 'https://x/.netlify/functions/robo?t=1') => ({ method: metodo, url });

beforeEach(() => { logAdvbox.mockClear(); heartbeat.mockClear(); });

describe('caminho feliz', () => {
  it('devolve a resposta do handler sem interferir', async () => {
    const fn = comCaptura('teste', async () => new Response('ok', { status: 201 }));
    const r = await fn(req());
    expect(r.status).toBe(201);
    expect(await r.text()).toBe('ok');
    expect(logAdvbox).not.toHaveBeenCalled();
  });
});

describe('quando o handler lanca', () => {
  it('responde 500 generico — sem vazar a mensagem tecnica', async () => {
    const fn = comCaptura('teste', async () => { throw new Error('relation "contratos" does not exist'); });
    const r = await fn(req());
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body).toEqual({ ok: false, error: 'erro interno' });
    // o nome da tabela NUNCA pode chegar a quem chamou (item 42)
    expect(JSON.stringify(body)).not.toContain('contratos');
  });

  it('registra no Monitor com nome, metodo e caminho', async () => {
    const fn = comCaptura('minha-fn', async () => { throw new Error('deu ruim'); });
    await fn(req('GET', 'https://x/.netlify/functions/minha-fn?a=1'));
    expect(logAdvbox).toHaveBeenCalledTimes(1);
    const [origem, nivel, mensagem, contexto] = logAdvbox.mock.calls[0];
    expect(origem).toBe('function');
    expect(nivel).toBe('erro');
    expect(mensagem).toContain('minha-fn');
    expect(mensagem).toContain('deu ruim');
    expect(contexto).toMatchObject({ function: 'minha-fn', metodo: 'GET', caminho: '/.netlify/functions/minha-fn' });
    expect(contexto.stack).toBeTruthy();
  });

  it('nao marca heartbeat por padrao (function comum nao e cron)', async () => {
    const fn = comCaptura('teste', async () => { throw new Error('x'); });
    await fn(req());
    expect(heartbeat).not.toHaveBeenCalled();
  });

  it('marca heartbeat como falho quando pedido (functions agendadas)', async () => {
    const fn = comCaptura('meu-cron', async () => { throw new Error('x'); }, { heartbeatEmFalha: true });
    await fn(req());
    expect(heartbeat).toHaveBeenCalledWith('meu-cron', false, expect.any(String));
  });

  it('aceita origem propria (categoria no console do Monitor)', async () => {
    const fn = comCaptura('asaas-x', async () => { throw new Error('x'); }, { origem: 'asaas' });
    await fn(req());
    expect(logAdvbox.mock.calls[0][0]).toBe('asaas');
  });

  it('nao quebra se a URL for invalida', async () => {
    const fn = comCaptura('teste', async () => { throw new Error('x'); });
    const r = await fn({ method: 'POST', url: 'nao-e-url' });
    expect(r.status).toBe(500);
    expect(logAdvbox.mock.calls[0][3].caminho).toBe('?');
  });

  it('falha ao gravar o log NAO impede a resposta 500', async () => {
    logAdvbox.mockRejectedValueOnce(new Error('banco fora'));
    const fn = comCaptura('teste', async () => { throw new Error('x'); });
    const r = await fn(req());
    expect(r.status).toBe(500);
  });
});
