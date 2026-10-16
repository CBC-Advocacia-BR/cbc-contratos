/**
 * (16/10/2026) Resumo automatico das videochamadas de venda — SO AGENDA.
 * A logica esta em `call-resumo-worker-background.mjs`. Separado porque a Netlify responde
 * 403 a chamada HTTP externa feita a function AGENDADA, e o worker precisa poder ser
 * disparado a mao (conferencia de uma call especifica). Mesmo desenho de
 * zapsign-lembrete-cron -> zapsign-lembrete-worker.
 *
 * Com bot_config.call_resumo.ativo=false o worker so bate o ponto e sai (custo zero).
 */
import { heartbeat, logAdvbox } from './_lib/botDb.mjs';

export const config = {
  // de hora em hora, aos :20, das 08h20 as 21h20 BRT (11-00 UTC), seg-sab: cobre o
  // expediente comercial; call das 21h e resumida na rodada seguinte.
  schedule: '20 0,11-23 * * 1-6',
};

const SELF = process.env.URL || 'https://contratos-cbc.netlify.app';
const PANEL_KEY = process.env.BOT_PANEL_KEY || '';

export default async () => {
  try {
    // (item 96) despacho AGUARDADO: sem await a function pode encerrar antes do pedido sair.
    // Background function responde 202 na hora, entao isto e rapido.
    const r = await fetch(`${SELF}/.netlify/functions/call-resumo-worker-background`, {
      method: 'POST',
      headers: { 'x-bot-key': PANEL_KEY },
      signal: AbortSignal.timeout(25000),
    });
    if (r.status !== 202 && !r.ok) throw new Error(`worker HTTP ${r.status}`);
    await heartbeat('call-resumo-cron', true, 'worker despachado');
    return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    await logAdvbox('ia', 'erro', `call-resumo despacho: ${e.message}`.slice(0, 240), {});
    await heartbeat('call-resumo-cron', false, e.message);
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
