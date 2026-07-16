/**
 * Aba Trafego -> Supabase (meta_campanhas + meta_anuncios + meta_ads_diario).
 * Espelho OPERACIONAL do Meta Ads: catalogos (status/orcamento/thumbnail) e
 * metricas DIARIAS por campanha e por anuncio, alem do motor de ALERTAS
 * (cpl_estourado / entrega_zerada / queda_leads -> sino in-app + e-mail).
 *
 * Escrita: RPC meta_trafego_upsert (security definer + BOT_RPC_SECRET).
 * Leitura p/ alertas: RPC meta_trafego_series (mesma trava).
 * Logs no console do Monitor via advbox_api_log (origem 'meta').
 *
 * Modos:
 *  - cron 07h10 BRT / GET sem params -> catalogos + D-3..D-1 + limpeza 400d + ALERTAS
 *  - GET ?hoje=1                     -> catalogos + dia corrente ("Atualizar agora" da aba)
 *  - GET ?backfill=1&dias=N          -> catalogos + N dias p/ tras (default 90, cap 400)
 *  - ?dry=1 em qualquer GET          -> so busca/parseia e devolve contagens (nao grava)
 * Auth (POST): body.key | x-bot-key === BOT_PANEL_KEY. GET/scheduled livre (upsert
 * idempotente sem exposicao de dados; mesmo modelo do kommo-leads-sync).
 * Envs: META_ADS_TOKEN (obrigatoria), META_AD_ACCOUNT_ID(S), BOT_RPC_SECRET.
 */
import { db, logAdvbox, heartbeat } from './_lib/botDb.mjs';
import { campaignToRow, adToRow, insightToDiario, avaliarAlertasTrafego, ALERTAS_DEFAULT } from './_lib/metaAds.mjs';
import { sendAlertEmail } from './_lib/alertEmail.mjs';

const GRAPH = 'https://graph.facebook.com/v23.0';
const TOKEN = process.env.META_ADS_TOKEN || '';
const ACCOUNTS = (process.env.META_AD_ACCOUNT_IDS || process.env.META_AD_ACCOUNT_ID || 'act_969110338250520')
  .split(',').map((s) => s.trim()).filter(Boolean);
const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const PANEL_KEY = process.env.BOT_PANEL_KEY || 'cbc-bot-2026';
const JSONH = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-bot-key' };

// destinatarios default dos alertas (config sobrescreve em bot_config['meta_trafego'])
const TRIO = ['paulo@advocaciacbc.com', 'bruno@advocaciacbc.com', 'lorenza@advocaciacbc.com'];

const _sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function graphGet(url, tentativa = 0) {
  let r;
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(25000) });
  } catch (e) {
    if (tentativa < 2) { await _sleep(2500 * (tentativa + 1)); return graphGet(url, tentativa + 1); }
    throw new Error(`Meta Graph: ${e.name === 'TimeoutError' ? 'timeout' : e.message}`);
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.error) {
    const err = body.error || {};
    if ((r.status === 429 || err.code === 17 || err.code === 80004) && tentativa < 3) {
      await _sleep(15000 * (tentativa + 1));
      return graphGet(url, tentativa + 1);
    }
    throw new Error(`Meta Graph ${err.code || r.status}: ${err.message || 'erro desconhecido'}`);
  }
  return body;
}

/** Percorre paginacao do Graph acumulando body.data (cap de paginas por seguranca). */
async function graphAll(url, maxPaginas = 30) {
  const out = [];
  let next = url;
  let paginas = 0;
  while (next && paginas < maxPaginas) {
    const body = await graphGet(next);
    out.push(...(body.data || []));
    next = body.paging?.next || null;
    paginas++;
  }
  return out;
}

