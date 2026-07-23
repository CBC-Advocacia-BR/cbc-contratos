// Backfill do comparecimento Meet, 1 mes por hop (encadeado). Anda de hoje para tras ate o piso.
// Cursor em bot_config.meet_backfill_status. Manual/continuacao: ?key=<BOT_PANEL_KEY>.
// Retencao do log ~6 meses -> alcanca todo o historico da agenda (comeca em ~mar/2026).
import { db, logAdvbox } from './_lib/botDb.mjs';
import { getAccessToken, listMeetCallEnded, classifyMeetItems, deriveMeetStatus, LIMIAR_SEG } from './_lib/meetAudit.mjs';

const PANEL_KEY = process.env.BOT_PANEL_KEY || '';
const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const PISO_ISO = '2026-03-01T00:00:00.000Z';

async function getCursor() {
  const { data } = await db.from('bot_config').select('value').eq('key', 'meet_backfill_status').maybeSingle();
  return (data && data.value) || null;
}
async function setCursor(v) {
  await db.from('bot_config').upsert({ key: 'meet_backfill_status', value: v }, { onConflict: 'key' });
}

export default async (req) => {
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  try {
    const url = new URL(req.url);
    if ((url.searchParams.get('key') || '') !== PANEL_KEY) return json({ ok: false, error: 'chave invalida' }, 401);

    const cur = await getCursor();
    const fim = cur && cur.proximo_fim ? new Date(cur.proximo_fim) : new Date();
    if (fim.getTime() <= new Date(PISO_ISO).getTime()) {
      await setCursor({ ...(cur || {}), done: true });
      return json({ ok: true, done: true });
    }
    const ini = new Date(fim.getTime() - 31 * 864e5);

    const at = await getAccessToken();
    const items = await listMeetCallEnded(at, ini.toISOString(), fim.toISOString());
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

    const proximo_fim = ini.toISOString();
    await setCursor({ proximo_fim, ultimo_intervalo: [ini.toISOString(), fim.toISOString()], atualizados, done: false });
    await logAdvbox('meet', 'info', `backfill Meet ${ini.toISOString().slice(0, 10)}..${fim.toISOString().slice(0, 10)}: ${rows.length} conferencias, ${atualizados} atualizadas`, { atualizados }).catch(() => {});

    // re-dispara o proximo hop (fire-and-forget)
    fetch(`${process.env.URL}/.netlify/functions/meet-auditoria-backfill?key=${encodeURIComponent(PANEL_KEY)}`).catch(() => {});
    return json({ ok: true, intervalo: [ini.toISOString(), fim.toISOString()], atualizados, proximo_fim });
  } catch (e) {
    await logAdvbox('meet', 'erro', `backfill Meet falhou: ${e.message}`.slice(0, 300), {}).catch(() => {});
    return json({ ok: false, error: e.message }, 500);
  }
};

export const config = {}; // sem cron: so manual/encadeado
