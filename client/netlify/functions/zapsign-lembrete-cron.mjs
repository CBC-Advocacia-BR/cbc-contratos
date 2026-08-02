/**
 * (auditoria 01/08/2026 — item 113) Lembrete diario de assinatura do ZapSign.
 *
 * ESTE ARQUIVO SO AGENDA. A logica esta em `zapsign-lembrete-worker.mjs`.
 *
 * POR QUE SEPARAR (descoberto 02/08/2026, no primeiro disparo real): a Netlify responde
 * **403 a qualquer chamada HTTP externa feita a uma function AGENDADA** — o bloqueio e na
 * borda, antes de o codigo rodar, entao nem a chave certa passa. Como este trabalho
 * precisa poder ser disparado A MAO (o mutirao dos ~50 contratos ja enviados, e qualquer
 * reenvio pontual), o horario fica aqui e o trabalho fica num arquivo chamavel.
 * E o mesmo desenho que `backup-diario` -> `backup-worker-background` ja usava.
 */
import { heartbeat, logAdvbox } from './_lib/botDb.mjs';

export const config = {
  // 12h UTC = 09h BRT — horario comercial, depois da abertura do escritorio.
  schedule: '0 12 * * *',
};

const SELF = process.env.URL || 'https://contratos-cbc.netlify.app';
const PANEL_KEY = process.env.BOT_PANEL_KEY || '';

export default async () => {
  try {
    // (item 96) o despacho e AGUARDADO: sem await, a Netlify pode encerrar a function
    // antes de o pedido sair, e o trabalho nunca acontece — sem ninguem saber.
    const r = await fetch(`${SELF}/.netlify/functions/zapsign-lembrete-worker`, {
      method: 'POST',
      headers: { 'x-bot-key': PANEL_KEY },
      signal: AbortSignal.timeout(25000),
    });
    const txt = await r.text().catch(() => '');
    if (!r.ok) throw new Error(`worker HTTP ${r.status}: ${txt.slice(0, 160)}`);
    await heartbeat('zapsign-lembrete-cron', true, 'worker despachado');
    return new Response(txt || '{"ok":true}', { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    await logAdvbox('zapsign', 'erro', `zapsign-lembrete despacho: ${e.message}`.slice(0, 240), {});
    await heartbeat('zapsign-lembrete-cron', false, e.message);
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
