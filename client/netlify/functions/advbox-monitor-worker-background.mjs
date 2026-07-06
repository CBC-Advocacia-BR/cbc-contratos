/**
 * Netlify BACKGROUND Function: advbox-monitor-worker-background
 * Trabalho pesado do monitor (ate 15 min, 15 GETs/min no ADVBOX):
 *
 *  1. Andamentos: GET /last_movements (janela 3 dias) — PAGINADO ate esgotar
 *  2. Tarefas criadas (abertas) e concluidas: GET /posts — PAGINADO ate esgotar
 *     (dimensionado para o volume real do escritorio: ~5.300 concluidas/mes)
 *  3. Tarefas com nome na lista de ignoradas (bot_config 'monitor'.tarefas_ignoradas)
 *     NAO entram: ex. "ALERTA DE TAREFA EXCLUIDA", "PUBLICACAO TRATADA",
 *     "COMENTARIO", "VERIFICAR INTERNO".
 *  4. Cada item novo vira linha em bot_sync_state (alerta "nao comunicado")
 *  5. Processos mapeados a lead do Kommo ganham NOTA automatica (idempotente)
 *  6. Resumo em bot_config.monitor_status
 */
import * as adv from './_lib/advbox.mjs';
import {
  db, markNotePosted, getLawsuitLeadMap, hashKey,
  getVisibilityConfig, isHiddenFromClient, syncCatalog, logAdvbox,
  bulkUpsertSyncItems,
} from './_lib/botDb.mjs';
import { postNote } from './_lib/kommo.mjs';

const isoDay = (d) => d.toISOString().slice(0, 10);
const PAGE = 100;
const MAX_PAGES = 40; // trava de seguranca (40 paginas x 100 = 4.000 itens por categoria/rodada)

// (perf-be-2) Insercao em LOTE por pagina (1 upsert no lugar de N inserts item-a-item).
// Usa o MESMO upsert idempotente do bulkRecordSyncItems (onConflict kind+item_key,
// ignoreDuplicates), porem devolvendo as linhas inseridas (id+item_key) — assim
// sabemos EXATAMENTE quais itens sao NOVOS de fato e so esses recebem nota Kommo /
// push do portal. Evita duplicar notas: linhas ja existentes nao voltam no select.
async function bulkRecordReturning(items) {
  const novos = new Set();
  if (!items.length) return novos;
  for (let i = 0; i < items.length; i += 500) {
    const chunk = items.slice(i, i + 500);
    const { data, error } = await db.from('bot_sync_state')
      .upsert(chunk, { onConflict: 'kind,item_key', ignoreDuplicates: true })
      .select('item_key');
    if (error) throw new Error(`bot_sync_state bulk: ${error.message}`);
    for (const r of data || []) novos.add(r.item_key);
  }
  return novos;
}

