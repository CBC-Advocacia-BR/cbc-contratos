/**
 * Despacha o backfill do espelho de mensagens (sdr_mensagens) para leads ja
 * existentes no funil Venda. SEM `schedule` de proposito: e chamado a mao, pelo
 * botao "Run now" do painel da Netlify ou por HTTP com a chave (x-bot-key ou
 * ?key=<BOT_PANEL_KEY>) — a Netlify responde 403 a qualquer chamada HTTP externa
 * feita a uma function AGENDADA, entao um trabalho disparavel a mao nao pode ter
 * `schedule` (mesmo padrao de backup-diario -> backup-worker-background).
 *
 * GET/POST ?key=<BOT_PANEL_KEY>&dias=1..30 (default 7)
 * Padrao do site: function sincrona estoura em ~26s, por isso aqui so despacha
 * para o worker de fundo (sdr-espelho-worker-background), que faz o trabalho.
 */
import { verificarGatilho, respostaNegada } from './_lib/gatilho.mjs';
import { logAdvbox } from './_lib/botDb.mjs';

const PANEL_KEY = process.env.BOT_PANEL_KEY || '';
const JSONH = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export default async (req) => {
  // funcao NAO agendada: so aceita o cabecalho do agendador (nunca chega aqui,
  // ja que nao ha `schedule`) ou a BOT_PANEL_KEY (header x-bot-key ou ?key=).
  const gate = verificarGatilho(req);
  if (!gate.ok) return respostaNegada(gate);

  const url = new URL(req.url);
  const dias = Math.min(Math.max(Number(url.searchParams.get('dias')) || 7, 1), 30);
  const base = process.env.URL || `${url.protocol}//${url.host}`;

  try {
    // (licao item 96 deste projeto: despacho "fire-and-forget" pode ser cortado pela
    // Netlify antes de sair — o pedido nunca chega ao worker, sem ninguem perceber)
    // o despacho e AGUARDADO.
    const r = await fetch(`${base}/.netlify/functions/sdr-espelho-worker-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-key': PANEL_KEY },
      body: JSON.stringify({ dias }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      await logAdvbox('sdr', 'erro', `backfill: worker respondeu HTTP ${r.status}`, { dias, corpo: txt.slice(0, 200) });
    }
    return new Response(JSON.stringify({ ok: true, despachado: { dias }, workerOk: r.ok }), { status: 202, headers: JSONH });
  } catch (e) {
    await logAdvbox('sdr', 'erro', `backfill: falha ao despachar worker: ${String(e.message || e)}`.slice(0, 240), { dias });
    return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }), { status: 500, headers: JSONH });
  }
};
