/**
 * Worker BACKGROUND da aba Trafego (ate 15 min) — faz o trabalho pesado que nao
 * cabe nos 26s da function sincrona (catalogo tem ~650 anuncios):
 *  - modo 'diario' (despachado pelo cron da meta-trafego-sync): catalogos completos
 *    + insights D-3..D-1 + limpeza 400d + ALERTAS + heartbeat
 *  - modo 'backfill' {dias}: varre em janelas de 30 dias (cap 400)
 * Auth: header x-bot-key === BOT_PANEL_KEY (o despachante manda; chamada direta sem
 * a chave e recusada). Progresso/resultado no console do Monitor (origem 'meta').
 */
import { logAdvbox, heartbeat } from './_lib/botDb.mjs';
import { TOKEN, ACCOUNTS, diaBrt, fetchCatalogos, fetchDiario, fetchBreakdowns, gravar, rodarAlertas } from './_lib/metaTrafego.mjs';

const PANEL_KEY = process.env.BOT_PANEL_KEY || 'cbc-bot-2026';

export default async (req) => {
  const key = req.headers.get('x-bot-key') || '';
  if (key !== PANEL_KEY) return new Response('unauthorized', { status: 401 });
  if (!TOKEN) return new Response('META_ADS_TOKEN ausente', { status: 500 });

  const body = await req.json().catch(() => ({}));
  const modo = body.modo === 'backfill' ? 'backfill' : 'diario';

  try {
    let since;
    let until;
    if (modo === 'backfill') {
      const dias = Math.min(Number(body.dias) || 90, 400);
      since = diaBrt(dias);
      until = diaBrt(0);
    } else {
      since = diaBrt(3);
      until = diaBrt(1);
    }

    let totais = { campanhas: 0, anuncios: 0, conjuntos: 0, diario: 0, breakdown: 0, removidos: 0 };
    for (const account of ACCOUNTS) {
      const catalogos = await fetchCatalogos(account); // completo (anuncios/thumbnails + conjuntos)
      const diario = [];
      const breakdown = [];
      let ini = new Date(since + 'T12:00:00Z');
      const fimTotal = new Date(until + 'T12:00:00Z');
      while (ini <= fimTotal) {
        const fimJanela = new Date(Math.min(ini.getTime() + 29 * 86400 * 1000, fimTotal.getTime()));
        const de = ini.toISOString().slice(0, 10);
        const ate = fimJanela.toISOString().slice(0, 10);
        diario.push(...await fetchDiario(account, de, ate, { comAdset: true }));
        breakdown.push(...await fetchBreakdowns(account, de, ate));
        ini = new Date(fimJanela.getTime() + 86400 * 1000);
      }
      const t = await gravar(catalogos, diario, modo === 'diario', breakdown);
      totais = {
        campanhas: totais.campanhas + t.campanhas,
        anuncios: totais.anuncios + t.anuncios,
        conjuntos: totais.conjuntos + t.conjuntos,
        diario: totais.diario + t.diario,
        breakdown: totais.breakdown + t.breakdown,
        removidos: totais.removidos + t.removidos,
      };
    }

    let alertas = null;
    if (modo === 'diario') {
      try { alertas = await rodarAlertas(); }
      catch (e) { alertas = { erro: e.message }; }
      await heartbeat('meta-trafego-sync').catch(() => {});
    }

    await logAdvbox('meta', 'info', `trafego-worker ${modo} ok: ${totais.diario} linhas diarias, ${totais.campanhas} campanhas, ${totais.anuncios} anuncios (${since} a ${until})`, { totais, alertas });
    return new Response(JSON.stringify({ success: true, modo, since, until, ...totais, alertas }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    await logAdvbox('meta', 'error', `trafego-worker ${modo} falhou: ${e.message}`, { contas: ACCOUNTS });
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
