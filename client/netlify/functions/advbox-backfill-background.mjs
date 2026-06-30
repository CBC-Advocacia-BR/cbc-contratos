/**
 * Netlify BACKGROUND Function: advbox-backfill-background
 * Backfill historico do ADVBOX para bot_sync_state, em LOTES ENCADEADOS:
 *
 *  - Fase 1 "andamentos": varre todos os processos (GET /lawsuits paginado) e,
 *    para cada um, puxa o historico COMPLETO (GET /movements/{id}).
 *  - Fase 2 "tarefas": tarefas abertas (GET /posts) + concluidas dos ultimos
 *    12 meses (GET /posts?completed_*), paginadas ate esgotar.
 *
 *  Regras:
 *  - 15 GETs/min no ADVBOX (metade do limite — zero atrito com outras integracoes)
 *  - Itens entram como communicated=true e SEM nota no Kommo (e historico,
 *    nao "novidade"); payload.backfill = true
 *  - Tarefas da lista de ignoradas (bot_config 'monitor') ficam de fora
 *  - Idempotente: unique(kind, item_key) — pode rodar quantas vezes precisar
 *  - Cada lote roda ~12 min e dispara o proximo (fetch em si mesmo).
 *    Pausa: bot_config 'backfill_status'.ativo = false (botao no painel).
 *  - Progresso em bot_config 'backfill_status' (o painel exibe em tempo real)
 *
 * Body opcional: { reset: true } recomeca do zero.
 */
import * as adv from './_lib/advbox.mjs';
import {
  bulkRecordSyncItems, hashKey, getVisibilityConfig, isHiddenFromClient,
  getBackfillStatus, setBackfillStatus, logAdvbox,
} from './_lib/botDb.mjs';

const SELF_URL = process.env.URL || 'https://contratos-cbc.netlify.app';
const BATCH_MS = 12 * 60 * 1000;   // ~12 min por lote (teto da function: 15)
const LAWSUIT_PAGE = 50;
const POST_PAGE = 100;
const MAX_LOTES = 200;             // trava de seguranca do encadeamento

const isoDay = (d) => d.toISOString().slice(0, 10);

function movementRow(lawsuitId, mv, extra = {}) {
  const title = mv.title || '';
  return {
    kind: 'movement',
    item_key: `${lawsuitId}:${mv.date}:${hashKey(title)}`,
    lawsuit_id: lawsuitId,
    process_number: mv.process_number || extra.process_number || null,
    customer_name: typeof mv.customers === 'string' ? mv.customers : (extra.customer_name || null),
    title: title.slice(0, 1000),
    event_date: mv.date || null,
    payload: { header: mv.header || null, backfill: true },
    communicated: true,
    communicated_at: new Date().toISOString(),
  };
}

function taskRows(p, vis) {
  const name = p.task || p.task_name || 'Tarefa';
  // TUDO entra no banco (BI completo); "oculto" so marca o que o cliente nao ve
  const oculto = isHiddenFromClient(name, p.task_id || p.tasks_id || null, vis) || undefined;
  const lawsuitId = p.lawsuits_id || p.lawsuit?.id || null;
  const base = {
    lawsuit_id: lawsuitId,
    process_number: p.lawsuit?.process_number || null,
    customer_name: (p.lawsuit?.customers || []).map(c => c.name).join(', ') || null,
    title: String(name).slice(0, 500),
    communicated: true,
    communicated_at: new Date().toISOString(),
  };
  const rows = [{
    ...base, kind: 'task_created', item_key: `task:${p.id}`, event_date: p.date || null,
    payload: { deadline: p.date_deadline || null, users: (p.users || []).map(u => u.name), backfill: true, oculto },
  }];
  const completedAt = (p.users || []).map(u => u.completed).find(Boolean);
  if (completedAt) {
    rows.push({
      ...base, kind: 'task_completed', item_key: `taskdone:${p.id}`,
      event_date: String(completedAt).slice(0, 10),
      payload: { completed_by: (p.users || []).filter(u => u.completed).map(u => u.name), backfill: true, oculto },
    });
  }
  return { rows, ignored: !!oculto };
}

