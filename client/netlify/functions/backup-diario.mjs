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

const PANEL_KEY = process.env.BOT_PANEL_KEY || 'cbc-bot-2026';
const SELF_URL = process.env.URL || 'https://contratos-cbc.netlify.app';
const JSONH = { 'Content-Type': 'application/json' };

export default async (req) => {
  const isScheduled = req.headers.get('x-netlify-event') === 'schedule';

  if (!isScheduled) {
    const url = new URL(req.url);
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const key = req.headers.get('x-bot-key') || body.key || url.searchParams.get('key') || '';
    if (key !== PANEL_KEY) return new Response('unauthorized', { status: 401 });
  }

  fetch(`${SELF_URL}/.netlify/functions/backup-worker-background`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bot-key': PANEL_KEY },
    body: JSON.stringify({ origem: isScheduled ? 'cron' : 'manual' }),
  }).catch(() => {});

  return new Response(JSON.stringify({ success: true, dispatched: true }), { status: 202, headers: JSONH });
};

export const config = { schedule: '0 6 * * *' };
