/**
 * ADVBOX Create Task (Fase 6)
 *
 * Chamado quando a vendedora marca "guia juntada na pasta" no drawer do
 * VendasPanel. Cria task (post) no ADVBOX atribuida ao operacional pedindo
 * para juntar a guia aos autos do processo.
 *
 * Payload:
 *  {
 *    contractId: string,         // uuid do contrato (opcional, usado para log)
 *    lawsuitId: number | string, // id do lawsuit ADVBOX (obrigatorio)
 *    taskType: 'juntar_guia' | 'custom',
 *    customText?: string         // usado quando taskType === 'custom'
 *  }
 *
 * Resposta:
 *  { success: true, taskId, task }
 *  ou { success: false, error }
 */

import { createClient } from '@supabase/supabase-js';

const ADVBOX_TOKEN = process.env.ADVBOX_TOKEN;
const ADVBOX_URL = 'https://app.advbox.com.br/api/v1';

const SUPABASE_URL = 'https://vygczeepvoyaehfchxko.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5Z2N6ZWVwdm95YWVoZmNoeGtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMjgxNDYsImV4cCI6MjA4OTcwNDE0Nn0.dFk9CC48V1SlDuFNmtJOkfKf6LSz46aUg6Mpbd7xUjo';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// ID do operacional no ADVBOX — default: PAULO CONFORTO (241495)
// Configuravel via env var ADVBOX_OPERACIONAL_USER_ID se quiser trocar sem redeploy.
const OPERACIONAL_USER_ID = Number(process.env.ADVBOX_OPERACIONAL_USER_ID) || 241495;

// Guardian: impede invocacao duplicada se a mesma guia ja tem task registrada.
// Lock curto em memoria (melhor esforco — nao protege entre instancias do netlify).
const recentCalls = new Map();
const DEDUP_WINDOW_MS = 10000; // 10s

function dedupKey(lawsuitId, taskType) {
  return `${lawsuitId}::${taskType}`;
}

function pruneDedup() {
  const now = Date.now();
  for (const [k, t] of recentCalls.entries()) {
    if (now - t > DEDUP_WINDOW_MS) recentCalls.delete(k);
  }
}

const TASK_TEMPLATES = {
  juntar_guia: {
    task: 'JUNTAR GUIA NO PROCESSO',
    description:
      'Guia de custas paga pelo cliente. Vendedora salvou comprovante na pasta. Juntar aos autos.',
    priority: 1,
    diasPrazo: 2,
  },
};

function toYMD(d) {
  return d.toISOString().slice(0, 10);
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: CORS });
  }

  try {
    const body = await req.json();
    const { contractId, lawsuitId, taskType = 'juntar_guia', customText } = body;

    if (!lawsuitId) {
      return new Response(JSON.stringify({ error: 'lawsuitId required' }), {
        status: 400,
        headers: CORS,
      });
    }

    // Dedup curto
    pruneDedup();
    const key = dedupKey(lawsuitId, taskType);
    if (recentCalls.has(key)) {
      return new Response(
        JSON.stringify({ success: false, error: 'duplicate_call', dedup: true }),
        { status: 409, headers: CORS }
      );
    }
    recentCalls.set(key, Date.now());

    const tpl = TASK_TEMPLATES[taskType] || {
      task: taskType || 'TASK CBC',
      description: customText || '',
      priority: 1,
      diasPrazo: 2,
    };

    const dueDate = toYMD(new Date(Date.now() + (tpl.diasPrazo || 2) * 24 * 3600 * 1000));

    // Payload para /posts (endpoint de tasks/comunicacoes no ADVBOX).
    // Nota: a API ADVBOX para posts aceita os campos abaixo com variacoes —
    // se algum falhar, a estrutura vira visivel no log (automation_log).
    const payload = {
      lawsuit_id: lawsuitId,
      task: tpl.task,
      description: tpl.description,
      responsible_user_id: OPERACIONAL_USER_ID,
      users_id: OPERACIONAL_USER_ID,
      date: dueDate,
      due_date: dueDate,
      priority: tpl.priority || 1,
    };

    const resp = await fetch(`${ADVBOX_URL}/posts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ADVBOX_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (CBC-Vendas-Task)',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    const raw = await resp.text();
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      result = { raw };
    }

    if (!resp.ok) {
      const errStr = typeof result === 'string' ? result : JSON.stringify(result).slice(0, 300);
      // Log de erro
      if (contractId) {
        try {
          await supabase.from('automation_log').insert({
            contract_id: contractId,
            action: 'advbox_create_task',
            status: 'error',
            details: { taskType, lawsuitId, http_status: resp.status, error: errStr },
          });
        } catch { /* ignore */ }
      }
      throw new Error(`ADVBOX erro ${resp.status}: ${errStr}`);
    }

    const taskId = result?.data?.id || result?.id || result?.posts_id || null;

    // Atualizar guia com task_id
    if (contractId) {
      try {
        await supabase
          .from('vendas_guias_custas')
          .update({ advbox_task_id: taskId ? String(taskId) : null })
          .eq('contrato_id', contractId);
      } catch { /* ignore */ }

      try {
        await supabase.from('automation_log').insert({
          contract_id: contractId,
          action: 'advbox_create_task',
          status: 'ok',
          details: { taskType, taskId, lawsuitId, task: tpl.task },
        });
      } catch { /* ignore */ }
    }

    return new Response(
      JSON.stringify({ success: true, taskId, task: tpl.task, description: tpl.description }),
      { status: 200, headers: CORS }
    );
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: CORS,
    });
  }
};

export const config = { path: '/.netlify/functions/advbox-create-task' };
