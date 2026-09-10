// (10/09/2026) Worker do lembrete de assinatura com banco e ZapSign simulados.
// Garante que o 429 `cooldown_period` sai do caminho de falha SEM mexer no que ja
// protegia a operacao: kill-switch, teto por rodada, intervalo e ?simular=1.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const estado = vi.hoisted(() => {
  process.env.ZAPSIGN_TOKEN = 'tok';
  process.env.BOT_PANEL_KEY = 'chave';
  return { cfg: null, contratos: [], updates: [], logs: [], beats: [] };
});

vi.mock('../botDb.mjs', () => {
  const consulta = () => {
    const q = {
      select: () => q, not: () => q, is: () => q, order: () => q,
      eq: (_k, v) => { if (q.upd) q.id = v; return q; },
      update: (obj) => { q.upd = obj; return q; },
      maybeSingle: async () => ({ data: estado.cfg ? { value: estado.cfg } : null }),
      then: (ok, erro) => {
        if (q.upd) { estado.updates.push({ id: q.id, ...q.upd }); return Promise.resolve({ error: null }).then(ok, erro); }
        return Promise.resolve({ data: estado.contratos, error: null }).then(ok, erro);
      },
    };
    return q;
  };
  return {
    db: { from: consulta },
    heartbeat: async (job, ok, detail) => { estado.beats.push({ job, ok, detail }); },
    logAdvbox: async (origem, nivel, msg, ctx) => { estado.logs.push({ origem, nivel, msg, ctx }); },
  };
});

import worker from '../../zapsign-lembrete-worker.mjs';

const COOLDOWN = '{"success": false, "error_code": "cooldown_period", "message": "Aguarde o per\\u00edodo ' +
  'de cooldown para reenviar as notifica\\u00e7\\u00f5es em massa. Tempo restante: 3h"}';
const RESPOSTAS = {
  docOk: [200, '{"success": true}'],
  docCooldown: [429, COOLDOWN],
  docFechado: [400, '{"success": false, "error_code": "document_not_in_progress"}'],
};

const tresDiasAtras = new Date(Date.now() - 3 * 86400000).toISOString();
const contrato = (id, token, extra = {}) => ({
  id, nome_contratante1: id, zapsign_doc_token: token, zapsign_sent_at: tresDiasAtras,
  created_at: tresDiasAtras, advbox_data: {}, ...extra,
});

const chamar = (qs = '') => worker({
  url: `https://x/.netlify/functions/zapsign-lembrete-worker${qs}`,
  headers: { get: (k) => ({ 'x-bot-key': 'chave' })[k.toLowerCase()] ?? null },
});

let fetchMock;
beforeEach(() => {
  Object.assign(estado, { cfg: null, contratos: [], updates: [], logs: [], beats: [] });
  fetchMock = vi.fn(async (url) => {
    const token = Object.keys(RESPOSTAS).find((t) => url.includes(`/docs/${t}/`));
    const [status, corpo] = RESPOSTAS[token];
    return { status, ok: status < 300, text: async () => corpo };
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('zapsign-lembrete-worker', () => {
  it('cooldown nao e falha; falha real continua falha', async () => {
    estado.contratos = [contrato('A', 'docOk'), contrato('B', 'docCooldown'), contrato('C', 'docFechado')];
    const corpo = await (await chamar()).json();

    expect(corpo).toMatchObject({ ok: true, enviados: 1, em_cooldown: 1, elegiveis: 3 });
    expect(corpo.falhas).toHaveLength(1);
    expect(corpo.falhas[0]).toMatchObject({ id: 'C' });
    // so quem recebeu de fato ganha ultimo_em
    expect(estado.updates.map((u) => u.id)).toEqual(['A']);
    const log = estado.logs.at(-1);
    expect(log.nivel).toBe('aviso');
    expect(log.msg).toBe('lembrete de assinatura: 1 enviados, 1 em cooldown do ZapSign, 1 falhas (3 elegiveis de 3 pendentes)');
    expect(log.ctx.em_cooldown[0]).toEqual({ id: 'B', mensagem: expect.stringContaining('Tempo restante: 3h') });
    expect(estado.beats.at(-1).ok).toBe(false);
  });

  it('rodada so com cooldown deixa o heartbeat verde e o log como info', async () => {
    estado.contratos = [contrato('A', 'docOk'), contrato('B', 'docCooldown')];
    await chamar();
    expect(estado.logs.at(-1).nivel).toBe('info');
    expect(estado.beats.at(-1).ok).toBe(true);
  });

  it('kill-switch: ativo=false nao chama o ZapSign', async () => {
    estado.cfg = { ativo: false };
    estado.contratos = [contrato('A', 'docOk')];
    const corpo = await (await chamar()).json();
    expect(corpo).toEqual({ ok: true, desligado: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('?simular=1 lista sem enviar, mesmo desligado', async () => {
    estado.cfg = { ativo: false };
    estado.contratos = [contrato('A', 'docOk'), contrato('B', 'docCooldown')];
    const corpo = await (await chamar('?simular=1')).json();
    expect(corpo).toMatchObject({ simulacao: true, elegiveis: 2 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(estado.updates).toEqual([]);
  });

  it('teto por rodada (max_por_dia) continua limitando', async () => {
    estado.cfg = { max_por_dia: 2 };
    estado.contratos = [contrato('A', 'docOk'), contrato('B', 'docOk'), contrato('C', 'docOk')];
    await chamar();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('intervalo_horas continua pulando quem foi lembrado ha pouco', async () => {
    const umaHora = new Date(Date.now() - 3600000).toISOString();
    estado.contratos = [
      contrato('A', 'docOk'),
      contrato('B', 'docOk', { advbox_data: { zapsign_lembrete: { ultimo_em: umaHora, total: 3 } } }),
    ];
    const corpo = await (await chamar()).json();
    expect(corpo.elegiveis).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
