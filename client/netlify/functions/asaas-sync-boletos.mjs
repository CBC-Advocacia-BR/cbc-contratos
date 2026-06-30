/**
 * Sincroniza boletos do Asaas → Supabase asaas_boletos
 *
 * Duas formas de execução:
 *  1) Scheduled (6h e 18h BRT): DISPARA o worker background
 *     asaas-sync-boletos-background (a rodada completa leva minutos e estourava
 *     o timeout de função comum — por isso o worker em background).
 *  2) Manual via POST (painel Boletos): processa UM bloco e retorna `next`
 *     Body: { status: 'PENDING'|'OVERDUE'|'RECEIVED'|..., offset: 0, full?: true }
 *     Resposta: { success, processed, next: {status, offset} | null, done }
 *
 * Escrita no espelho via RPCs security definer (asaas_mirror_*) — a tabela
 * asaas_boletos é restrita ao role authenticated e as functions usam anon.
 */
import { STATUSES, processBlock, nextBlock, mirrorState } from './_lib/asaasMirror.mjs';
import { logAdvbox } from './_lib/botDb.mjs';

const BASE_URL = process.env.URL || 'https://contratos-cbc.netlify.app';
const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });

  // Scheduled: dispara o worker background e encerra rapido
  const isScheduled = req.headers.get('x-netlify-event') === 'schedule' || !req.method || req.method === 'GET';

  try {
    if (isScheduled) {
      await fetch(`${BASE_URL}/.netlify/functions/asaas-sync-boletos-background`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'incremental' }),
      });
      return new Response(JSON.stringify({ success: true, mode: 'scheduled', dispatched: true }), { headers: CORS });
    }

    // Manual block mode (painel)
    const body = await req.json().catch(() => ({}));
    const status = body.status || STATUSES[0];
    const offset = Number(body.offset) || 0;

    if (!STATUSES.includes(status)) {
      return new Response(JSON.stringify({ error: 'invalid status' }), { status: 400, headers: CORS });
    }

    const result = await processBlock(status, offset, { full: body.full === true });
    const next = nextBlock(status, offset, result.hasMore);
    if (!next) await mirrorState('boletos_last_sync', new Date().toISOString()).catch(() => {});

    return new Response(JSON.stringify({
      success: true,
      processed: result.rows,
      current: { status, offset },
      next,
      done: !next,
    }), { headers: CORS });
  } catch (err) {
    console.error('sync error:', err);
    await logAdvbox('asaas', 'erro', `sync manual: ${err.message}`.slice(0, 300), {});
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: CORS });
  }
};

export const config = {
  schedule: '0 9,21 * * *', // 06:00 e 18:00 BRT — pronto antes do expediente e logo depois
};