export default async (req) => {
  let body = {};
  try { body = await req.json(); } catch { /* sem body */ }

  adv.setThrottle(15); // 15 req/min — metade do limite do ADVBOX

  let st = await getBackfillStatus();
  if (body.reset || !st || st.fase === 'concluido') {
    st = await setBackfillStatus({
      fase: 'andamentos', ativo: true, lote: 0,
      processos_total: null, processos_feitos: 0,
      movimentos_gravados: 0, tarefas_gravadas: 0, ignoradas: 0,
      tarefas_offset_abertas: 0, tarefas_offset_concluidas: 0, sub_fase: 'abertas',
      started_at: new Date().toISOString(), erros: [],
    });
  }
  if (!st.ativo) { console.log('[backfill] pausado — saindo'); return new Response('ok'); }
  // TRAVA DE INSTANCIA UNICA: se houve checkpoint ha menos de 3 min, ja existe um
  // lote vivo — religadas manuais/watchdog nao podem criar correntes paralelas
  // (paralelismo dobraria o consumo da API do ADVBOX). O hop da propria corrente
  // passa {chain:true} e nao e bloqueado.
  if (!body.chain && !body.reset && st.updated_at &&
      (Date.now() - new Date(st.updated_at).getTime()) < 3 * 60000) {
    console.log('[backfill] checkpoint recente — ja ha lote em execucao, saindo');
    return new Response('ok');
  }
  if ((st.lote || 0) >= MAX_LOTES) {
    await setBackfillStatus({ ativo: false, erros: [...(st.erros || []), 'trava MAX_LOTES atingida'] });
    return new Response('ok');
  }
  st = await setBackfillStatus({ lote: (st.lote || 0) + 1 });
  console.log(`[backfill] lote ${st.lote} | fase ${st.fase} | feitos ${st.processos_feitos}/${st.processos_total ?? '?'}`);

  const t0 = Date.now();
  const vis = await getVisibilityConfig();
  const erros = [...(st.erros || [])].slice(-20);

  try {
    // ================= FASE 1: ANDAMENTOS =================
    if (st.fase === 'andamentos') {
      let offset = st.processos_feitos || 0;
      let total = st.processos_total;
      while (Date.now() - t0 < BATCH_MS) {
        const { items, totalCount } = await adv.getLawsuitsPage(offset, LAWSUIT_PAGE);
        if (total == null && totalCount != null) total = totalCount;
        if (!items.length) { st = await setBackfillStatus({ fase: 'tarefas', processos_total: total, processos_feitos: offset }); break; }

        const rows = [];
        for (const ls of items) {
          if (Date.now() - t0 >= BATCH_MS) break;
          try {
            const movs = await adv.getMovements(ls.id, 1000);
            const extra = {
              process_number: ls.process_number || null,
              customer_name: (ls.customers || []).map(c => c.name).join(', ') || null,
            };
            for (const mv of movs) rows.push(movementRow(ls.id, mv, extra));
          } catch (e) { erros.push(`mov ${ls.id}: ${e.message}`.slice(0, 120)); await logAdvbox('backfill', 'erro', `movimentos do processo ${ls.id}: ${e.message}`, { lawsuit_id: ls.id }); }
          offset++;
        }
        const inserted = rows.length ? await bulkRecordSyncItems(rows) : 0;
        st = await setBackfillStatus({
          processos_total: total, processos_feitos: offset,
          movimentos_gravados: (st.movimentos_gravados || 0) + inserted,
          erros: erros.slice(-20),
        });
        // recheca pausa a cada pagina
        const fresh = await getBackfillStatus();
        if (!fresh.ativo) { console.log('[backfill] pausado durante o lote'); return new Response('ok'); }
        if (total != null && offset >= total) { st = await setBackfillStatus({ fase: 'tarefas' }); break; }
      }
    }

    // ================= FASE 2: TAREFAS =================
    if (st.fase === 'tarefas') {
      const end = isoDay(new Date());
      const start12m = isoDay(new Date(Date.now() - 365 * 86400000));

      // 2a) abertas
      let off = st.tarefas_offset_abertas || 0;
      while (st.sub_fase === 'abertas' && Date.now() - t0 < BATCH_MS) {
        const { items } = await adv.getPostsPage({ limit: POST_PAGE, offset: off });
        let saved = 0, ign = 0;
        const rows = [];
        for (const p of items) {
          const r = taskRows(p, vis);
          if (r.ignored) ign++; // conta como "oculta do cliente", mas ENTRA no banco
          rows.push(...r.rows);
        }
        saved = rows.length ? await bulkRecordSyncItems(rows) : 0;
        off += items.length;
        st = await setBackfillStatus({
          tarefas_offset_abertas: off, sub_fase: items.length < POST_PAGE ? 'concluidas' : 'abertas',
          tarefas_gravadas: (st.tarefas_gravadas || 0) + saved,
          ignoradas: (st.ignoradas || 0) + ign,
        });
        if (items.length < POST_PAGE) break;
      }

      // 2b) concluidas (12 meses) — FATIADO POR MES: a API do ADVBOX nao pagina
      // alem de ~10.000 registros por janela (HTTP 422 acima disso). Janelas
      // mensais ficam longe do teto; o dedupe absorve qualquer sobreposicao.
      // Janela com erro persistente e PULADA (logada) em vez de re-tentada p/ sempre.
      const anchor = new Date(st.started_at || new Date().toISOString());
      const wins = [];
      for (let m = 12; m >= 0; m--) {
        const ini = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - m, 1));
        const fim = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - m + 1, 0));
        wins.push({ ini: isoDay(ini), fim: isoDay(fim) });
      }
      let wi = st.tc_win_idx || 0;
      off = st.tarefas_offset_concluidas || 0;
      while (st.sub_fase === 'concluidas' && Date.now() - t0 < BATCH_MS) {
        if (wi >= wins.length) {
          await setBackfillStatus({ fase: 'concluido', ativo: false, finished_at: new Date().toISOString(), tc_win_idx: wi });
          await logAdvbox('backfill', 'info', 'Backfill concluído', { lote: st.lote });
          console.log('[backfill] CONCLUIDO 🎉');
          return new Response('ok');
        }
        const w = wins[wi];
        let items = [];
        try {
          ({ items } = await adv.getPostsPage({ limit: POST_PAGE, offset: off, completed_start: w.ini, completed_end: w.fim }));
        } catch (e) {
          erros.push(`janela ${w.ini} off ${off}: ${e.message}`.slice(0, 120));
          await logAdvbox('backfill', 'erro', `janela ${w.ini} offset ${off}: ${e.message}`, { janela: w });
          wi++; off = 0; // pula a janela problematica
          st = await setBackfillStatus({ tc_win_idx: wi, tarefas_offset_concluidas: 0, erros: erros.slice(-20) });
          continue;
        }
        const rows = [];
        let ign = 0;
        for (const p of items) {
          const r = taskRows(p, vis);
          if (r.ignored) ign++; // oculta do cliente, mas ENTRA no banco
          rows.push(...r.rows);
        }
        const saved = rows.length ? await bulkRecordSyncItems(rows) : 0;
        off += items.length;
        if (items.length < POST_PAGE) { wi++; off = 0; } // proxima janela mensal
        st = await setBackfillStatus({
          tc_win_idx: wi, tarefas_offset_concluidas: off,
          tarefas_gravadas: (st.tarefas_gravadas || 0) + saved,
          ignoradas: (st.ignoradas || 0) + ign,
        });
        const fresh = await getBackfillStatus();
        if (!fresh.ativo) return new Response('ok');
      }
    }
  } catch (err) {
    erros.push(`geral: ${err.message}`.slice(0, 150));
    await setBackfillStatus({ erros: erros.slice(-20) });
  }

  // encadeia o proximo lote (se ainda ativo e nao concluido)
  const finalSt = await getBackfillStatus();
  if (finalSt.ativo && finalSt.fase !== 'concluido') {
    try {
      await fetch(`${SELF_URL}/.netlify/functions/advbox-backfill-background`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"chain":true}',
      });
      console.log(`[backfill] lote ${finalSt.lote} encerrado — proximo lote disparado`);
    } catch (e) { console.error('[backfill] falha ao encadear:', e.message); }
  }
  return new Response('ok');
};

export const config = { path: '/.netlify/functions/advbox-backfill-background' };
