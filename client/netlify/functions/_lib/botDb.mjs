/**
 * Acesso Supabase das functions do Bot (mesmo padrao do datajud-refresh:
 * anon key — apertar quando SUPABASE_SERVICE_ROLE_KEY existir no Netlify).
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://vygczeepvoyaehfchxko.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5Z2N6ZWVwdm95YWVoZmNoeGtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMjgxNDYsImV4cCI6MjA4OTcwNDE0Nn0.dFk9CC48V1SlDuFNmtJOkfKf6LSz46aUg6Mpbd7xUjo';

export const db = createClient(SUPABASE_URL, SUPABASE_KEY);

/** bot_config inteiro como objeto { key: value } */
export async function getConfig() {
  const { data, error } = await db.from('bot_config').select('key, value');
  if (error) throw new Error(`bot_config: ${error.message}`);
  const cfg = {};
  for (const row of data || []) cfg[row.key] = row.value || {};
  return cfg;
}

export async function getStageTemplates() {
  const { data } = await db.from('bot_stage_templates').select('*').eq('active', true);
  return data || [];
}

export async function getTaskTemplates() {
  const { data } = await db.from('bot_task_templates').select('*').eq('active', true);
  return data || [];
}

export async function getGlossary() {
  const { data } = await db.from('bot_glossary').select('*').eq('active', true)
    .order('priority', { ascending: true });
  return data || [];
}

export async function getIntents() {
  const { data } = await db.from('bot_intents').select('*').eq('active', true)
    .order('priority', { ascending: true });
  return data || [];
}

export async function findTesterByPhone(phoneDigits) {
  // tolera variacoes com/sem DDI e com/sem o 9
  const d = String(phoneDigits || '').replace(/\D/g, '');
  if (!d) return null;
  const { data } = await db.from('bot_testers').select('*').eq('active', true);
  for (const t of data || []) {
    const td = String(t.phone || '').replace(/\D/g, '');
    if (!td) continue;
    if (td === d || td.endsWith(d) || d.endsWith(td)) return t;
    // variante sem o nono digito
    const strip9 = (x) => (x.length === 13 && x.startsWith('55')) ? x.slice(0, 4) + x.slice(5) : x;
    if (strip9(td) === strip9(d)) return t;
  }
  return null;
}

export async function updateTester(id, patch) {
  await db.from('bot_testers').update(patch).eq('id', id);
}

/** Estado de conversa por canal ('sim:<uuid>' | 'wa:<phone>'). TTL de 30 min. */
export async function getConversation(channel) {
  const { data } = await db.from('bot_conversations').select('*').eq('channel', channel).maybeSingle();
  if (!data) return null;
  const ageMin = (Date.now() - new Date(data.updated_at).getTime()) / 60000;
  if (ageMin > 30) {
    // contexto expirado — zera awaiting mas mantem cliente
    data.context = { ...(data.context || {}), awaiting: null, options: null };
  }
  return data;
}

export async function upsertConversation(channel, fields) {
  const { data } = await db.from('bot_conversations')
    .upsert({ channel, ...fields, updated_at: new Date().toISOString() }, { onConflict: 'channel' })
    .select().single();
  return data;
}

export async function logMessage(conversationId, direction, text, intent = null, meta = {}) {
  if (!conversationId) return;
  await db.from('bot_messages').insert({ conversation_id: conversationId, direction, text: String(text || '').slice(0, 8000), intent, meta });
}

/** Insere novidade se ainda nao vista. Retorna true se for nova. */
export async function recordSyncItem(item) {
  const { error } = await db.from('bot_sync_state').insert(item);
  if (!error) return true;
  if (String(error.code) === '23505') return false; // ja existia (unique kind+item_key)
  throw new Error(`bot_sync_state: ${error.message}`);
}

