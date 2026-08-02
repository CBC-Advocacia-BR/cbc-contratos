/**
 * Fase 3 — reconciliacao do registro mestre `clientes`. Dispara a RPC
 * clientes_reconciliar (toda a logica roda no banco: upsert por CPF das 4 fontes
 * + marcacao PF/PJ + parte-contraria). Mantem o mestre fresco (deixa de ser snapshot).
 *
 * GET/scheduled = roda. POST exige key === BOT_PANEL_KEY (gatilho manual).
 */
import { db } from './_lib/botDb.mjs';
import { logAdvbox, heartbeat } from './_lib/botDb.mjs';
import { verificarGatilho, respostaNegada } from './_lib/gatilho.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const PANEL_KEY = process.env.BOT_PANEL_KEY || 'cbc-bot-2026';
const JSONH = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-bot-key' };

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: JSONH });
  // (auditoria 01/08 — item 9) ANTES: `|| req.method === 'GET'` fazia QUALQUER acesso
  // pelo navegador ser tratado como "veio do agendador" — e o bloco de checagem de chave
  // abaixo era pulado. Bastava abrir a URL para disparar o robo (aqui, inclusive
  // backfills que consomem cota paga de API de terceiros). Agora: ou vem do agendador
  // da Netlify (cabecalho x-netlify-event), ou apresenta a BOT_PANEL_KEY.
  const gatilho = verificarGatilho(req, { agendada: true });
  if (!gatilho.ok) return respostaNegada(gatilho);
  const isScheduled = gatilho.origem === 'cron';
  // (item 9) a checagem de chave ja foi feita por verificarGatilho() acima —
  // o bloco antigo daqui so olhava body.key/cabecalho e barrava o disparo via ?key=.
  try {
    const { data, error } = await db.rpc('clientes_reconciliar', { p_chave: RPC_SECRET });
    if (error) throw new Error(error.message);
    await heartbeat('clientes-reconciliar', true, JSON.stringify(data || {}).slice(0, 180)).catch(() => {}); // (observ 28/07)
    return new Response(JSON.stringify({ ok: true, ...(data || {}) }), { headers: JSONH });
  } catch (e) {
    await logAdvbox('clientes', 'erro', `reconciliar: ${e.message}`.slice(0, 300), {}).catch(() => {});
    await heartbeat('clientes-reconciliar', false, e.message).catch(() => {});
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: JSONH });
  }
};

// 08h30 BRT (11:30 UTC) — depois do kommo-leads-sync (11:00) e dos snapshots.
export const config = { schedule: '30 11 * * *' };
