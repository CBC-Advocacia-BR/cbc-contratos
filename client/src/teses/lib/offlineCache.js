// Cache offline de modelos aprovados.
//
// Estratégia: sempre que um modelo aprovado é carregado (junto com seus
// blocos e placeholders), guardamos um snapshot em localStorage
// indexado por id. Em caso de falha de rede ou modo offline,
// `loadModelWithFallback` consegue montar a tela de geração a partir
// do cache, sem bater no Supabase.

import { supabase } from './supabaseClient';

const KEY_LIST = 'cbc_teses_cache_models';
const KEY_MODEL = (id) => `cbc_teses_cache_model_${id}`;
const KEY_RESORTS = 'cbc_teses_cache_resorts';
const KEY_TIMESTAMP = 'cbc_teses_cache_ts';

function safeGet(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export function getCachedModelList() { return safeGet(KEY_LIST) || []; }
export function getCachedModel(id) { return safeGet(KEY_MODEL(id)); }
export function getCachedResorts() { return safeGet(KEY_RESORTS) || []; }
export function getCacheTimestamp() { return safeGet(KEY_TIMESTAMP) || null; }

/**
 * Sincroniza o cache local com o Supabase: modelos aprovados + blocos
 * + placeholders + resorts ativos. Chamado ao abrir o app / dashboard.
 */
export async function syncApprovedModelsCache() {
  try {
    const [models, resorts] = await Promise.all([
      supabase.from('models').select('*').eq('status', 'aprovado'),
      supabase.from('resorts').select('id,trade_name,legal_name,cnpj,economic_group,state,category').eq('is_active', true),
    ]);
    if (models.error || !models.data) return false;
    const list = models.data.map((m) => ({ id: m.id, name: m.name, version: m.version, theme_id: m.theme_id }));
    safeSet(KEY_LIST, list);
    safeSet(KEY_RESORTS, resorts.data || []);
    safeSet(KEY_TIMESTAMP, new Date().toISOString());

    // Para cada modelo, carrega blocos + placeholders e salva completo
    for (const m of models.data) {
      const [b, p] = await Promise.all([
        supabase.from('model_blocks').select('*').eq('model_id', m.id).order('display_order'),
        supabase.from('placeholders').select('*').eq('model_id', m.id).order('display_order'),
      ]);
      safeSet(KEY_MODEL(m.id), {
        model: m,
        blocks: b.data || [],
        placeholders: p.data || [],
      });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Carrega modelo com fallback para o cache local.
 * Retorna { source: 'online' | 'cache', model, blocks, placeholders }.
 */
export async function loadModelWithFallback(id) {
  try {
    if (navigator.onLine !== false) {
      const [m, b, p] = await Promise.all([
        supabase.from('models').select('*').eq('id', id).maybeSingle(),
        supabase.from('model_blocks').select('*').eq('model_id', id).order('display_order'),
        supabase.from('placeholders').select('*').eq('model_id', id).order('display_order'),
      ]);
      if (m.data) {
        // Mantém o cache atualizado enquanto estamos online
        safeSet(KEY_MODEL(id), { model: m.data, blocks: b.data || [], placeholders: p.data || [] });
        return { source: 'online', model: m.data, blocks: b.data || [], placeholders: p.data || [] };
      }
    }
  } catch { /* cai no cache */ }
  const cached = getCachedModel(id);
  if (cached) return { source: 'cache', ...cached };
  return null;
}

export function clearOfflineCache() {
  const list = getCachedModelList();
  for (const m of list) localStorage.removeItem(KEY_MODEL(m.id));
  localStorage.removeItem(KEY_LIST);
  localStorage.removeItem(KEY_RESORTS);
  localStorage.removeItem(KEY_TIMESTAMP);
}
