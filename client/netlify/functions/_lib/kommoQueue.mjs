/**
 * Fila compartilhada de escritas no Kommo (tabela kommo_queue). Operacoes puras
 * de banco (sem chamar a API do Kommo) — quem executa a operacao e o kommo.mjs.
 *
 * Modelo: toda escrita Kommo e enfileirada e tentada na hora (drain inline);
 * se falhar por 429/erro transitorio, fica pendente e o worker retenta.
 */
import { db } from './botDb.mjs';

const MAX_ATTEMPTS = 6;
const BACKOFF_SEC = [0, 30, 60, 120, 300, 600]; // por tentativa

const nowIso = () => new Date().toISOString();

/**
 * Enfileira uma operacao. Se houver job PENDENTE com o mesmo dedupe_key, atualiza
 * o payload (o ultimo valor vence) em vez de duplicar. Retorna { id }.
 */
export async function enqueue({ kind, payload = {}, source = null, dedupeKey = null, priority = 5 }) {
  if (dedupeKey) {
    const { data: upd } = await db.from('kommo_queue')
      .update({ payload, source, priority, status: 'pending', run_after: nowIso(), attempts: 0, last_error: null, updated_at: nowIso() })
      .eq('dedupe_key', dedupeKey).eq('status', 'pending').select('id');
    if (upd && upd.length) return { id: upd[0].id, deduped: true };
  }
  const { data, error } = await db.from('kommo_queue')
    .insert({ kind, payload, source, dedupe_key: dedupeKey, priority, status: 'pending', run_after: nowIso() })
    .select('id').single();
  if (error) {
    // corrida no indice de dedupe: ja existe pendente -> atualiza
    if (dedupeKey) {
      const { data: upd2 } = await db.from('kommo_queue')
        .update({ payload, status: 'pending', run_after: nowIso(), attempts: 0, updated_at: nowIso() })
        .eq('dedupe_key', dedupeKey).eq('status', 'pending').select('id');
      if (upd2 && upd2.length) return { id: upd2[0].id, deduped: true };
    }
    throw new Error(`kommo_queue enqueue: ${error.message}`);
  }
  return { id: data.id };
}

/** Reivindica atomicamente UM job pendente pelo id (pending -> processing). */
export async function claimById(id) {
  const { data } = await db.from('kommo_queue')
    .update({ status: 'processing', attempts: 0, updated_at: nowIso() })
    .eq('id', id).eq('status', 'pending').select('*');
  return data && data.length ? data[0] : null;
}

/** Reivindica um lote de jobs prontos (run_after<=agora), do mais urgente ao mais antigo. */
export async function claimBatch(limit = 25) {
  const { data: cand } = await db.from('kommo_queue')
    .select('id').eq('status', 'pending').lte('run_after', nowIso())
    .order('priority', { ascending: true }).order('run_after', { ascending: true }).limit(limit);
  const claimed = [];
  for (const c of cand || []) {
    const { data } = await db.from('kommo_queue')
      .update({ status: 'processing', updated_at: nowIso() })
      .eq('id', c.id).eq('status', 'pending').select('*');
    if (data && data.length) claimed.push(data[0]);
  }
  return claimed;
}

export async function complete(id) {
  await db.from('kommo_queue').update({ status: 'done', done_at: nowIso(), last_error: null, updated_at: nowIso() }).eq('id', id);
}

/** Falhou: reagenda com backoff; esgotou tentativas -> failed. Retorna o novo status. */
export async function fail(job, errMsg) {
  const attempts = (job.attempts || 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await db.from('kommo_queue').update({ status: 'failed', attempts, last_error: String(errMsg).slice(0, 400), updated_at: nowIso() }).eq('id', job.id);
    return 'failed';
  }
  const backoff = BACKOFF_SEC[Math.min(attempts, BACKOFF_SEC.length - 1)];
  await db.from('kommo_queue').update({
    status: 'pending', attempts,
    run_after: new Date(Date.now() + backoff * 1000).toISOString(),
    last_error: String(errMsg).slice(0, 400), updated_at: nowIso(),
  }).eq('id', job.id);
  return 'pending';
}

/** Solta jobs presos em 'processing' ha mais de X min (worker morreu no meio). */
export async function reclaimStuck(minutes = 5) {
  const cutoff = new Date(Date.now() - minutes * 60000).toISOString();
  await db.from('kommo_queue').update({ status: 'pending', updated_at: nowIso() })
    .eq('status', 'processing').lt('updated_at', cutoff);
}

/** Resumo da fila para o painel do Monitor. */
export async function queueStats() {
  const { data: rows } = await db.from('kommo_queue')
    .select('status, source, kind, attempts, run_after, created_at, last_error')
    .in('status', ['pending', 'processing', 'failed'])
    .order('created_at', { ascending: false }).limit(2000);
  const list = rows || [];
  const porStatus = {}, porFonte = {};
  let oldestPending = null;
  for (const r of list) {
    porStatus[r.status] = (porStatus[r.status] || 0) + 1;
    const f = r.source || 'desconhecido';
    porFonte[f] = porFonte[f] || { pending: 0, processing: 0, failed: 0 };
    porFonte[f][r.status] = (porFonte[f][r.status] || 0) + 1;
    if (r.status === 'pending' && (!oldestPending || r.created_at < oldestPending)) oldestPending = r.created_at;
  }
  const falhas = list.filter(r => r.status === 'failed').slice(0, 20)
    .map(r => ({ source: r.source, kind: r.kind, attempts: r.attempts, erro: r.last_error }));
  return { porStatus, porFonte, oldestPending, falhas, total: list.length };
}
