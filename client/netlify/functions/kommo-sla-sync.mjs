/**
 * Dispatcher (cron *\/30): dispara o kommo-sla-worker-background, que mede o SLA de
 * 1a resposta + engajamento dos leads recentes do funil Venda (ver o worker).
 *
 * Manual/backfill: GET ?key=<BOT_PANEL_KEY>&dias=1..10&offsetDias=N
 * (janela [agora-dias-offset, agora-offset] — p/ backfill de 30d: 3 chamadas com
 * offsetDias 0/10/20). Padrao do site: functions sincronas estouram em ~26s, por
 * isso este endpoint so DESPACHA.
 */
export default async (req) => {
  const url = new URL(req.url);
  const manual = url.searchParams.has('key') || url.searchParams.has('dias');
  if (manual) {
    const key = url.searchParams.get('key') || '';
    if (!process.env.BOT_PANEL_KEY || key !== process.env.BOT_PANEL_KEY) {
      return new Response(JSON.stringify({ ok: false, error: 'chave invalida' }), { status: 401 });
    }
  }
  const dias = Math.min(Math.max(Number(url.searchParams.get('dias')) || 2, 1), 10);
  const offsetDias = Math.max(Number(url.searchParams.get('offsetDias')) || 0, 0);

  const base = process.env.URL || `${url.protocol}//${url.host}`;
  fetch(`${base}/.netlify/functions/kommo-sla-worker-background`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dias, offsetDias }),
  }).catch(() => {});

  return new Response(JSON.stringify({ ok: true, despachado: { dias, offsetDias } }), {
    status: 202, headers: { 'Content-Type': 'application/json' },
  });
};

export const config = { schedule: '*/30 * * * *' };
