/**
 * ADVBOX Vendas Sync (Fase 6)
 *
 * Cron 3x/dia BRT (06h, 12h, 18h) — em UTC: 09h, 15h, 21h
 *
 * Fluxo:
 *  1. Para cada contrato com `advbox_lawsuit_id` e status 'assinado', pega
 *     o lawsuit detail no ADVBOX e extrai os campos `stage` e `step`.
 *  2. Mapeia (stage, step) -> coluna do kanban via tabela
 *     `vendas_advbox_mapping`. Fallback hardcoded quando nao houver match.
 *  3. Atualiza contrato (advbox_stage, advbox_step, kanban_col).
 *  4. Loga em `automation_log`.
 *
 * Contratos em "Novo Lead" ou "Aguardando Assinatura" ficam parados no seu
 * estado (ainda nao tem advbox_lawsuit_id).
 *
 * Invocavel manualmente via POST para forcar uma rodada.
 */

import { createClient } from '@supabase/supabase-js';

const ADVBOX_TOKEN = process.env.ADVBOX_TOKEN;
const ADVBOX_URL = 'https://app.advbox.com.br/api/v1';
const ADVBOX_HEADERS = {
  'Authorization': `Bearer ${ADVBOX_TOKEN}`,
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (CBC-Vendas-Sync)',
};

const SUPABASE_URL = 'https://vygczeepvoyaehfchxko.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5Z2N6ZWVwdm95YWVoZmNoeGtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMjgxNDYsImV4cCI6MjA4OTcwNDE0Nn0.dFk9CC48V1SlDuFNmtJOkfKf6LSz46aUg6Mpbd7xUjo';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

// Mapeamento fallback caso tabela nao tenha a combinacao
const FALLBACK_MAPPING = {
  'Negociacao': {
    'Fazer Inicial - Operacional': 'enviado_operacional',
    'Documentacao Faltando': 'aguardando_documentos',
    'Revisao Inicial': 'enviado_operacional',
    'EMITIR GUIA ANTES DA DISTRIBUI': 'distribuido',
    'Distribuir Acao': 'distribuido',
  },
  'Judicial': {
    'Aguardando Citacao': 'guia_juntada',
    'Aguardando citacao': 'guia_juntada',
  },
};

function normalize(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[çãáéíóúàèìòùâêîôûü]/g, (c) => ({
      ç: 'c', ã: 'a', á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u',
      à: 'a', è: 'e', ì: 'i', ò: 'o', ù: 'u',
      â: 'a', ê: 'e', î: 'i', ô: 'o', û: 'u', ü: 'u',
    }[c] || c));
}

function mapToKanban(stage, step, mappings) {
  // 1. Match exato
  const direct = mappings.find((m) => m.stage === stage && m.step === step);
  if (direct) return direct.kanban_col;
  // 2. Match normalizado (insensivel a acentos/case)
  const ns = normalize(stage);
  const nst = normalize(step);
  const norm = mappings.find((m) => normalize(m.stage) === ns && normalize(m.step) === nst);
  if (norm) return norm.kanban_col;
  // 3. Match por prefixo/substring no step (tolera step cortado tipo "EMITIR GUIA ANTES DA DISTRIBUI")
  const loose = mappings.find((m) => {
    if (normalize(m.stage) !== ns) return false;
    const ms = normalize(m.step);
    return ms.startsWith(nst) || nst.startsWith(ms);
  });
  if (loose) return loose.kanban_col;
  // 4. Fallback hardcoded
  const fallback = FALLBACK_MAPPING[stage]?.[step];
  if (fallback) return fallback;
  return null;
}

async function fetchLawsuit(id) {
  try {
    const r = await fetch(`${ADVBOX_URL}/lawsuits/${id}`, {
      headers: ADVBOX_HEADERS,
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.data || j;
  } catch {
    return null;
  }
}

async function run() {
  // Carregar mapeamentos
  let mapList = [];
  try {
    const { data: mappings } = await supabase
      .from('vendas_advbox_mapping')
      .select('stage, step, kanban_col');
    mapList = mappings || [];
  } catch {
    mapList = [];
  }

  // Buscar contratos com lawsuit_id e status assinado
  const { data: contratos, error } = await supabase
    .from('contratos')
    .select('id, advbox_lawsuit_id, kanban_col, advbox_stage, advbox_step')
    .eq('status', 'assinado')
    .not('advbox_lawsuit_id', 'is', null);
  if (error) throw new Error(error.message);

  const stats = {
    checked: 0,
    updated: 0,
    no_change: 0,
    unmapped: 0,
    errors: 0,
    fetch_fail: 0,
  };

  for (const c of contratos || []) {
    stats.checked++;
    try {
      const ls = await fetchLawsuit(c.advbox_lawsuit_id);
      if (!ls) {
        stats.fetch_fail++;
        continue;
      }
      const stage = ls.stage || ls.pipeline_stage || ls.stages?.name || '';
      const step = ls.step || ls.pipeline_step || ls.steps?.name || '';

      // Se nao veio nada, tenta campos relacionados
      if (!stage && !step) {
        stats.unmapped++;
        continue;
      }

      const kanbanCol = mapToKanban(stage, step, mapList);

      if (!kanbanCol) {
        stats.unmapped++;
        // Salva stage/step mesmo sem mapeamento para o admin conseguir
        // identificar depois via VendasParametrizacaoPanel
        // Diff guard (06/05/2026): so escreve se mudou — evita audit spam
        if (c.advbox_stage !== stage || c.advbox_step !== step) {
          try {
            await supabase
              .from('contratos')
              .update({ advbox_stage: stage, advbox_step: step })
              .eq('id', c.id);
          } catch { /* ignore */ }
        }
        continue;
      }

      if (
        c.kanban_col === kanbanCol &&
        c.advbox_stage === stage &&
        c.advbox_step === step
      ) {
        stats.no_change++;
        continue;
      }

      // updated_at removido (06/05/2026): trigger BEFORE update_updated_at ja seta
      await supabase
        .from('contratos')
        .update({
          advbox_stage: stage,
          advbox_step: step,
          kanban_col: kanbanCol,
        })
        .eq('id', c.id);
      stats.updated++;

      // Logar
      try {
        await supabase.from('automation_log').insert({
          contract_id: c.id,
          action: 'advbox_vendas_sync',
          status: 'ok',
          details: { stage, step, kanban_col: kanbanCol, previous_col: c.kanban_col },
        });
      } catch { /* nao pode falhar */ }
    } catch (e) {
      stats.errors++;
      try {
        await supabase.from('automation_log').insert({
          contract_id: c.id,
          action: 'advbox_vendas_sync',
          status: 'error',
          details: { error: String(e.message || e).slice(0, 300) },
        });
      } catch { /* ignore */ }
    }
  }

  return stats;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });

  try {
    const stats = await run();
    return new Response(JSON.stringify({ success: true, ...stats }), {
      status: 200,
      headers: CORS,
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: CORS,
    });
  }
};

// 3x/dia BRT (06h, 12h, 18h) em UTC (09h, 15h, 21h)
export const config = { schedule: '0 9,15,21 * * *' };
