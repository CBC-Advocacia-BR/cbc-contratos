/**
 * Netlify Function: kommo-advbox-webhook
 * Recebe o webhook "Mensagem recebida" (add_message) do Kommo e repassa
 * IMEDIATAMENTE para a function background (Kommo exige resposta em ~2s;
 * o processamento real consulta ADVBOX e demora mais que isso).
 *
 * Configurar no Kommo: Configuracoes -> Integracoes -> Webhooks
 *   URL: https://contratos-cbc.netlify.app/.netlify/functions/kommo-advbox-webhook
 *   Evento: "Mensagem recebida" (incoming chat message)
 */
const SELF_URL = process.env.URL || 'https://contratos-cbc.netlify.app';

export default async (req) => {
  if (req.method !== 'POST') return new Response('ok', { status: 200 });

  // (portal-16) valida a origem do webhook. O Kommo nao assina por padrao, mas
  // aceita um parametro secreto na URL do webhook (?secret=...). So EXIGE quando
  // WEBHOOK_SECRET estiver configurado no Netlify -> nao quebra o bot em teste.
  // PENDENCIA: setar WEBHOOK_SECRET e por ?secret=<valor> na URL do webhook no Kommo.
  const SECRET = process.env.WEBHOOK_SECRET;
  if (SECRET) {
    let provided = req.headers.get('x-webhook-secret') || '';
    try { provided = provided || new URL(req.url).searchParams.get('secret') || ''; } catch { /* url invalida */ }
    if (provided !== SECRET) {
      return new Response(JSON.stringify({ ok: true, ignored: 'auth' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  }

  let raw = '';
  try { raw = await req.text(); } catch { /* corpo vazio */ }
  const contentType = req.headers.get('content-type') || '';

  try {
    // background function: responde 202 na hora e processa por ate 15 min
    await fetch(`${SELF_URL}/.netlify/functions/advbox-bot-worker-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType, raw }),
    });
  } catch (e) {
    console.error('[kommo-advbox-webhook] falha ao despachar worker:', e.message);
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

export const config = { path: '/.netlify/functions/kommo-advbox-webhook' };
