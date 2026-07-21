/**
 * Worker (background, ate 15 min): mede SLA de 1a resposta + engajamento por lead.
 *
 * Para cada lead recente do funil Venda: contato principal -> events de chat do
 * CONTATO (incoming/outgoing — licao 02/07: events NAO retornam filtrando por lead)
 * -> computeSlaConversa (t0 msg da campanha, t1 nossa resposta bot/humano, t2 lead
 * respondeu de volta) -> RPC kommo_sla_upsert (BOT_RPC_SECRET).
 *
 * Body: { dias?: 1..10 (default 2), offsetDias?: 0.. (janela [agora-dias-offset, agora-offset]) }
 * Leads com >=48h viram `definitivo` (nao reprocessa nas rodadas seguintes).
 */
import { db, logAdvbox } from './_lib/botDb.mjs';
import { computeSlaConversa } from './_lib/slaConversa.mjs';

const KOMMO_URL = 'https://advocaciacbc.kommo.com/api/v4';
const TOKEN = process.env.KOMMO_TOKEN || '';
const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const PIPELINE_VENDA = 13760367;
const THROTTLE_MS = 350;
const DEFINITIVO_MS = 48 * 3600 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function kget(path) {
  const r = await fetch(`${KOMMO_URL}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (r.status === 204) return null;
  if (r.status === 429) { await sleep(12000); return kget(path); }
  if (!r.ok) throw new Error(`kommo ${r.status} em ${path.split('?')[0]}`);
  return r.json();
}

async function eventosContato(contactId, type, fromTs) {
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const d = await kget(`/events?filter[type]=${type}&filter[entity]=contact&filter[entity_id]=${contactId}&filter[created_at][from]=${fromTs}&limit=100&page=${page}`);
    const evs = d?._embedded?.events || [];
    out.push(...evs.map((e) => ({ created_at: e.created_at, created_by: e.created_by })));
    if (evs.length < 100) break;
  }
  return out;
}

export default async (req) => {
  const t0 = Date.now();
  let body = {};
  try { body = await req.json(); } catch { /* sem body */ }
  const dias = Math.min(Math.max(Number(body.dias) || 2, 1), 10);
  const offsetDias = Math.max(Number(body.offsetDias) || 0, 0);
  const fimMs = Date.now() - offsetDias * 864e5;
  const iniMs = fimMs - dias * 864e5;

  try {
    if (!TOKEN) throw new Error('KOMMO_TOKEN ausente');

    // usuarios humanos da conta (bot/sistema = created_by 0 ou id fora da lista)
    const users = await kget('/users?limit=250');
    const humanIds = new Set((users?._embedded?.users || []).map((u) => Number(u.id)));
    const nomeUser = new Map((users?._embedded?.users || []).map((u) => [Number(u.id), u.name || String(u.id)]));

    // leads do funil Venda criados na janela (com contatos embutidos)
    const leads = [];
    for (let page = 1; page <= 40; page++) {
      const d = await kget(`/leads?filter[pipeline_id]=${PIPELINE_VENDA}`
        + `&filter[created_at][from]=${Math.floor(iniMs / 1000)}&filter[created_at][to]=${Math.floor(fimMs / 1000)}`
        + `&with=contacts&limit=100&page=${page}`);
      const ls = d?._embedded?.leads || [];
      leads.push(...ls);
      if (ls.length < 100) break;
      await sleep(200);
    }

    const rows = [];
    let semContato = 0;
    for (const lead of leads) {
      const contatos = lead._embedded?.contacts || [];
      const principal = contatos.find((c) => c.is_main) || contatos[0];
      if (!principal) { semContato++; continue; }
      const fromTs = Math.max(0, Number(lead.created_at) - 3600);
      const incoming = await eventosContato(principal.id, 'incoming_chat_message', fromTs);
      const outgoing = await eventosContato(principal.id, 'outgoing_chat_message', fromTs);
      const sla = computeSlaConversa({ incoming, outgoing, humanIds });
      const iso = (ts) => (ts != null ? new Date(ts * 1000).toISOString() : null);
      rows.push({
        lead_id: lead.id,
        contact_id: principal.id,
        responsavel: nomeUser.get(Number(lead.responsible_user_id)) || null,
        lead_criado_em: iso(lead.created_at),
        ts_msg_campanha: iso(sla.ts_msg_campanha),
        ts_nossa_resposta: iso(sla.ts_nossa_resposta),
        resposta_created_by: sla.resposta_created_by,
        resposta_humana: sla.resposta_humana,
        ts_resposta_humana: iso(sla.ts_resposta_humana),
        sla_seg: sla.sla_seg,
        sla_humano_seg: sla.sla_humano_seg,
        ts_resposta_lead: iso(sla.ts_resposta_lead),
        tempo_engajar_seg: sla.tempo_engajar_seg,
        atendido: sla.atendido,
        engajou: sla.engajou,
        definitivo: (Date.now() - Number(lead.created_at) * 1000) >= DEFINITIVO_MS,
      });
      await sleep(THROTTLE_MS);
      if (Date.now() - t0 > 13 * 60 * 1000) break; // margem antes do teto de 15min
    }

    let upserted = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const { data, error } = await db.rpc('kommo_sla_upsert', { p_chave: RPC_SECRET, p_rows: rows.slice(i, i + 100) });
      if (error) throw new Error('upsert: ' + error.message);
      upserted += data || 0;
    }

    await logAdvbox('kommo', 'info',
      `sla conversa: ${upserted} leads medidos (janela ${dias}d${offsetDias ? ` offset ${offsetDias}d` : ''}, ${semContato} sem contato, ${Math.round((Date.now() - t0) / 1000)}s)`,
      { leads: leads.length, upserted, semContato }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, leads: leads.length, upserted }), { status: 200 });
  } catch (e) {
    await logAdvbox('kommo', 'erro', `sla conversa falhou: ${e.message}`.slice(0, 300), {}).catch(() => {});
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500 });
  }
};
