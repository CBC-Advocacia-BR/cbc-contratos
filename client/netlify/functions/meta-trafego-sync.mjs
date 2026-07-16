/**
 * Aba Trafego — DESPACHANTE do espelho Meta Ads (meta_campanhas/meta_anuncios/
 * meta_ads_diario). O trabalho pesado (catalogo com ~650 anuncios + janelas
 * longas + alertas) roda na meta-trafego-worker-background (ate 15 min) — as
 * functions sincronas deste site estouram em ~26s (medido 15/07).
 *
 * Modos:
 *  - cron 07h10 BRT / GET sem params -> DESPACHA worker modo 'diario'
 *    (catalogos completos + D-3..D-1 + limpeza 400d + alertas)
 *  - GET ?backfill=1&dias=N          -> DESPACHA worker modo 'backfill' (cap 400)
 *  - GET ?hoje=1                     -> SINCRONO: campanhas (status/orcamento) +
 *    metricas do dia corrente ("Atualizar agora" da aba; catalogo de anuncios
 *    NAO entra aqui — chega no cron noturno)
 * Auth (POST): body.key | x-bot-key === BOT_PANEL_KEY. GET/scheduled livre
 * (upsert idempotente sem exposicao de dados; padrao kommo-leads-sync).
 */
import { logAdvbox } from './_lib/botDb.mjs';
import { TOKEN, ACCOUNTS, diaBrt, fetchCatalogos, fetchDiario, fetchConta, gravar } from './_lib/metaTrafego.mjs';

const PANEL_KEY = process.env.BOT_PANEL_KEY || 'cbc-bot-2026';
const SELF_URL = process.env.URL || 'https://contratos-cbc.netlify.app';
const JSONH = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-bot-key' };

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: JSONH });
  const isScheduled = req.headers.get('x-netlify-event') === 'schedule' || req.method === 'GET';
  if (!isScheduled) {
    const body = await req.json().catch(() => ({}));
    const key = body.key || req.headers.get('x-bot-key') || '';
    if (key !== PANEL_KEY) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: JSONH });
  }
  if (!TOKEN) return new Response(JSON.stringify({ error: 'META_ADS_TOKEN ausente' }), { status: 500, headers: JSONH });

  const qs = new URL(req.url).searchParams;

  try {
    // ─── "Atualizar agora" (sincrono, leve): campanhas + dia corrente ───
    if (qs.get('hoje')) {
      const hoje = diaBrt(0);
      let totais = { campanhas: 0, anuncios: 0, diario: 0 };
      for (const account of ACCOUNTS) {
        const catalogos = await fetchCatalogos(account, { leve: true });
        const diario = await fetchDiario(account, hoje, hoje);
        // v3: snapshot da conta (saldo/gasto acumulado) — 1 GET leve, best-effort
        const extras = { conta: [] };
        try { extras.conta = [await fetchConta(account)]; } catch { /* segue sem */ }
        const t = await gravar(catalogos, diario, false, [], extras);
        totais = { campanhas: totais.campanhas + t.campanhas, anuncios: totais.anuncios + t.anuncios, diario: totais.diario + t.diario };
      }
      await logAdvbox('meta', 'info', `trafego-sync hoje ok: ${totais.diario} linhas do dia, ${totais.campanhas} campanhas`, { totais });
      return new Response(JSON.stringify({ success: true, modo: 'hoje', dia: hoje, ...totais }), { headers: JSONH });
    }

    // ─── Demais modos: despacha o worker background (fire-and-forget) ───
    const modo = qs.get('backfill') ? 'backfill' : 'diario';
    const payload = { modo, dias: Math.min(Number(qs.get('dias')) || 90, 400) };
    fetch(`${SELF_URL}/.netlify/functions/meta-trafego-worker-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-key': PANEL_KEY },
      body: JSON.stringify(payload),
    }).catch(() => {});
    await logAdvbox('meta', 'info', `trafego-sync: worker ${modo} despachado`, payload);
    return new Response(JSON.stringify({ success: true, dispatched: true, modo, ...payload }), { status: 202, headers: JSONH });
  } catch (e) {
    await logAdvbox('meta', 'error', `trafego-sync falhou: ${e.message}`, {});
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: JSONH });
  }
};

export const config = {
  schedule: '10 10 * * *', // 07h10 BRT diario — apos o meta-ads-sync mensal (07h)
};
