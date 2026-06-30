/**
 * Worker da fila Kommo (kommo_queue): drena os jobs pendentes respeitando o rate
 * limit (~4-5 req/s) e com backoff. Roda a cada minuto e tambem pode ser disparado
 * manualmente pelo painel ("processar agora").
 *
 * "Melhor ter fila do que falhar": as integracoes enfileiram a escrita e tentam na
 * hora; o que escapar (429/erro transitorio) e drenado aqui.
 */
import { processQueue } from './_lib/kommo.mjs';
import { logAdvbox } from './_lib/botDb.mjs';

const PANEL_KEY = process.env.BOT_PANEL_KEY || 'cbc-bot-2026';
const JSONH = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

export default async (req) => {
  const isScheduled = req.headers.get('x-netlify-event') === 'schedule' || req.method === 'GET';
  if (!isScheduled) {
    const body = await req.json().catch(() => ({}));
    const key = body.key || req.headers.get('x-bot-key') || '';
    if (key !== PANEL_KEY) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: JSONH });
  }
  try {
    // timeout de funcao comum ~10s -> mantemos a janela em 8s
    const res = await processQueue({ maxMs: 8000, throttleMs: 220 });
    if (res.failed) await logAdvbox('kommo', 'aviso', `fila Kommo: ${res.done} ok, ${res.failed} falha de ${res.processed}`, res).catch(() => {});
    return new Response(JSON.stringify({ ok: true, ...res }), { headers: JSONH });
  } catch (e) {
    await logAdvbox('kommo', 'erro', `kommo-queue-worker: ${e.message}`.slice(0, 300), {}).catch(() => {});
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: JSONH });
  }
};

export const config = { schedule: '* * * * *' }; // a cada minuto