/** Hash deterministico usado nas item_keys (mesma formula no monitor e no backfill!) */
export function hashKey(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/** Insercao em massa idempotente (ignora duplicatas). Retorna qtd inserida de fato. */
export async function bulkRecordSyncItems(items) {
  let inserted = 0;
  for (let i = 0; i < items.length; i += 500) {
    const chunk = items.slice(i, i + 500);
    const { data, error } = await db.from('bot_sync_state')
      .upsert(chunk, { onConflict: 'kind,item_key', ignoreDuplicates: true })
      .select('id');
    if (error) throw new Error(`bot_sync_state bulk: ${error.message}`);
    inserted += (data || []).length;
  }
  return inserted;
}

/** Lista de termos de tarefas ignoradas (bot_config 'monitor'). Match: contem, sem acento. */
export async function getIgnoredTaskTerms() {
  const { data } = await db.from('bot_config').select('value').eq('key', 'monitor').maybeSingle();
  const arr = data?.value?.tarefas_ignoradas;
  return Array.isArray(arr) && arr.length ? arr : [
    'alerta de tarefa excluida', 'publicacao tratada', 'comentario', 'verificar interno',
  ];
}
const _norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function isIgnoredTask(name, terms) {
  const n = _norm(name);
  return terms.some(t => n.includes(_norm(t)));
}

/**
 * Config de VISIBILIDADE para o cliente. Tudo vai para o banco/BI;
 * o que estiver "oculto" apenas nao aparece para o cliente:
 *  - nao entra nas respostas do bot
 *  - nao vira nota no Kommo
 *  - nao gera alerta de "novidade nao comunicada"
 * Duas camadas: flag por tipo (bot_task_templates.ocultar_cliente, editavel no
 * painel) + termos automaticos (bot_config.monitor.tarefas_ignoradas \u2014 cobre
 * tarefas de sistema que nao existem no catalogo, ex. COMENTARIO).
 */
export async function getVisibilityConfig() {
  const [terms, { data: tt }, { data: st }] = await Promise.all([
    getIgnoredTaskTerms(),
    db.from('bot_task_templates').select('task_id, task_name, ocultar_cliente'),
    db.from('bot_stage_templates').select('stages_id, ocultar_cliente'),
  ]);
  return {
    terms,
    hiddenTaskIds: new Set((tt || []).filter(t => t.ocultar_cliente).map(t => Number(t.task_id))),
    hiddenTaskNames: new Set((tt || []).filter(t => t.ocultar_cliente).map(t => _norm(t.task_name))),
    hiddenStageIds: new Set((st || []).filter(s => s.ocultar_cliente).map(s => Number(s.stages_id))),
  };
}
export function isHiddenFromClient(name, taskId, vis) {
  if (taskId && vis.hiddenTaskIds.has(Number(taskId))) return true;
  const n = _norm(name);
  if (n && vis.hiddenTaskNames.has(n)) return true;
  return vis.terms.some(t => n.includes(_norm(t)));
}

/** Catalogo de etapas/tarefas do ADVBOX (bot_config 'catalogo') */
export async function getCatalog() {
  const { data } = await db.from('bot_config').select('value').eq('key', 'catalogo').maybeSingle();
  return data?.value || null;
}
export async function setCatalog(value) {
  await db.from('bot_config').upsert({ key: 'catalogo', value, updated_at: new Date().toISOString() });
}

/**
 * Sincroniza o catalogo com o GET /settings do ADVBOX:
 *  - detecta etapas/tarefas NOVAS e REMOVIDAS (guarda por 30 dias p/ exibir no painel)
 *  - desativa automaticamente templates de itens removidos
 * Retorna stats { etapas_novas, etapas_removidas, tarefas_novas, tarefas_removidas }.
 */
export async function syncCatalog(settings) {
  const d = settings?.data || settings || {};
  const stages = (d.stages || []).map(s => ({ id: s.id, name: s.stage || s.name || `Etapa ${s.id}`, group: s.step || '' }));
  const tasks = (d.tasks || []).map(t => ({ id: t.id, name: t.task || t.name || `Tarefa ${t.id}` }));
  const prev = await getCatalog();
  const now = new Date().toISOString();
  const cutoff = Date.now() - 30 * 86400000;
  const prune = (arr) => (arr || []).filter(x => new Date(x.em).getTime() > cutoff);

  const diff = (atual, antigo) => {
    const oldIds = new Set((antigo || []).map(x => x.id));
    const newIds = new Set(atual.map(x => x.id));
    return {
      novas: atual.filter(x => !oldIds.has(x.id)).map(x => ({ ...x, em: now })),
      removidas: (antigo || []).filter(x => !newIds.has(x.id)).map(x => ({ ...x, em: now })),
    };
  };

  let nov = { etapas_novas: [], etapas_removidas: [], tarefas_novas: [], tarefas_removidas: [] };
  if (prev?.stages?.length) {
    const de = diff(stages, prev.stages);
    const dt = diff(tasks, prev.tasks);
    nov = {
      etapas_novas: prune([...(prev.novidades?.etapas_novas || []), ...de.novas]),
      etapas_removidas: prune([...(prev.novidades?.etapas_removidas || []), ...de.removidas]),
      tarefas_novas: prune([...(prev.novidades?.tarefas_novas || []), ...dt.novas]),
      tarefas_removidas: prune([...(prev.novidades?.tarefas_removidas || []), ...dt.removidas]),
    };
    // desativa templates de itens removidos do ADVBOX (auto-limpeza)
    if (de.removidas.length) {
      await db.from('bot_stage_templates').update({ active: false, updated_at: now })
        .in('stages_id', de.removidas.map(x => x.id));
    }
    if (dt.removidas.length) {
      await db.from('bot_task_templates').update({ active: false, updated_at: now })
        .in('task_id', dt.removidas.map(x => x.id));
    }
  }
  await setCatalog({ stages, tasks, synced_at: now, novidades: nov });
  return {
    etapas_novas: nov.etapas_novas.length, etapas_removidas: nov.etapas_removidas.length,
    tarefas_novas: nov.tarefas_novas.length, tarefas_removidas: nov.tarefas_removidas.length,
  };
}

/**
 * Log central das integracoes ADVBOX (tabela advbox_api_log — visivel no
 * painel Monitor). Fire-and-forget: NUNCA derruba o worker que loga.
 * nivel: 'erro' | 'aviso' | 'info'
 */
export async function logAdvbox(origem, nivel, mensagem, contexto = {}) {
  try {
    await db.from('advbox_api_log').insert({
      origem, nivel, mensagem: String(mensagem).slice(0, 500), contexto,
    });
  } catch { /* log nunca pode quebrar o fluxo */ }
}

/** Status do backfill (bot_config 'backfill_status') */
export async function getBackfillStatus() {
  const { data } = await db.from('bot_config').select('value').eq('key', 'backfill_status').maybeSingle();
  return data?.value || null;
}
export async function setBackfillStatus(patch) {
  const cur = (await getBackfillStatus()) || {};
  const value = { ...cur, ...patch, updated_at: new Date().toISOString() };
  await db.from('bot_config').upsert({ key: 'backfill_status', value, updated_at: new Date().toISOString() });
  return value;
}

export async function markNotePosted(kind, itemKey, leadId) {
  await db.from('bot_sync_state').update({ kommo_note_posted: true, kommo_lead_id: leadId })
    .eq('kind', kind).eq('item_key', itemKey);
}

export async function markCommunicated(lawsuitId) {
  await db.from('bot_sync_state')
    .update({ communicated: true, communicated_at: new Date().toISOString() })
    .eq('lawsuit_id', lawsuitId).eq('communicated', false);
}

/** Cache de traducao por IA */
export async function getAiCache(hash) {
  const { data } = await db.from('bot_ai_cache').select('translation').eq('hash', hash).maybeSingle();
  return data?.translation || null;
}
export async function setAiCache(hash, source, translation) {
  await db.from('bot_ai_cache').upsert({ hash, source: source.slice(0, 2000), translation: translation.slice(0, 2000) });
}

/** Mapa advbox_lawsuit_id -> kommo lead id (via tabela contratos).
 * (perf-be-14) prefere a coluna enxuta kommo_lead_id; abre o JSON dos contratantes
 * apenas para contratos ainda nao backfillados (kommo_lead_id null). */
export async function getLawsuitLeadMap() {
  const { data } = await db.from('contratos')
    .select('advbox_lawsuit_id, kommo_lead_id, contratantes:dados->contratantes')
    .not('advbox_lawsuit_id', 'is', null);
  const map = {};
  for (const row of data || []) {
    if (row.kommo_lead_id) { map[String(row.advbox_lawsuit_id)] = Number(row.kommo_lead_id); continue; }
    const link = (row.contratantes || []).map(c => c?.linkKommo).find(Boolean);
    const m = String(link || '').match(/\/leads\/detail\/(\d+)/);
    if (m) map[String(row.advbox_lawsuit_id)] = Number(m[1]);
  }
  return map;
}

/** (observ-2) batimento de cron: cada robo grava ao terminar. */
export async function heartbeat(job, ok = true, detail = null) {
  try {
    await db.from('cron_heartbeat').upsert(
      { job, last_run_at: new Date().toISOString(), ok, detail: detail ? String(detail).slice(0, 300) : null, updated_at: new Date().toISOString() },
      { onConflict: 'job' });
  } catch { /* heartbeat nunca quebra o cron */ }
}

/** (observ-14) registra uma checagem de saude de servico no historico. */
export async function recordHealth(rows) {
  try {
    const arr = (Array.isArray(rows) ? rows : [rows]).filter(Boolean).map(r => ({
      service: String(r.service || '').slice(0, 60), ok: !!r.ok,
      latency_ms: Number.isFinite(r.latency_ms) ? Math.round(r.latency_ms) : null,
      detail: r.detail ? String(r.detail).slice(0, 300) : null,
    }));
    if (arr.length) await db.from('health_history').insert(arr);
  } catch { /* nao quebra o probe */ }
}

/**
 * Extrato financeiro do cliente (espelho Asaas) via RPC security definer —
 * asaas_boletos e restrita ao role authenticated; o segredo BOT_RPC_SECRET
 * destrava a leitura apenas para as functions do servidor.
 * Retorna { qtd_pagos, total_pago, qtd_pendentes, total_pendente,
 *           qtd_atrasados, ultimo_pago, proxima } ou null.
 */
export async function getExtrato(advboxCustomerId) {
  if (!advboxCustomerId || !process.env.BOT_RPC_SECRET) return null;
  const { data, error } = await db.rpc('bot_extrato', {
    p_chave: process.env.BOT_RPC_SECRET,
    p_customer_id: Number(advboxCustomerId),
  });
  if (error) { await logAdvbox('bot', 'erro', `bot_extrato: ${error.message}`, { customer: advboxCustomerId }); return null; }
  return data || null;
}

/** Metricas do bot (item 37): taxa de resolucao, intencoes, top perguntas... */
export async function getBotMetricas(dias = 30) {
  const { data, error } = await db.rpc('bot_metricas', { p_dias: Number(dias) || 30 });
  if (error) throw new Error(`bot_metricas: ${error.message}`);
  return data;
}
