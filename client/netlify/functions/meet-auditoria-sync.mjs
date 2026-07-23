// Cron de hora em hora: le call_ended do log de auditoria do Meet dos ultimos N dias,
// classifica presenca de cliente por calendar_event_id e grava meet_* em agenda_videochamadas.
// NUNCA escreve 'status' (isso e a cor). Manual: ?key=<BOT_PANEL_KEY>&dias=N (default 1).
// Log silencioso: so registra no Monitor quando houve atualizacao ou erro.
import { db, logAdvbox } from './_lib/botDb.mjs';
import { getAccessToken, listMeetCallEnded, classifyMeetItems, deriveMeetStatus, LIMIAR_SEG } from './_lib/meetAudit.mjs';

const PANEL_KEY = process.env.BOT_PANEL_KEY || '';
const RPC_SECRET = process.env.BOT_RPC_SECRET || '';

export default async (req) => {
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  try {
    const url = new URL(req.url);
    const manual = url.searchParams.get('key');
    if (manual && manual !== PANEL_KEY) return json({ ok: false, error: 'chave invalida' }, 401);
    const dias = Math.min(parseInt(url.searchParams.get('dias') || '1', 10) || 1, 40);

    const at = await getAccessToken();
    const startISO = new Date(Date.now() - dias * 864e5).toISOString();
    const items = await listMeetCallEnded(at, startISO);
    const byCal = classifyMeetItems(items);

    const rows = Object.entries(byCal).map(([event_id, e]) => ({
      event_id,
      cliente_presente: e.cliente_seg > LIMIAR_SEG,
      cliente_seg: e.cliente_seg,
      meet_status: deriveMeetStatus(e),
      participantes: e.participantes,
    }));

    let atualizados = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const { data, error } = await db.rpc('agenda_meet_upsert', { p_chave: RPC_SECRET, p_rows: rows.slice(i, i + 200) });
      if (error) throw new Error('upsert: ' + error.message);
      atualizados += data || 0;
    }

    if (atualizados > 0) {
      await logAdvbox('meet', 'info', `meet-auditoria: ${atualizados} videochamadas atualizadas de ${rows.length} conferencias (${items.length} call_ended, ${dias}d)`, { items: items.length, conferencias: rows.length, atualizados, dias }).catch(() => {});
    }
    return json({ ok: true, items: items.length, conferencias: rows.length, atualizados });
  } catch (e) {
    await logAdvbox('meet', 'erro', `meet-auditoria falhou: ${e.message}`.slice(0, 300), {}).catch(() => {});
    return json({ ok: false, error: e.message }, 500);
  }
};

export const config = { schedule: '0 * * * *' }; // de hora em hora (janela de 1 dia, carga desprezivel)
