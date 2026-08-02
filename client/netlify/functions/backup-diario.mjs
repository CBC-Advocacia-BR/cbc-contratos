/**
 * Netlify Scheduled Function: backup diario do banco -> Google Drive.
 *
 * Cron 06:00 UTC (03h BRT — mesmo horario do backup antigo do server/,
 * aposentado em 20/06/2026; auditoria #87). So DESPACHA o
 * backup-worker-background (padrao meta-trafego-sync: functions sincronas
 * deste site estouram em ~26s — o trabalho pesado vive no worker de 15 min).
 *
 * Disparo manual: POST com { key } | header x-bot-key | GET ?key=<BOT_PANEL_KEY>.
 */

import { heartbeat, logAdvbox } from './_lib/botDb.mjs';

// (auditoria 01/08 — item 13) sem `|| 'cbc-bot-2026'`: esse valor esta publicado no
// repositorio e, faltando a variavel, qualquer pessoa dispararia o backup manualmente.
const PANEL_KEY = process.env.BOT_PANEL_KEY || '';
const SELF_URL = process.env.URL || 'https://contratos-cbc.netlify.app';
const JSONH = { 'Content-Type': 'application/json' };

export default async (req) => {
  const isScheduled = req.headers.get('x-netlify-event') === 'schedule';

  if (!isScheduled) {
    const url = new URL(req.url);
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const key = req.headers.get('x-bot-key') || body.key || url.searchParams.get('key') || '';
    // (item 13) chave ausente = disparo manual DESATIVADO (nunca "qualquer um pode").
    if (!PANEL_KEY) return new Response('BOT_PANEL_KEY nao configurada', { status: 503 });
    if (key !== PANEL_KEY) return new Response('unauthorized', { status: 401 });
  }

  // (auditoria 01/08 — item 96) O disparo era "atira e esquece" (sem await, erro
  // engolido no .catch vazio): a function respondia e encerrava, e o pedido podia ser
  // descartado antes de sair — sem ninguem saber. Sendo este HOJE o unico backup do
  // banco, o despacho passa a ser aguardado e registrado.
  let despachado = false;
  let detalhe = '';
  try {
    const r = await fetch(`${SELF_URL}/.netlify/functions/backup-worker-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-key': PANEL_KEY },
      body: JSON.stringify({ origem: isScheduled ? 'cron' : 'manual' }),
      signal: AbortSignal.timeout(15000),
    });
    despachado = r.ok;
    detalhe = r.ok ? 'worker aceito' : `HTTP ${r.status} ao despachar o worker`;
  } catch (e) {
    detalhe = `falha ao despachar: ${String(e.message || e).slice(0, 120)}`;
  }
  // heartbeat do DESPACHO (o do backup concluido e gravado pelo worker, que sabe se as
  // 51 tabelas subiram para o Drive). Falha aqui vira alerta no watchdog.
  await heartbeat('backup-diario-dispatch', despachado, detalhe);
  if (!despachado) await logAdvbox('backup', 'erro', `Backup diario NAO despachado: ${detalhe}`, {});

  return new Response(JSON.stringify({ success: despachado, dispatched: despachado, detalhe }),
    { status: despachado ? 202 : 500, headers: JSONH });
};

export const config = { schedule: '0 6 * * *' };
