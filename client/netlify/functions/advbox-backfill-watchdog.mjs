/**
 * Scheduled: advbox-backfill-watchdog (a cada 15 min)
 * Deploys do Netlify matam funcoes background em execucao — se isso acontecer
 * no meio de um lote do backfill, o encadeamento para silenciosamente.
 * Este vigia religa o backfill quando ele esta ATIVO mas sem progresso ha
 * mais de 20 min (o cursor salvo garante que retoma do ponto exato).
 * Custo quando nao ha backfill rodando: 1 leitura no Supabase e nada mais.
 */
import { getBackfillStatus } from './_lib/botDb.mjs';

const SELF_URL = process.env.URL || 'https://contratos-cbc.netlify.app';
const STALE_MIN = 20;

export default async () => {
  try {
    const st = await getBackfillStatus();
    if (!st || !st.ativo || st.fase === 'concluido') return new Response('ok (nada a fazer)');
    const idleMin = (Date.now() - new Date(st.updated_at).getTime()) / 60000;
    if (idleMin < STALE_MIN) return new Response(`ok (rodando, ${Math.round(idleMin)} min desde o ultimo checkpoint)`);
    console.log(`[watchdog] backfill parado ha ${Math.round(idleMin)} min (lote ${st.lote}, fase ${st.fase}) — religando`);
    await fetch(`${SELF_URL}/.netlify/functions/advbox-backfill-background`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
  } catch (e) {
    console.error('[watchdog] erro:', e.message);
  }
  return new Response('ok');
};

export const config = {
  // 30 em 30 min (economia): sem backfill ativo, a execucao e instantanea
  // (1 leitura no banco e sai). Com backfill ativo, religa em ate 30 min.
  schedule: '*/30 * * * *',
};
