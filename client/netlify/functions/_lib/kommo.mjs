/**
 * Cliente Kommo (API v4) compartilhado pelas functions do Bot.
 * Reusa os mesmos padroes de kommo-note.mjs / advbox-sync.mjs.
 */

import { enqueue, claimById, claimBatch, complete, fail, reclaimStuck } from './kommoQueue.mjs';

const KOMMO_TOKEN = process.env.KOMMO_TOKEN || '';
const KOMMO_BASE = 'https://advocaciacbc.kommo.com/api/v4';
const H = { 'Authorization': `Bearer ${KOMMO_TOKEN}`, 'Content-Type': 'application/json' };
const SELF_URL = process.env.URL || 'https://contratos-cbc.netlify.app';

export function kommoConfigured() { return !!KOMMO_TOKEN; }

// (integ-5) timeout em toda chamada ao Kommo p/ nao pendurar a function.
const KFETCH_TIMEOUT = 15000;

// Throttle global por instancia: garante >=200ms entre chamadas ao Kommo (~5 req/s,
// abaixo do limite ~7). Espaça automaticamente loops de drain inline (ex.: cobranca
// percorrendo varios leads) sem precisar de logica por caller. O residual (instancias
// concorrentes) e absorvido pelo 429-retry + fila.
let _lastKommoCall = 0;
async function throttleKommo() {
  const wait = 200 - (Date.now() - _lastKommoCall);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastKommoCall = Date.now();
}

// Espera honrando Retry-After; backoff exponencial como fallback. (limite Kommo ~7 req/s)
async function kommoFetch(path, opts = {}, label = 'GET') {
  for (let attempt = 0; attempt < 4; attempt++) {
    await throttleKommo();
    const r = await fetch(`${KOMMO_BASE}${path}`, { ...opts, headers: H, signal: AbortSignal.timeout(KFETCH_TIMEOUT) });
    if (r.status === 429 && attempt < 3) {
      const ra = Number(r.headers.get('Retry-After')) * 1000;
      await new Promise(res => setTimeout(res, Math.min(ra || 1000 * Math.pow(2, attempt), 8000)));
      continue;
    }
    return r;
  }
  throw new Error(`Kommo ${label} ${path} HTTP 429 (retries esgotados)`);
}

async function kGet(path) {
  const r = await kommoFetch(path, {}, 'GET');
  if (r.status === 204) return null;
  if (!r.ok) throw new Error(`Kommo GET ${path} HTTP ${r.status}`);
  return r.json();
}

/** GET em massa de leads por id (chunks de 250). custom_fields_values vem por padrao. */
export async function getLeadsByIds(ids) {
  const uniq = [...new Set(ids.map(String))];
  const out = [];
  for (let i = 0; i < uniq.length; i += 250) {
    const qs = uniq.slice(i, i + 250).map(id => `filter[id][]=${encodeURIComponent(id)}`).join('&');
    const r = await kGet(`/leads?${qs}&limit=250`);
    out.push(...(r?._embedded?.leads || []));
  }
  return out;
}

