/**
 * Netlify Function (ON-DEMAND, NÃO agendada): backfill histórico das videochamadas pré-junho.
 *
 * Contexto: antes de junho/2026 as vendedoras já faziam os atendimentos e já marcavam por COR,
 * mas NÃO adicionavam o cliente como convidado nem criavam o Meet — então a regra "live"
 * (convidado externo + Meet) não os enxerga. Aqui detectamos pela COR do evento:
 *   Manjericão(10)=realizada · Tomate(11)=no_show · Pavão(7)=fechou (conta como realizada no funil).
 * Eventos de outras cores / cor padrão são IGNORADOS (não são claramente atendimentos).
 *
 * Grava com source='backfill' (via RPC própria) — a detecção de exclusão do robô live só mexe em
 * source='live', então nunca toca nestas linhas. Sem e-mail do cliente (não há convidado): estas
 * linhas alimentam só a CONTAGEM do funil, não a reconciliação por contrato.
 *
 * SOMENTE LEITURA da agenda. Protegida por chave (BOT_RPC_SECRET via header x-bot-key ou ?key=).
 * Re-executável (idempotente pelo event_id). Janela default: [2026-04-01, 2026-06-01).
 */
import { db, logAdvbox } from './_lib/botDb.mjs';
import { getAccessToken, listEvents, VENDEDORAS } from './_lib/googleAgenda.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const COR_STATUS = { '10': 'realizada', '11': 'no_show', '7': 'fechou' }; // cores de atendimento

export default async (req) => {
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  try {
    const url = new URL(req.url);
    const key = req.headers.get('x-bot-key') || url.searchParams.get('key') || '';
    if (!RPC_SECRET || key !== RPC_SECRET) return json({ ok: false, error: 'forbidden' }, 403);

    const ini = url.searchParams.get('ini') || '2026-04-01';
    const fim = url.searchParams.get('fim') || '2026-06-01';
    const timeMin = new Date(`${ini}T00:00:00Z`).toISOString();
    const timeMax = new Date(`${fim}T00:00:00Z`).toISOString();

    const at = await getAccessToken();
    let totalEventos = 0;
    const porStatus = { realizada: 0, no_show: 0, fechou: 0 };
    const rows = [];
    for (const cal of VENDEDORAS) {
      const eventos = await listEvents(cal, timeMin, timeMax, at);
      totalEventos += eventos.length;
      for (const ev of eventos) {
        if (!ev || ev.status === 'cancelled') continue;
        const status = COR_STATUS[ev.colorId];
        if (!status) continue; // só Manjericão/Tomate/Pavão
        const scheduledAt = ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null);
        if (!scheduledAt) continue;
        porStatus[status]++;
        rows.push({
          event_id: ev.id, vendedora_email: cal, cliente_email: null,
          cliente_nome: ev.summary || null, status, color_id: String(ev.colorId),
          scheduled_at: scheduledAt, tem_meet: false,
          raw: { summary: ev.summary || null, colorId: ev.colorId, backfill: true },
        });
      }
    }

    let upserted = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const { data, error } = await db.rpc('agenda_videochamadas_backfill_upsert', { p_chave: RPC_SECRET, p_rows: rows.slice(i, i + 200) });
      if (error) throw new Error('backfill upsert: ' + error.message);
      upserted += data || 0;
    }

    await logAdvbox('agenda', 'info', `backfill videochamadas [${ini}..${fim}): ${rows.length} atendimentos coloridos de ${totalEventos} eventos`, { encontrados: rows.length, totalEventos, porStatus }).catch(() => {});
    return json({ ok: true, janela: [ini, fim], total_eventos: totalEventos, encontrados: rows.length, por_status: porStatus, upserted });
  } catch (e) {
    await logAdvbox('agenda', 'erro', `backfill videochamadas falhou: ${e.message}`.slice(0, 300), {}).catch(() => {});
    return json({ ok: false, error: e.message }, 500);
  }
};
