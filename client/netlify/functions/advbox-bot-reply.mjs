/**
 * Netlify Function: advbox-bot-reply
 * Endpoint usado pelo PAINEL (simulador de chat, buscas, resposta pronta)
 * e pelo WIDGET do cartao do lead no Kommo.
 *
 * Auth simples: header 'x-bot-key' (ou ?key=) == env BOT_PANEL_KEY.
 * (mesmo padrao de chave simples das demais functions — endurecer depois)
 *
 * Body (JSON): { action, ...params }
 *   chat              { channel, text, customerId?, customerName? }
 *   search_customers  { query }
 *   search_lawsuit    { process_number }
 *   lawsuits_of       { customer_id }
 *   preview           { lawsuit_id, customer_name? }   -> resposta pronta
 *   settings          {}                               -> stages/tasks do ADVBOX
 *   widget            { lead_id }                      -> dados p/ widget do cartao
 *   mark_communicated { lawsuit_id }
 */
import { handleMessage, buildLawsuitAnswer } from './_lib/botEngine.mjs';
import * as adv from './_lib/advbox.mjs';
import { db, getConfig, getStageTemplates, getTaskTemplates, getGlossary, getLawsuitLeadMap, markCommunicated, logAdvbox, getBotMetricas } from './_lib/botDb.mjs';

const KEY = process.env.BOT_PANEL_KEY;
const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: H });

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: { ...H, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, x-bot-key' } });
  }
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  const url = new URL(req.url);
  const key = req.headers.get('x-bot-key') || url.searchParams.get('key') || '';
  if (key !== KEY) return json({ ok: false, error: 'unauthorized' }, 401);

  let body = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: 'JSON invalido' }, 400); }
  const { action } = body;

  try {
    if (action === 'chat') {
      const { channel, text, customerId, customerName } = body;
      if (!channel || !text) return json({ ok: false, error: 'channel e text obrigatorios' }, 400);
      const t0 = Date.now();
      const r = await handleMessage({ channel: `sim:${channel}`, text, customerId, customerName });
      return json({ ok: true, reply: r.reply, intent: r.intent, escalate: r.escalate, meta: { ...(r.meta || {}), ms: Date.now() - t0 } });
    }

    if (action === 'metrics') {
      const m = await getBotMetricas(body.dias || 30);
      return json({ ok: true, metricas: m });
    }

    if (action === 'asaas_sync_run') {
      // dispara o worker de espelho de boletos (incremental ou full)
      const base = process.env.URL || 'https://contratos-cbc.netlify.app';
      await fetch(`${base}/.netlify/functions/asaas-sync-boletos-background`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: body.mode === 'full' ? 'full' : 'incremental' }),
      });
      return json({ ok: true, dispatched: true });
    }

    if (action === 'search_customers') {
      const list = await adv.searchCustomers(body.query || '');
      return json({ ok: true, customers: list.map(c => ({ id: c.id, name: c.name, identification: c.identification, lawsuits: (c.lawsuits || []).length })) });
    }

    if (action === 'search_lawsuit') {
      const ls = await adv.searchLawsuitByNumber(body.process_number || '');
      if (!ls) return json({ ok: true, lawsuit: null });
      return json({ ok: true, lawsuit: { id: ls.id, process_number: ls.process_number, stage: ls.stage, type: ls.type, customers: ls.customers || [] } });
    }

    if (action === 'lawsuits_of') {
      const cust = await adv.getCustomer(body.customer_id);
      if (!cust) return json({ ok: false, error: 'cliente nao encontrado' }, 404);
      const out = [];
      for (const l of (cust.lawsuits || []).slice(0, 8)) {
        const ls = await adv.getLawsuit(l.lawsuit_id || l.id).catch(() => null);
        out.push({ id: l.lawsuit_id || l.id, process_number: l.process_number || ls?.process_number, stage: ls?.stage, type: ls?.type, responsible: ls?.responsible });
      }
      return json({ ok: true, customer: { id: cust.id, name: cust.name, identification: cust.identification }, lawsuits: out });
    }

    if (action === 'preview') {
      const [cfg, stageTemplates, taskTemplates, glossary] = await Promise.all([
        getConfig(), getStageTemplates(), getTaskTemplates(), getGlossary(),
      ]);
      const ans = await buildLawsuitAnswer(body.lawsuit_id, { cfg, stageTemplates, taskTemplates, glossary, customerName: body.customer_name || '' });
      return json({ ok: true, reply: ans.reply, meta: ans.meta || {} });
    }

    if (action === 'settings') {
      const s = await adv.getSettings();
      return json({ ok: true, settings: s?.data || s });
    }

    if (action === 'advbox_health') {
      // ping ao vivo na API do ADVBOX (1 consulta cronometrada)
      const t0 = Date.now();
      try {
        const s = await adv.getSettings();
        const d = s?.data || s || {};
        return json({
          ok: true, online: true, ms: Date.now() - t0,
          etapas: (d.stages || []).length, tarefas: (d.tasks || []).length,
          usuarios: (d.users || []).length,
        });
      } catch (e) {
        await logAdvbox('api', 'erro', `Teste manual da API falhou: ${e.message}`, { ms: Date.now() - t0 });
        return json({ ok: true, online: false, ms: Date.now() - t0, erro: e.message });
      }
    }

    if (action === 'widget') {
      const leadId = Number(body.lead_id);
      if (!leadId) return json({ ok: false, error: 'lead_id obrigatorio' }, 400);
      const map = await getLawsuitLeadMap();
      const lawsuitIds = Object.entries(map).filter(([, v]) => v === leadId).map(([k]) => Number(k));
      if (!lawsuitIds.length) return json({ ok: true, found: false });
      const { data: novidades } = await db.from('bot_sync_state')
        .select('id, kind, title, event_date, communicated, lawsuit_id, process_number')
        .in('lawsuit_id', lawsuitIds).order('created_at', { ascending: false }).limit(15);
      const [cfg, stageTemplates, taskTemplates, glossary] = await Promise.all([
        getConfig(), getStageTemplates(), getTaskTemplates(), getGlossary(),
      ]);
      const ans = await buildLawsuitAnswer(lawsuitIds[0], { cfg, stageTemplates, taskTemplates, glossary, customerName: '' });
      const pendentes = (novidades || []).filter(n => !n.communicated).length;
      return json({ ok: true, found: true, lawsuit_ids: lawsuitIds, novidades: novidades || [], nao_comunicadas: pendentes, resposta_pronta: ans.reply, fase: ans.meta?.fase || '' });
    }

    if (action === 'mark_communicated') {
      await markCommunicated(body.lawsuit_id);
      return json({ ok: true });
    }

    return json({ ok: false, error: `action desconhecida: ${action}` }, 400);
  } catch (err) {
    console.error('[advbox-bot-reply]', err);
    await logAdvbox('api', 'erro', `Falha na action "${action}": ${err.message}`, { action });
    return json({ ok: false, error: err.message }, 500);
  }
};

export const config = { path: '/.netlify/functions/advbox-bot-reply' };