/** PATCH em massa de um campo de varios leads. items: [{id, fieldId, value}] (chunks de 250). */
export async function bulkPatchLeads(items) {
  let updated = 0;
  for (let i = 0; i < items.length; i += 250) {
    const chunk = items.slice(i, i + 250).map(it => ({
      id: Number(it.id),
      custom_fields_values: [{ field_id: Number(it.fieldId), values: [{ value: it.value === '' ? null : String(it.value) }] }],
    }));
    if (!chunk.length) continue;
    const r = await kommoFetch('/leads', { method: 'PATCH', body: JSON.stringify(chunk) }, 'PATCH');
    if (!r.ok) throw new Error(`Kommo bulk PATCH leads HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
    updated += chunk.length;
  }
  return updated;
}

/** GET generico no Kommo (ja com throttle/429-retry). Para paginar contatos/leads. */
export async function kommoGet(path) {
  return kGet(path);
}

/** POST generico no Kommo (throttle/429-retry). Usado p/ criar campo personalizado (assinatura). */
export async function kommoPost(path, body) {
  const r = await kommoFetch(path, { method: 'POST', body: JSON.stringify(body) }, 'POST');
  if (!r.ok) throw new Error(`Kommo POST ${path} HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
}

/** Contato com leads vinculados */
export async function getContact(contactId) {
  return kGet(`/contacts/${contactId}?with=leads`);
}

/** Telefone(s) do contato a partir de custom_fields_values (field_code PHONE) */
export function extractPhones(contact) {
  const out = [];
  for (const f of contact?.custom_fields_values || []) {
    if (f.field_code === 'PHONE') {
      for (const v of f.values || []) out.push(String(v.value || '').replace(/\D/g, ''));
    }
  }
  return out.filter(Boolean);
}

/** Primeiro lead vinculado ao contato (ou null) */
export function firstLeadId(contact) {
  const leads = contact?._embedded?.leads || [];
  return leads.length ? leads[0].id : null;
}

// ===================== FILA DE ESCRITAS KOMMO =====================
// Toda escrita passa pela fila kommo_queue: enfileira -> tenta na hora (drain
// inline); se falhar por 429/erro transitorio, fica pendente e o worker retenta.
// "Melhor ter fila do que falhar." Operacoes diretas abaixo sao executadas pelo
// drain/worker (NAO enfileiram, p/ nao recursar).

async function opLeadField({ leadId, fieldId, value }) {
  const v = (value === '' || value == null) ? null : String(value);
  const r = await kommoFetch(`/leads/${leadId}`, { method: 'PATCH', body: JSON.stringify({ custom_fields_values: [{ field_id: Number(fieldId), values: [{ value: v }] }] }) }, 'PATCH');
  if (!r.ok) throw new Error(`Kommo PATCH lead ${leadId} HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 120)}`);
  return true;
}
async function opContactField({ contactId, fieldId, value }) {
  const v = (value === '' || value == null) ? null : String(value);
  const r = await kommoFetch(`/contacts/${contactId}`, { method: 'PATCH', body: JSON.stringify({ custom_fields_values: [{ field_id: Number(fieldId), values: [{ value: v }] }] }) }, 'PATCH');
  if (!r.ok) throw new Error(`Kommo PATCH contact ${contactId} HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 120)}`);
  return true;
}
async function opLeadMove({ leadId, pipelineId, statusId, fieldId, value }) {
  const body = {};
  if (pipelineId) body.pipeline_id = Number(pipelineId);
  if (statusId) body.status_id = Number(statusId);
  if (fieldId) body.custom_fields_values = [{ field_id: Number(fieldId), values: [{ value: value == null ? null : String(value) }] }];
  const r = await kommoFetch(`/leads/${leadId}`, { method: 'PATCH', body: JSON.stringify(body) }, 'PATCH');
  if (!r.ok) throw new Error(`Kommo move lead ${leadId} HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 120)}`);
  return true;
}
async function opTask({ entityId, entityType, text, hoursFromNow = 24, responsibleUserId = null }) {
  const completeTill = Math.floor(Date.now() / 1000) + hoursFromNow * 3600;
  const body = [{ task_type_id: 1, text: String(text).slice(0, 500), complete_till: completeTill, entity_id: Number(entityId), entity_type: entityType }];
  if (responsibleUserId) body[0].responsible_user_id = Number(responsibleUserId);
  const r = await kommoFetch('/tasks', { method: 'POST', body: JSON.stringify(body) }, 'POST');
  if (!r.ok) throw new Error(`Kommo POST tasks HTTP ${r.status}`);
  return true;
}
async function opSalesbot({ botId, entityId, entityType = 'leads' }) {
  const r = await kommoFetch('/bots/run', { method: 'POST', body: JSON.stringify([{ bot_id: Number(botId), entity_id: Number(entityId), entity_type: entityType }]) }, 'POST');
  if (!r.ok && r.status !== 202) throw new Error(`Kommo bots/run HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return true;
}
async function opNote({ leadId, marker, text }) {
  // a function kommo-note ja e idempotente (checa o marker antes de postar)
  const r = await fetch(`${SELF_URL}/.netlify/functions/kommo-note`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId, marker, text }), signal: AbortSignal.timeout(KFETCH_TIMEOUT),
  });
  if (!r.ok) throw new Error(`kommo-note HTTP ${r.status}`);
  const j = await r.json().catch(() => ({}));
  if (j && j.error) throw new Error(`kommo-note: ${j.error}`);
  return true;
}

// (cobranca 29/06) job COMPOSTO: seta o campo do lead (texto da cobranca) e roda o
// Salesbot no MESMO job — garante a ordem (campo antes do bot) por devedor, sem
// depender de prioridade entre dois jobs separados. fieldId opcional (bot sem variavel).
async function opCobrancaSend({ leadId, fieldId, value, botId }) {
  if (fieldId) await opLeadField({ leadId, fieldId, value });
  await opSalesbot({ botId, entityId: leadId });
  return true;
}

// (assinatura 02/07) 'assinatura_send' e a MESMA operacao composta da cobranca
// (campo do lead + Salesbot no mesmo job) — alias p/ rastreabilidade na fila.
const OPS = { lead_field: opLeadField, contact_field: opContactField, lead_move: opLeadMove, task: opTask, salesbot: opSalesbot, note: opNote, cobranca_send: opCobrancaSend, assinatura_send: opCobrancaSend };

/** Executa a operacao real no Kommo (chamada pelo drain/worker). */
export async function runKommoOp(kind, payload) {
  const fn = OPS[kind];
  if (!fn) throw new Error(`kommo op desconhecida: ${kind}`);
  return fn(payload || {});
}

/** Reivindica e executa UM job agora (drain inline apos enfileirar). */
export async function drainNow(id) {
  const job = await claimById(id);
  if (!job) return { skipped: true };
  try { await runKommoOp(job.kind, job.payload); await complete(job.id); return { ok: true, id }; }
  catch (e) { const st = await fail(job, e.message); return { ok: false, id, status: st, error: e.message }; }
}

/** Enfileira + tenta na hora. Se a fila estiver indisponivel, executa direto (nunca perde). */
async function enqueueAndDrain(kind, payload, { source = 'kommo', dedupeKey = null, priority = 5 } = {}) {
  if (!KOMMO_TOKEN) return { skipped: 'sem token' };
  let job;
  try { job = await enqueue({ kind, payload, source, dedupeKey, priority }); }
  catch { await runKommoOp(kind, payload); return { direct: true }; } // fallback: fila fora do ar
  return drainNow(job.id);
}

/** Enfileira SEM drenar (p/ lotes — o drain em loco causaria burst). */
export async function enqueueKommo(kind, payload, opts = {}) {
  return enqueue({ kind, payload, source: opts.source || 'kommo', dedupeKey: opts.dedupeKey || null, priority: opts.priority || 5 });
}

/** Drena a fila respeitando o rate limit (usado pelo kommo-queue-worker). */
export async function processQueue({ maxMs = 25000, throttleMs = 220 } = {}) {
  const start = Date.now();
  await reclaimStuck(5);
  let done = 0, failed = 0, processed = 0;
  while (Date.now() - start < maxMs) {
    const jobs = await claimBatch(5);
    if (!jobs.length) break;
    for (const job of jobs) {
      try { await runKommoOp(job.kind, job.payload); await complete(job.id); done++; }
      catch (e) { await fail(job, e.message); failed++; }
      processed++;
      if (Date.now() - start > maxMs) break;
      await new Promise(r => setTimeout(r, throttleMs)); // ~4-5 req/s global
    }
  }
  return { processed, done, failed };
}

/** Escreve um campo personalizado no LEAD (via fila). */
export async function setLeadField(leadId, fieldId, value, opts = {}) {
  return enqueueAndDrain('lead_field', { leadId: String(leadId), fieldId: Number(fieldId), value },
    { source: opts.source || 'kommo', dedupeKey: `lead_field:${leadId}:${fieldId}`, priority: opts.priority || 5 });
}

/** Escreve um campo personalizado no CONTATO (via fila). */
export async function setContactField(contactId, fieldId, value, opts = {}) {
  return enqueueAndDrain('contact_field', { contactId: String(contactId), fieldId: Number(fieldId), value },
    { source: opts.source || 'kommo', dedupeKey: `contact_field:${contactId}:${fieldId}`, priority: opts.priority || 5 });
}

/** Move o lead de etapa (+ campo opcional) via fila. */
export async function moveLeadStage(leadId, { pipelineId, statusId, fieldId, value } = {}, opts = {}) {
  return enqueueAndDrain('lead_move', { leadId: String(leadId), pipelineId, statusId, fieldId, value },
    { source: opts.source || 'advbox-sync', dedupeKey: `lead_move:${leadId}`, priority: opts.priority || 4 });
}

/** Dispara um Salesbot (via fila; prioridade alta p/ resposta do bot). */
export async function runSalesbot(botId, entityId, entityType = 'leads', opts = {}) {
  return enqueueAndDrain('salesbot', { botId, entityId, entityType },
    { source: opts.source || 'bot', priority: opts.priority || 1 });
}

/** Cria tarefa no Kommo (via fila). */
export async function createKommoTask(entityId, entityType, text, hoursFromNow = 24, responsibleUserId = null, opts = {}) {
  return enqueueAndDrain('task', { entityId, entityType, text, hoursFromNow, responsibleUserId },
    { source: opts.source || 'bot', priority: opts.priority || 3 });
}

/** Nota idempotente (via fila; kommo-note evita duplicar pelo marker). */
export async function postNote(leadId, marker, text, opts = {}) {
  return enqueueAndDrain('note', { leadId, marker, text },
    { source: opts.source || 'note', dedupeKey: `note:${leadId}:${marker}`, priority: opts.priority || 5 });
}

/** Extrai lead id de link .../leads/detail/{id} (mesmo helper do advbox-sync) */
export function extrairLeadId(input) {
  if (!input) return null;
  const s = String(input);
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/\/leads\/detail\/(\d+)/);
  return m ? m[1] : null;
}

/** Host do link Kommo (p/ separar contas: advocaciacbc x outras) */
export function extrairHostKommo(input) {
  const m = String(input || '').match(/^https?:\/\/([^/]+)/i);
  return m ? m[1].toLowerCase() : null;
}

/** Lista campos personalizados de 'leads' ou 'contacts' (paginado) */
export async function listCustomFields(entity = 'leads') {
  const out = [];
  let page = 1;
  while (page <= 20) {
    const r = await kGet(`/${entity}/custom_fields?limit=250&page=${page}`);
    const items = r?._embedded?.custom_fields || [];
    out.push(...items);
    if (items.length < 250) break;
    page++;
  }
  return out;
}

/** Acha um campo por NOME (case-insensitive) em leads e depois contacts. */
export async function findCustomFieldByName(name) {
  const alvo = String(name || '').trim().toLowerCase();
  for (const entity of ['leads', 'contacts']) {
    const fields = await listCustomFields(entity);
    const f = fields.find(x => String(x.name || '').trim().toLowerCase() === alvo);
    if (f) return { entity, field_id: f.id, type: f.type, name: f.name };
  }
  return null;
}

/** GET de uma entidade (lead/contato) com seus custom_fields_values */
export async function getEntity(entity, id) {
  return kGet(`/${entity}/${id}`);
}

/** Valor atual de um campo personalizado (junta multiplas linhas com \n) */
export function extractFieldValue(entityObj, fieldId) {
  for (const f of entityObj?.custom_fields_values || []) {
    if (Number(f.field_id) === Number(fieldId)) {
      return (f.values || []).map(v => v.value).filter(v => v != null).join('\n');
    }
  }
  return null;
}

/** Id do contato principal de um lead (quando o campo "Asaas" for de contato) */
export async function mainContactOfLead(leadId) {
  const lead = await kGet(`/leads/${leadId}?with=contacts`);
  const contacts = lead?._embedded?.contacts || [];
  const main = contacts.find(c => c.is_main) || contacts[0];
  return main ? main.id : null;
}