/** Data BRT (UTC-3) em YYYY-MM-DD, deslocada de `menosDias`. */
function diaBrt(menosDias = 0) {
  const d = new Date(Date.now() - 3 * 3600 * 1000 - menosDias * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

async function fetchCatalogos(account) {
  const campanhas = (await graphAll(
    `${GRAPH}/${account}/campaigns?fields=id,name,effective_status,objective,daily_budget&limit=200&access_token=${encodeURIComponent(TOKEN)}`
  )).map((c) => campaignToRow(c, account));
  const anuncios = (await graphAll(
    `${GRAPH}/${account}/ads?fields=id,name,effective_status,campaign_id,creative{thumbnail_url},preview_shareable_link&limit=200&access_token=${encodeURIComponent(TOKEN)}`
  )).map((a) => adToRow(a, account));
  return { campanhas, anuncios };
}

async function fetchDiario(account, since, until) {
  const linhas = [];
  for (const level of ['campaign', 'ad']) {
    const campos = level === 'ad'
      ? 'campaign_id,ad_id,spend,impressions,reach,clicks,inline_link_clicks,frequency,actions'
      : 'campaign_id,spend,impressions,reach,clicks,inline_link_clicks,frequency,actions';
    const tr = encodeURIComponent(JSON.stringify({ since, until }));
    const rows = await graphAll(
      `${GRAPH}/${account}/insights?level=${level}&fields=${campos}&time_increment=1&time_range=${tr}&limit=500&access_token=${encodeURIComponent(TOKEN)}`,
      60
    );
    for (const row of rows) linhas.push(insightToDiario(row, level, account));
  }
  return linhas;
}

/** Grava via RPC em blocos (payload jsonb saudavel). Catalogos so no 1o bloco. */
async function gravar(catalogos, diario, limpar) {
  let total = { campanhas: 0, anuncios: 0, diario: 0, removidos: 0 };
  const blocos = [];
  for (let i = 0; i < Math.max(diario.length, 1); i += 800) blocos.push(diario.slice(i, i + 800));
  for (let i = 0; i < blocos.length; i++) {
    const { data, error } = await db.rpc('meta_trafego_upsert', {
      p_chave: RPC_SECRET,
      p_campanhas: i === 0 ? catalogos.campanhas : [],
      p_anuncios: i === 0 ? catalogos.anuncios : [],
      p_diario: blocos[i],
      p_limpar: limpar && i === blocos.length - 1,
    });
    if (error) throw new Error(`RPC meta_trafego_upsert: ${error.message}`);
    total = {
      campanhas: total.campanhas + (data?.campanhas || 0),
      anuncios: total.anuncios + (data?.anuncios || 0),
      diario: total.diario + (data?.diario || 0),
      removidos: total.removidos + (data?.removidos || 0),
    };
  }
  return total;
}

/** Config da aba (bot_config['meta_trafego']); defaults do modulo puro. */
async function lerConfig() {
  const { data } = await db.from('bot_config').select('value').eq('key', 'meta_trafego').maybeSingle();
  const alertas = { ...ALERTAS_DEFAULT, destinatarios: TRIO, ...(data?.value?.alertas || {}) };
  return { alertas };
}

/** Roda o motor de alertas com anti-flood (1 por tipo+campanha+dia). */
async function rodarAlertas() {
  const cfg = await lerConfig();
  if (!cfg.alertas.ativo) return { avaliados: 0, enviados: 0, motivo: 'desligado' };

  const { data: series, error } = await db.rpc('meta_trafego_series', { p_chave: RPC_SECRET, p_dias: 29 });
  if (error) throw new Error(`RPC meta_trafego_series: ${error.message}`);

  const alertas = avaliarAlertasTrafego(series || {}, cfg.alertas);
  if (!alertas.length) return { avaliados: 0, enviados: 0 };

  // anti-flood diario
  const hoje = diaBrt(0);
  const { data: logCfg } = await db.from('bot_config').select('value').eq('key', 'meta_trafego_alert_log').maybeSingle();
  const enviadosAntes = logCfg?.value?.dia === hoje ? (logCfg.value.chaves || []) : [];
  const novos = alertas.filter((a) => !enviadosAntes.includes(`${a.tipo}::${a.campaign_id || 'conta'}`));
  if (!novos.length) return { avaliados: alertas.length, enviados: 0, motivo: 'anti-flood' };

  const linhas = novos.map((a) => a.mensagem);
  const dest = cfg.alertas.destinatarios || TRIO;
  for (const email of dest) {
    try {
      await db.from('notifications').insert({
        user_email: email,
        type: 'warning',
        title: `📣 Tráfego: ${novos.length} alerta(s) nas campanhas Meta`,
        body: linhas.join('\n'),
        link: null,
      });
    } catch { /* notificacao nunca derruba o sync */ }
  }
  const mail = await sendAlertEmail(`📣 CBC Tráfego: ${novos.length} alerta(s) nas campanhas`, linhas, {
    to: dest,
    titulo: '📣 Alertas de tráfego — campanhas Meta',
    rodape: 'Enviado pelo sync diário da aba Tráfego (1 alerta por tipo/campanha por dia). Detalhes e limites editáveis na aba Tráfego do CBC Contratos.',
  });

  await db.from('bot_config').upsert({
    key: 'meta_trafego_alert_log',
    value: { dia: hoje, chaves: [...enviadosAntes, ...novos.map((a) => `${a.tipo}::${a.campaign_id || 'conta'}`)] },
    updated_at: new Date().toISOString(),
  });
  await logAdvbox('meta', 'aviso', `trafego: ${novos.length} alerta(s) — ${linhas.join(' | ')}`.slice(0, 480), { email: mail.ok ? 'enviado' : (mail.skipped || mail.error) });
  return { avaliados: alertas.length, enviados: novos.length };
}

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
  const dry = qs.get('dry') === '1';
  let modo = 'diario';
  if (qs.get('hoje')) modo = 'hoje';
  else if (qs.get('backfill')) modo = 'backfill';

  try {
    let since;
    let until;
    if (modo === 'hoje') { since = diaBrt(0); until = diaBrt(0); }
    else if (modo === 'backfill') {
      const dias = Math.min(Number(qs.get('dias')) || 90, 400);
      since = diaBrt(dias); until = diaBrt(0);
    } else { since = diaBrt(3); until = diaBrt(1); }

    let totais = { campanhas: 0, anuncios: 0, diario: 0, removidos: 0 };
    for (const account of ACCOUNTS) {
      const catalogos = await fetchCatalogos(account);
      // backfill longo: janelas de ate 90 dias p/ nao estourar paginacao/timeout
      const diario = [];
      let ini = new Date(since + 'T12:00:00Z');
      const fimTotal = new Date(until + 'T12:00:00Z');
      while (ini <= fimTotal) {
        const fimJanela = new Date(Math.min(ini.getTime() + 89 * 86400 * 1000, fimTotal.getTime()));
        diario.push(...await fetchDiario(account, ini.toISOString().slice(0, 10), fimJanela.toISOString().slice(0, 10)));
        ini = new Date(fimJanela.getTime() + 86400 * 1000);
      }
      if (dry) {
        totais = { campanhas: totais.campanhas + catalogos.campanhas.length, anuncios: totais.anuncios + catalogos.anuncios.length, diario: totais.diario + diario.length, removidos: 0 };
      } else {
        const t = await gravar(catalogos, diario, modo === 'diario');
        totais = { campanhas: totais.campanhas + t.campanhas, anuncios: totais.anuncios + t.anuncios, diario: totais.diario + t.diario, removidos: totais.removidos + t.removidos };
      }
    }

    let alertas = null;
    if (modo === 'diario' && !dry) {
      try { alertas = await rodarAlertas(); }
      catch (e) { alertas = { erro: e.message }; }
      await heartbeat('meta-trafego-sync').catch(() => {});
    }

    if (!dry) await logAdvbox('meta', 'info', `trafego-sync ${modo} ok: ${totais.diario} linhas diarias, ${totais.campanhas} campanhas, ${totais.anuncios} anuncios (${since} a ${until})`, { totais, alertas });
    return new Response(JSON.stringify({ success: true, modo, dry, since, until, ...totais, alertas }), { headers: JSONH });
  } catch (e) {
    await logAdvbox('meta', 'error', `trafego-sync ${modo} falhou: ${e.message}`, { contas: ACCOUNTS });
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: JSONH });
  }
};

export const config = {
  schedule: '10 10 * * *', // 07h10 BRT diario — apos o meta-ads-sync mensal (07h)
};
