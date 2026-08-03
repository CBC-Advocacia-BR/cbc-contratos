/**
 * Fila compartilhada de escritas no Kommo (tabela kommo_queue). Operacoes puras
 * de banco (sem chamar a API do Kommo) — quem executa a operacao e o kommo.mjs.
 *
 * Modelo: toda escrita Kommo e enfileirada e tentada na hora (drain inline);
 * se falhar por 429/erro transitorio, fica pendente e o worker retenta.
 */
import { db } from './botDb.mjs';
import { ehErroTerminal, leadIdAlvo } from './kommoTerminal.mjs';

const MAX_ATTEMPTS = 6;
const BACKOFF_SEC = [0, 30, 60, 120, 300, 600]; // por tentativa

const nowIso = () => new Date().toISOString();

// ===================== LEADS MORTOS (erro terminal) =====================
// (02/08/2026) O Kommo devolve erro 226 ao postar nota num lead que NAO EXISTE mais
// (apagado ou mesclado na UI) — o equivalente do "Lead not found" do PATCH. Isso nunca
// se resolve sozinho: os 6 retries eram desperdicio (271 jobs x 6 = ~1.600 chamadas
// inuteis entre 19/06 e 02/08). Pior: o monitor cria um job NOVO por andamento/tarefa,
// entao a fila voltava a encher todo dia. Registramos o lead e barramos na entrada.

// Cache por instancia: o monitor chama enqueue dezenas de vezes por rodada e nao vale
// uma consulta por job. TTL curto p/ o lead voltar a funcionar logo apos alguem corrigir
// o linkKommo do contrato (a correcao apaga a linha desta tabela).
let _mortosCache = null;
let _mortosCacheAt = 0;
const MORTOS_TTL_MS = 60000;

async function leadsMortos() {
  if (_mortosCache && Date.now() - _mortosCacheAt < MORTOS_TTL_MS) return _mortosCache;
  try {
    const { data, error } = await db.from('kommo_leads_mortos').select('lead_id');
    // tabela ausente / sem permissao -> conjunto vazio: na duvida NAO bloqueia trabalho
    // legitimo (seguro de deployar antes da migracao).
    if (error) return _mortosCache || new Set();
    _mortosCache = new Set((data || []).map((r) => String(r.lead_id)));
    _mortosCacheAt = Date.now();
    return _mortosCache;
  } catch { return _mortosCache || new Set(); }
}

// O erro do Kommo ECOA o corpo da nota em source.text — e a nota traz nome de cliente e
// numero de processo. Guardamos so a parte diagnostica (codigo/element_id), cortando fora
// o texto: esta tabela nao precisa de dado do cliente p/ cumprir a funcao dela.
function detalheSemPii(detalhe) {
  return String(detalhe || '').split('"text"')[0].slice(0, 300);
}

/** Marca o lead como inexistente no Kommo. Best-effort: nunca derruba o job. */
export async function registrarLeadMorto(leadId, motivo, detalhe) {
  if (!leadId) return;
  try {
    // primeiro_erro fica de fora do upsert de proposito: no UPDATE ele preserva a data
    // original (so o INSERT usa o default), entao a linha guarda ha quanto tempo o lead
    // esta morto — que e o numero que interessa a quem for corrigir o contrato.
    await db.from('kommo_leads_mortos').upsert({
      lead_id: String(leadId),
      motivo: motivo || 'lead_inexistente',
      ultimo_erro: nowIso(),
      detalhe: detalheSemPii(detalhe),
    }, { onConflict: 'lead_id' });
    if (_mortosCache) _mortosCache.add(String(leadId));
  } catch { /* best-effort */ }
}

/**
 * Enfileira uma operacao. Se houver job PENDENTE com o mesmo dedupe_key, atualiza
 * o payload (o ultimo valor vence) em vez de duplicar. Retorna { id }.
 */
export async function enqueue({ kind, payload = {}, source = null, dedupeKey = null, priority = 5 }) {
  // (02/08/2026) porta de entrada: nao aceita trabalho para lead que ja se sabe morto.
  // Sem esta trava a fila enche de novo sozinha todo dia, mesmo com o retry corrigido.
  const alvo = leadIdAlvo(kind, payload);
  if (alvo && (await leadsMortos()).has(alvo)) {
    return { skipped: true, motivo: 'lead_inexistente', leadId: alvo };
  }
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
  // (auditoria 01/08 — item 105) NAO zerar `attempts` aqui. A versao anterior gravava
  // attempts:0 ao reivindicar, apagando o historico de falhas do job: o teto de
  // MAX_ATTEMPTS nunca era alcancado por este caminho e um job quebrado podia girar
  // indefinidamente sem nunca virar 'failed' (e portanto sem nunca gerar alerta).
  const { data } = await db.from('kommo_queue')
    .update({ status: 'processing', updated_at: nowIso() })
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
  // (02/08/2026) erro TERMINAL: o alvo nao existe mais no Kommo. Nao adianta backoff nem
  // as 6 tentativas — morre agora, com o motivo legivel no painel, e o lead vai para a
  // lista de mortos p/ nem entrar na fila da proxima vez.
  const { terminal, motivo } = ehErroTerminal(errMsg);
  if (terminal) {
    const alvo = leadIdAlvo(job.kind, job.payload);
    if (alvo) await registrarLeadMorto(alvo, motivo, errMsg);
    await db.from('kommo_queue').update({
      status: 'failed', attempts,
      last_error: `[terminal:${motivo}] ${String(errMsg)}`.slice(0, 400),
      updated_at: nowIso(),
    }).eq('id', job.id);
    return 'failed';
  }
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
  // (auditoria 01/08 — item 105) A versao anterior devolvia o job para 'pending' SEM
  // contar a tentativa. Um job que sempre estoura o tempo da function (o "job veneno")
  // voltava para a fila para sempre: nunca chegava a MAX_ATTEMPTS, nunca virava
  // 'failed' e por isso nunca disparava o alerta critico — so aparecia como "pendente
  // antigo", que e apenas um aviso. Agora cada resgate CONTA como tentativa, entao o
  // job problematico acaba parando em 'failed' e sendo reportado.
  const { data: presos } = await db.from('kommo_queue')
    .select('id, attempts')
    .eq('status', 'processing').lt('updated_at', cutoff);
  for (const job of presos || []) {
    await fail(job, `preso em processing por mais de ${minutes} min (worker morreu no meio)`);
  }
  return (presos || []).length;
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
