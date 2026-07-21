/**
 * Netlify Function: kommo-agenda-webhook — bot Ana.
 * Recebe "Mensagem recebida" (add_message) do Kommo e despacha IMEDIATAMENTE
 * para a background function (Kommo exige resposta ~2s).
 * Webhook registrado na Task 2 com ?secret=<AGENDA_WEBHOOK_SECRET>.
 */
import { logAdvbox } from './_lib/botDb.mjs';

const SELF_URL = process.env.URL || 'https://contratos-cbc.netlify.app';

export default async (req) => {
  if (req.method !== 'POST') return new Response('ok', { status: 200 });
  const SECRET = process.env.AGENDA_WEBHOOK_SECRET;
  if (SECRET) {
    let provided = req.headers.get('x-webhook-secret') || '';
    try { provided = provided || new URL(req.url).searchParams.get('secret') || ''; } catch { /* url invalida */ }
    if (provided !== SECRET) return new Response(JSON.stringify({ ok: true, ignored: 'auth' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  let raw = '';
  try { raw = await req.text(); } catch { /* corpo vazio */ }
  const contentType = req.headers.get('content-type') || '';
  try {
    await fetch(`${SELF_URL}/.netlify/functions/agenda-bot-worker-background`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType, raw }),
    });
  } catch (e) {
    try { await logAdvbox('agenda', 'erro', `Falha ao despachar worker da Ana: ${e.message}`.slice(0, 300), { raw: String(raw).slice(0, 2000), contentType }); } catch { /* best-effort */ }
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

export const config = { path: '/.netlify/functions/kommo-agenda-webhook' };
