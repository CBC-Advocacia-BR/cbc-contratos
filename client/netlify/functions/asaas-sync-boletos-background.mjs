/**
 * Netlify BACKGROUND Function: asaas-sync-boletos-background
 * Espelho de boletos Asaas -> Supabase, sem estourar timeout (15 min) e com
 * auto-encadeamento quando a rodada e maior que o orcamento de tempo.
 *
 * Modos (body JSON):
 *  { mode: 'incremental' }  -> pendentes/vencidos completos + pagos 90d +
 *                              reconciliacao dos abertos nao vistos (padrao)
 *  { mode: 'full' }         -> backfill COMPLETO (todos os status, sem recorte
 *                              de data) + reconciliacao
 *
 * Status em bot_config key 'asaas_sync_status' (painel/monitor) e log central
 * advbox_api_log origem 'asaas' (aparece no Monitor ADVBOX).
 */
import { STATUSES, processBlock, nextBlock, reconcileStaleOpen, mirrorState } from './_lib/asaasMirror.mjs';
import { db, logAdvbox } from './_lib/botDb.mjs';

const TIME_BUDGET_MS = 11.5 * 60 * 1000;
const BASE_URL = process.env.URL || 'https://contratos-cbc.netlify.app';
const SELF = `${BASE_URL}/.netlify/functions/asaas-sync-boletos-background`;

async function setStatus(patch) {
  try {
    const { data } = await db.from('bot_config').select('value').eq('key', 'asaas_sync_status').maybeSingle();
    await db.from('bot_config').upsert({
      key: 'asaas_sync_status',
      value: { ...(data?.value || {}), ...patch },
      updated_at: new Date().toISOString(),
    });
  } catch { /* status nao e critico */ }
}

export default async (req) => {
  const body = await req.json().catch(() => ({}));
  const mode = body.mode === 'full' ? 'full' : 'incremental';
  const chainStart = body.chainStart || new Date().toISOString();
  let cursor = body.cursor || { status: STATUSES[0], offset: 0 };
  const stats = body.stats || { upserts: 0, blocos: 0, erros: 0, reconciliados: 0, elos: 0 };
  stats.elos++;
  const started = Date.now();

  await setStatus({ ativo: true, mode, cursor, stats, heartbeat: new Date().toISOString(), inicio: chainStart });

  try {
    while (cursor) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        // orcamento de tempo esgotado -> encadeia proxima invocacao e encerra
        await setStatus({ cursor, stats, heartbeat: new Date().toISOString() });
        await fetch(SELF, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode, cursor, stats, chainStart }),
        });
        console.log('[asaas-sync] chained at', JSON.stringify(cursor));
        return new Response('chained');
      }
      try {
        const r = await processBlock(cursor.status, cursor.offset, { full: mode === 'full' });
        stats.upserts += r.rows;
        stats.blocos++;
        cursor = nextBlock(cursor.status, cursor.offset, r.hasMore);
        if (stats.blocos % 5 === 0) await setStatus({ cursor, stats, heartbeat: new Date().toISOString() });
      } catch (e) {
        stats.erros++;
        await logAdvbox('asaas', 'erro', `sync boletos ${cursor.status}@${cursor.offset}: ${e.message}`.slice(0, 300), { cursor, mode });
        cursor = nextBlock(cursor.status, cursor.offset, false); // pula para o proximo status
      }
    }

    // reconciliacao: abertos no espelho que a rodada nao viu
    try {
      const rec = await reconcileStaleOpen(chainStart, mode === 'full' ? 400 : 150);
      stats.reconciliados = (stats.reconciliados || 0) + rec.updated;
      if (rec.errors) {
        stats.erros += rec.errors;
        await logAdvbox('asaas', 'aviso', `reconciliação: ${rec.errors} de ${rec.checked} boletos falharam (ficam para a próxima rodada)`, rec);
      }
    } catch (e) {
      stats.erros++;
      await logAdvbox('asaas', 'erro', `reconciliacao: ${e.message}`.slice(0, 300), { mode });
    }

    await mirrorState('boletos_last_sync', new Date().toISOString()).catch(() => {});
    const dur = Math.round((Date.now() - new Date(chainStart).getTime()) / 1000);
    await setStatus({ ativo: false, cursor: null, stats, fim: new Date().toISOString(), duracao_s: dur });
    await logAdvbox('asaas', stats.erros ? 'aviso' : 'info',
      `Espelho de boletos atualizado (${mode}): ${stats.upserts} boletos em ${stats.blocos} páginas, ${stats.reconciliados} reconciliados${stats.erros ? `, ${stats.erros} erro(s)` : ''} — ${dur}s${stats.elos > 1 ? ` em ${stats.elos} elos` : ''}`,
      stats);
    console.log('[asaas-sync] done', JSON.stringify(stats));
    return new Response('ok');
  } catch (err) {
    await setStatus({ ativo: false, erro: err.message, fim: new Date().toISOString() });
    await logAdvbox('asaas', 'erro', `sync boletos abortou: ${err.message}`.slice(0, 300), { mode, cursor });
    console.error('[asaas-sync] fatal', err);
    return new Response('erro', { status: 500 });
  }
};

export const config = { path: '/.netlify/functions/asaas-sync-boletos-background' };
