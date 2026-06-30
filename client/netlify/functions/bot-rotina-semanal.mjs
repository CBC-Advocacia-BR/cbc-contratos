/**
 * Netlify Scheduled Function: bot-rotina-semanal (#17 + #48)
 * Segunda-feira 7h BRT:
 *  1. Perguntas sem resposta da semana (intent=fallback) → aviso no Monitor
 *     com as mais frequentes — backlog automático de melhoria do bot.
 *  2. Retrato semanal do diagnóstico do portal → portal_diagnostico_historico
 *     (acompanhar se as inconsistências estão caindo).
 */
import { db, logAdvbox, getBotMetricas } from './_lib/botDb.mjs';

export default async () => {
  const stats = { fallbacks: 0, diag: false };

  // 1) perguntas que o bot nao soube responder (7 dias)
  try {
    const desde = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: msgs } = await db.from('bot_messages')
      .select('text').eq('direction', 'in').eq('intent', 'fallback')
      .gte('created_at', desde).limit(2000);
    const freq = {};
    for (const m of msgs || []) {
      const t = String(m.text || '').toLowerCase().trim().slice(0, 120);
      if (t.length < 3 || t.startsWith('#')) continue;
      freq[t] = (freq[t] || 0) + 1;
    }
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);
    stats.fallbacks = (msgs || []).length;
    if (top.length) {
      await logAdvbox('bot', 'aviso',
        `📋 Semana: ${stats.fallbacks} pergunta(s) que o bot não soube responder. Top: ${top.slice(0, 5).map(([t, n]) => `"${t}" (${n}×)`).join(' · ')} — cadastre intenções/glossário na aba Bot ADVBOX.`,
        { top });
    } else {
      await logAdvbox('bot', 'info', '📋 Semana sem perguntas não respondidas pelo bot. ✅', {});
    }
  } catch (e) { await logAdvbox('bot', 'erro', `rotina semanal (fallbacks): ${e.message}`, {}); }

  // 2) retrato do diagnostico do portal
  try {
    const { data: d, error } = await db.rpc('portal_diagnostico', { p_chave: process.env.BOT_RPC_SECRET || '' });
    if (error) throw new Error(error.message);
    const incs = {};
    for (const [k, v] of Object.entries(d?.inconsistencias || {})) incs[k] = v?.qtd ?? null;
    await db.from('portal_diagnostico_historico').upsert({
      dia: new Date().toISOString().slice(0, 10),
      resumo: d?.resumo || {}, inconsistencias: incs,
    });
    stats.diag = true;
    await logAdvbox('portal', 'info',
      `📊 Retrato semanal do portal: ${d?.resumo?.links_ativos ?? '?'} links ativos, ${d?.resumo?.prontos_para_gerar ?? '?'} prontos p/ gerar, inconsistências: ${Object.entries(incs).map(([k, v]) => `${k}=${v}`).join(' ')}`,
      { resumo: d?.resumo, incs });
  } catch (e) { await logAdvbox('portal', 'erro', `rotina semanal (diagnóstico): ${e.message}`, {}); }

  // usa getBotMetricas só para validar que o motor segue íntegro (sanidade)
  try { await getBotMetricas(7); } catch { /* não crítico */ }

  console.log('[rotina-semanal]', JSON.stringify(stats));
  return new Response('ok');
};

export const config = { schedule: '0 10 * * 1' };