export default async () => {
  const stats = {
    movimentos_novos: 0, tarefas_criadas: 0, tarefas_concluidas: 0,
    ocultas: 0, notas_postadas: 0, paginas: 0, erros: [],
  };
  const started = new Date();
  const novidadesPush = new Set(); // lawsuits com movimento novo -> push do portal
  try {
    const end = isoDay(new Date());
    const start = isoDay(new Date(Date.now() - 3 * 86400000));
    const [leadMap, vis] = await Promise.all([getLawsuitLeadMap(), getVisibilityConfig()]);

    // ---------- 0) CATALOGO: sincroniza etapas/tarefas do ADVBOX ----------
    // Detecta inclusoes/exclusoes de etapas e tipos de tarefa, desativa
    // templates orfaos e alimenta o painel de pendencias de parametrizacao.
    try {
      const settings = await adv.getSettings();
      stats.catalogo = await syncCatalog(settings);
    } catch (e) { stats.erros.push(`catalogo: ${e.message}`); }

    const maybeNote = async (kind, itemKey, lawsuitId, marker, nota) => {
      const leadId = lawsuitId ? leadMap[String(lawsuitId)] : null;
      if (!leadId) return;
      const r = await postNote(leadId, marker, nota);
      if (r?.posted) stats.notas_postadas++;
      await markNotePosted(kind, itemKey, leadId);
    };

    // ---------- 1) ANDAMENTOS (last_movements paginado) ----------
    try {
      let movesCompleto = false;
      for (let off = 0, page = 0; page < MAX_PAGES; off += PAGE, page++) {
        const res = await adv.getLastMovementsPage(start, end, off, PAGE);
        stats.paginas++;
        // (perf-be-2) acumula a pagina e grava em 1 upsert; depois processa SO os novos
        const rows = [], meta = [];
        for (const mv of res) {
          const lawsuitId = mv.lawsuit_id || mv.lawsuits_id;
          const title = mv.title || '';
          const itemKey = `${lawsuitId}:${mv.date}:${hashKey(title)}`;
          rows.push({
            kind: 'movement', item_key: itemKey, lawsuit_id: lawsuitId,
            process_number: mv.process_number || null,
            customer_name: typeof mv.customers === 'string' ? mv.customers : null,
            title: title.slice(0, 1000), event_date: mv.date || null,
            payload: { header: mv.header || null },
          });
          meta.push({ itemKey, lawsuitId, mv, title });
        }
        const novos = await bulkRecordReturning(rows);
        for (const m of meta) {
          if (!novos.has(m.itemKey)) continue; // ja existia -> nada de nota/push
          stats.movimentos_novos++;
          if (m.lawsuitId) novidadesPush.add(Number(m.lawsuitId)); // push do portal (PWA)
          await maybeNote('movement', m.itemKey, m.lawsuitId, `CBC.bot.mov:${hashKey(m.itemKey)}`,
            `⚖️ Novo andamento no processo ${m.mv.process_number || m.lawsuitId} (${m.mv.date}):\n${m.title.slice(0, 600)}\n\nFonte: ${m.mv.header || 'ADVBOX'} — detectado pelo Bot ADVBOX.`);
        }
        if (res.length < PAGE) { movesCompleto = true; break; }
      }
      // (auditoria #81) avisa quando a paginacao de ANDAMENTOS bate no teto sem esgotar
      // — a janela desta rodada ficou incompleta (antes so as tarefas ABERTAS avisavam).
      if (!movesCompleto) {
        await logAdvbox('monitor', 'aviso', `ANDAMENTOS truncados no teto de paginacao (${MAX_PAGES}x${PAGE}=${MAX_PAGES * PAGE}); itens alem do teto entram na proxima rodada.`, { categoria: 'movements', max_pages: MAX_PAGES });
      }
    } catch (e) { stats.erros.push(`movements: ${e.message}`); }

    // ---------- 2) TAREFAS ABERTAS (criadas) — /posts paginado ----------
    // (reconciliacao 02/07/2026) alem de detectar novas, esta secao agora:
    //  a) ATUALIZA data agendada/prazo/responsaveis das ja conhecidas (remarcar
    //     tarefa no ADVBOX passava despercebido — a carga mostrava a data velha);
    //  b) coleta o RETRATO dos ids abertos AGORA (secao 2b) — a Carga Atual do
    //     BI so considera esses (excluidas/concluidas-sem-evento somem).
    const abertas = new Map(); // task_id -> lawsuit_id
    let abertasCompleto = false;
    try {
      for (let off = 0, page = 0; page < MAX_PAGES; off += PAGE, page++) {
        const { items } = await adv.getPostsPage({ limit: PAGE, offset: off });
        stats.paginas++;
        // (perf-be-2) acumula a pagina e grava em 1 upsert; depois processa SO os novos
        const rows = [], meta = [];
        for (const p of items) {
          const name = p.task || p.task_name || 'Tarefa';
          // oculta do cliente: ENTRA no banco (BI), mas sem nota e ja "comunicada"
          const oculta = isHiddenFromClient(name, p.task_id || p.tasks_id || null, vis);
          const lawsuitId = p.lawsuits_id || p.lawsuit?.id || null;
          abertas.set(Number(p.id), lawsuitId ? Number(lawsuitId) : null);
          const itemKey = `task:${p.id}`;
          rows.push({
            kind: 'task_created', item_key: itemKey, lawsuit_id: lawsuitId,
            process_number: p.lawsuit?.process_number || null,
            customer_name: (p.lawsuit?.customers || []).map(c => c.name).join(', ') || null,
            title: String(name).slice(0, 500), event_date: p.date || null,
            // created_at/reward (02/07/2026): base do BI de produtividade (tempo de
            // ciclo real criacao->conclusao e pontos de gamificacao do ADVBOX)
            payload: { deadline: p.date_deadline || null, users: (p.users || []).map(u => u.name), created_at: p.created_at || null, reward: p.reward ?? null, oculto: oculta || undefined },
            // (fix 16/06/2026) sempre enviar communicated/communicated_at. Com o spread
            // condicional o lote ficava heterogeneo e o PostgREST injetava NULL na coluna
            // NOT NULL communicated, estourando o erro e perdendo o lote inteiro.
            communicated: oculta ? true : false,
            communicated_at: oculta ? new Date().toISOString() : null,
          });
          meta.push({ itemKey, lawsuitId, p, name, oculta });
        }
        const novos = await bulkRecordReturning(rows);
        // (reconciliacao a) refresca as JA conhecidas com linhas SLIM — sem
        // communicated/communicated_at, senao novidades antigas reapareceriam
        if (rows.length) {
          await bulkUpsertSyncItems(rows.map(r => ({
            kind: r.kind, item_key: r.item_key, lawsuit_id: r.lawsuit_id,
            process_number: r.process_number, customer_name: r.customer_name,
            title: r.title, event_date: r.event_date, payload: r.payload,
          })));
        }
        for (const m of meta) {
          if (!novos.has(m.itemKey)) continue;
          if (m.oculta) { stats.ocultas = (stats.ocultas || 0) + 1; continue; }
          stats.tarefas_criadas++;
          await maybeNote('task_created', m.itemKey, m.lawsuitId, `CBC.bot.tarefa:${m.p.id}`,
            `📋 Tarefa criada no ADVBOX: ${m.name}\nProcesso: ${m.p.lawsuit?.process_number || m.lawsuitId || '-'}\nPrazo: ${m.p.date_deadline || m.p.date || '-'}\nResponsável: ${(m.p.users || []).map(u => u.name).join(', ') || '-'}\n\n— detectado pelo Bot ADVBOX.`);
        }
        if (items.length < PAGE) { abertasCompleto = true; break; }
      }
    } catch (e) { stats.erros.push(`posts abertas: ${e.message}`); }

    // ---------- 2b) RETRATO das abertas (reconciliacao) ----------
    // Upsert com timestamp da rodada + limpeza do que ficou com timestamp velho:
    // o retrato NUNCA fica vazio no meio do caminho. Se a paginacao truncou em
    // MAX_PAGES, NAO mexe (marcaria como sumida tarefa que so nao foi paginada).
    try {
      if (abertasCompleto && abertas.size) {
        const ids = [...abertas.entries()].map(([task_id, lawsuit_id]) => ({
          task_id, lawsuit_id, atualizado_em: new Date().toISOString(),
        }));
        for (let i = 0; i < ids.length; i += 500) {
          const { error } = await db.from('bot_tarefas_abertas_snapshot')
            .upsert(ids.slice(i, i + 500), { onConflict: 'task_id' });
          if (error) throw new Error(error.message);
        }
        const { error: eDel } = await db.from('bot_tarefas_abertas_snapshot')
          .delete().lt('atualizado_em', started.toISOString());
        if (eDel) throw new Error(eDel.message);
        stats.abertas_snapshot = abertas.size;
      } else if (!abertasCompleto) {
        await logAdvbox('monitor', 'aviso',
          'Retrato de abertas NAO atualizado (paginacao truncada em MAX_PAGES)',
          { paginas: stats.paginas });
      }
    } catch (e) { stats.erros.push(`snapshot abertas: ${e.message}`); }

    // ---------- 3) TAREFAS CONCLUIDAS — /posts?completed_* paginado ----------
    try {
      for (let off = 0, page = 0; page < MAX_PAGES; off += PAGE, page++) {
        const { items } = await adv.getPostsPage({
          limit: PAGE, offset: off, completed_start: start, completed_end: end,
        });
        stats.paginas++;
        // (perf-be-2) acumula a pagina e grava em 1 upsert; depois processa SO os novos
        const rows = [], meta = [];
        for (const p of items) {
          const name = p.task || p.task_name || 'Tarefa';
          const oculta = isHiddenFromClient(name, p.task_id || p.tasks_id || null, vis);
          const completedAt = (p.users || []).map(u => u.completed).find(Boolean);
          if (!completedAt) continue; // sem conclusao registrada -> nao entra no lote
          const lawsuitId = p.lawsuits_id || p.lawsuit?.id || null;
          const itemKey = `taskdone:${p.id}`;
          rows.push({
            kind: 'task_completed', item_key: itemKey, lawsuit_id: lawsuitId,
            process_number: p.lawsuit?.process_number || null,
            customer_name: (p.lawsuit?.customers || []).map(c => c.name).join(', ') || null,
            title: String(name).slice(0, 500), event_date: String(completedAt).slice(0, 10),
            // created_at/reward tambem no evento de conclusao: tarefas criadas e
            // concluidas entre duas rodadas do monitor nunca geram task_created
            payload: { completed_by: (p.users || []).filter(u => u.completed).map(u => u.name), created_at: p.created_at || null, reward: p.reward ?? null, oculto: oculta || undefined },
            // (fix 16/06/2026) idem secao 2: communicated sempre presente (lote homogeneo).
            communicated: oculta ? true : false,
            communicated_at: oculta ? new Date().toISOString() : null,
          });
          meta.push({ itemKey, lawsuitId, p, name, oculta, completedAt });
        }
        const novos = await bulkRecordReturning(rows);
        for (const m of meta) {
          if (!novos.has(m.itemKey)) continue;
          if (m.oculta) { stats.ocultas = (stats.ocultas || 0) + 1; continue; }
          stats.tarefas_concluidas++;
          await maybeNote('task_completed', m.itemKey, m.lawsuitId, `CBC.bot.tarefaok:${m.p.id}`,
            `✅ Tarefa concluída no ADVBOX: ${m.name}\nProcesso: ${m.p.lawsuit?.process_number || m.lawsuitId || '-'}\nConcluída em: ${String(m.completedAt).slice(0, 10)} por ${(m.p.users || []).filter(u => u.completed).map(u => u.name).join(', ') || '-'}\n\n— detectado pelo Bot ADVBOX.`);
        }
        if (items.length < PAGE) break;
      }
    } catch (e) { stats.erros.push(`posts concluidas: ${e.message}`); }
  } catch (err) {
    stats.erros.push(`geral: ${err.message}`);
  }

  // ---------- PUSH do portal (PWA): avisa clientes com novidade ----------
  try {
    if (novidadesPush.size && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      const webpush = (await import('web-push')).default;
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:paulo@advocaciacbc.com',
        process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
      const { data: procs } = await db.from('bi_processos')
        .select('lawsuit_id, clientes, customer_ids').in('lawsuit_id', [...novidadesPush]);
      const { data: subs } = await db.from('portal_push_subs').select('endpoint, sub, token');
      const { data: toks } = await db.from('cliente_portal_tokens')
        .select('token, nome, advbox_customer_id').eq('ativo', true);
      // (portal-8) casa por ID do cliente (nao por nome) p/ nao notificar homonimo.
      const nomePorToken = {}, custPorToken = {};
      for (const t of toks || []) {
        nomePorToken[t.token] = String(t.nome || '').toUpperCase();
        if (t.advbox_customer_id) custPorToken[t.token] = Number(t.advbox_customer_id);
      }
      const idsNovidade = new Set();
      const nomesNovidadeSemId = []; // processos ainda nao indexados (customer_ids null) -> fallback por nome
      for (const p of procs || []) {
        if (Array.isArray(p.customer_ids) && p.customer_ids.length) p.customer_ids.forEach(id => idsNovidade.add(Number(id)));
        else nomesNovidadeSemId.push(String(p.clientes || '').toUpperCase());
      }
      let enviados = 0;
      for (const s of subs || []) {
        const custId = custPorToken[s.token];
        const nome = nomePorToken[s.token];
        const temNovidade = (custId && idsNovidade.has(custId)) || (nome && nomesNovidadeSemId.some(c => c.includes(nome)));
        if (!temNovidade) continue;
        try {
          await webpush.sendNotification(s.sub, JSON.stringify({
            titulo: 'Novidade no seu caso',
            corpo: 'Seu processo teve uma nova movimentação. Toque para ver no portal.',
            url: `/portal?t=${s.token}`,
            tag: `cbc-${started.toISOString().slice(0, 10)}`,
          }));
          enviados++;
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) {
            await db.from('portal_push_subs').delete().eq('endpoint', s.endpoint);
          }
        }
      }
      stats.push_enviados = enviados;
      if (enviados) await logAdvbox('portal', 'info', `📲 ${enviados} notificação(ões) push enviada(s) a clientes com novidade`, { lawsuits: novidadesPush.size });
    }
  } catch (e) { stats.erros.push(`push portal: ${e.message}`.slice(0, 150)); }

  try {
    await db.from('bot_config').upsert({
      key: 'monitor_status',
      value: { last_run: started.toISOString(), duracao_s: Math.round((Date.now() - started.getTime()) / 1000), ...stats },
      updated_at: new Date().toISOString(),
    });
  } catch { /* nao critico */ }

  // log central (painel Monitor): resumo da execucao + cada erro individual
  for (const e of stats.erros) await logAdvbox('monitor', 'erro', e, { run: started.toISOString() });
  await logAdvbox('monitor', stats.erros.length ? 'aviso' : 'info',
    `Sincronização concluída: ${stats.movimentos_novos} andamentos, ${stats.tarefas_criadas + stats.tarefas_concluidas} tarefas, ${stats.notas_postadas} notas Kommo${stats.erros.length ? ` — ${stats.erros.length} erro(s)` : ''}`,
    stats);
  console.log('[advbox-monitor]', JSON.stringify(stats));

  // dispara o snapshot de cadastros (carteira/clientes/financeiro) EM SEQUENCIA
  // — nunca em paralelo com o monitor, para o conjunto respeitar 15 req/min
  try {
    const SELF_URL = process.env.URL || 'https://contratos-cbc.netlify.app';
    await fetch(`${SELF_URL}/.netlify/functions/advbox-snapshot-worker-background`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    console.log('[advbox-monitor] snapshot de cadastros disparado');
  } catch (e) { console.error('[advbox-monitor] falha ao disparar snapshot:', e.message); }

  return new Response('ok');
};

export const config = { path: '/.netlify/functions/advbox-monitor-worker-background' };
