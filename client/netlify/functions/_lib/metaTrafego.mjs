/**
 * (aba Trafego 14/07/2026) Helpers de IO da esteira de trafego Meta — usados
 * pela meta-trafego-sync (despachante + "hoje") e pela
 * meta-trafego-worker-background (cron diario + backfill, ate 15 min).
 * A logica PURA (parsers/alertas) mora em metaAds.mjs; aqui e so IO/orquestracao.
 * Motivo do split: catalogo real tem ~650 anuncios e estourava o teto de 26s
 * das functions sincronas (medido 26.1s p/ 7 dias em 15/07).
 */
import { db, logAdvbox } from './botDb.mjs';
import { campaignToRow, adToRow, adsetToRow, insightToDiario, breakdownToLinha, contaToRow, atividadeToRow, avaliarAlertasTrafego, ALERTAS_DEFAULT } from './metaAds.mjs';
import { sendAlertEmail } from './alertEmail.mjs';

export const GRAPH = 'https://graph.facebook.com/v23.0';
export const TOKEN = process.env.META_ADS_TOKEN || '';
export const ACCOUNTS = (process.env.META_AD_ACCOUNT_IDS || process.env.META_AD_ACCOUNT_ID || 'act_969110338250520')
  .split(',').map((s) => s.trim()).filter(Boolean);
const RPC_SECRET = process.env.BOT_RPC_SECRET || '';

// destinatarios default dos alertas (config sobrescreve em bot_config['meta_trafego'])
export const TRIO = ['paulo@advocaciacbc.com', 'bruno@advocaciacbc.com', 'lorenza@advocaciacbc.com'];

const _sleep = (ms) => new Promise((res) => setTimeout(res, ms));

export async function graphGet(url, tentativa = 0) {
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
export async function graphAll(url, maxPaginas = 30) {
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
export function diaBrt(menosDias = 0) {
  const d = new Date(Date.now() - 3 * 3600 * 1000 - menosDias * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * Catalogos. `leve=true` traz SO campanhas (status/orcamento) — e o caminho do
 * "Atualizar agora" (o catalogo de ~650 anuncios custa varios segundos e chega
 * completo no cron noturno via worker).
 */
export async function fetchCatalogos(account, { leve = false } = {}) {
  // v3 (espelho completo): ciclo de vida + estrategia da campanha
  const campanhas = (await graphAll(
    `${GRAPH}/${account}/campaigns?fields=id,name,effective_status,objective,daily_budget,lifetime_budget,buying_type,bid_strategy,created_time,updated_time,start_time,stop_time&limit=200&access_token=${encodeURIComponent(TOKEN)}`
  )).map((c) => campaignToRow(c, account));
  if (leve) return { campanhas, anuncios: [], conjuntos: [] };
  // limit BAIXO: ads com creative{...} em paginas de 200 estoura o custo de query da
  // Meta ("Please reduce the amount of data", code 1 — limite DINAMICO: passou 15/07,
  // recusou 16/07). v3 pede a COPY inteira do creative -> paginas de 25 (ainda mais leves).
  const anuncios = (await graphAll(
    `${GRAPH}/${account}/ads?fields=id,name,effective_status,campaign_id,created_time,updated_time,creative{thumbnail_url,title,body,call_to_action_type,video_id,image_url},preview_shareable_link&limit=25&access_token=${encodeURIComponent(TOKEN)}`,
    80
  )).map((a) => adToRow(a, account));
  // (v2 #121) conjuntos/publicos — limit BAIXO: com 200 a Meta recusa a query
  // ("Please reduce the amount of data", code 1) e o worker morria no catalogo.
  // v3 pede o targeting (publico-alvo) inteiro -> paginas de 25.
  const conjuntos = (await graphAll(
    `${GRAPH}/${account}/adsets?fields=id,name,effective_status,campaign_id,daily_budget,optimization_goal,billing_event,targeting,created_time,updated_time,start_time,end_time&limit=25&access_token=${encodeURIComponent(TOKEN)}`,
    80
  )).map((s) => adsetToRow(s, account));
  return { campanhas, anuncios, conjuntos };
}

/** (v3) Snapshot de HOJE da conta: gasto acumulado, saldo, teto e status. 1 GET leve. */
export async function fetchConta(account) {
  const body = await graphGet(
    `${GRAPH}/${account}?fields=account_status,amount_spent,balance,spend_cap,currency&access_token=${encodeURIComponent(TOKEN)}`
  );
  return contaToRow(body, account, diaBrt(0));
}

/**
 * (v3) Trilha de atividades do Gerenciador (quem pausou/alterou o que na conta).
 * since/until = YYYY-MM-DD. Falha aqui NAO pode derrubar o sync (best-effort no caller).
 */
export async function fetchAtividades(account, since, until) {
  const rows = await graphAll(
    `${GRAPH}/${account}/activities?fields=event_type,event_time,actor_name,object_name,object_id,extra_data&since=${since}&until=${until}&limit=200&access_token=${encodeURIComponent(TOKEN)}`,
    20
  );
  return rows.map((a) => atividadeToRow(a, account));
}

// (v2 #56/#58) retencao de video vem em campos proprios dos insights
const CAMPOS_VIDEO = 'video_thruplay_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions';

export async function fetchDiario(account, since, until, { comAdset = false } = {}) {
  const linhas = [];
  const levels = comAdset ? ['campaign', 'adset', 'ad'] : ['campaign', 'ad'];
  for (const level of levels) {
    const id = level === 'ad' ? ',ad_id' : level === 'adset' ? ',adset_id' : '';
    // v3: rankings de qualidade so existem no level=ad (em outros niveis a API recusa)
    const qualidade = level === 'ad' ? ',quality_ranking,engagement_rate_ranking,conversion_rate_ranking' : '';
    const campos = `campaign_id${id},spend,impressions,reach,clicks,inline_link_clicks,frequency,actions,${CAMPOS_VIDEO}${qualidade}`;
    const tr = encodeURIComponent(JSON.stringify({ since, until }));
    const rows = await graphAll(
      `${GRAPH}/${account}/insights?level=${level}&fields=${campos}&time_increment=1&time_range=${tr}&limit=500&access_token=${encodeURIComponent(TOKEN)}`,
      60
    );
    for (const row of rows) linhas.push(insightToDiario(row, level, account));
  }
  return linhas;
}

// (v2 #124-#127) breakdowns diarios no NIVEL DA CONTA (demografico, regiao, posicionamento)
const BREAKDOWNS = {
  age_gender: 'age,gender',
  region: 'region',
  platform_position: 'publisher_platform,platform_position',
};

export async function fetchBreakdowns(account, since, until) {
  const linhas = [];
  const tr = encodeURIComponent(JSON.stringify({ since, until }));
  for (const [tipo, dims] of Object.entries(BREAKDOWNS)) {
    const rows = await graphAll(
      `${GRAPH}/${account}/insights?level=account&fields=spend,impressions,inline_link_clicks,actions&breakdowns=${dims}&time_increment=1&time_range=${tr}&limit=500&access_token=${encodeURIComponent(TOKEN)}`,
      80
    );
    for (const row of rows) linhas.push(breakdownToLinha(row, tipo, account));
  }
  return linhas;
}

/**
 * Grava via RPC em blocos (payload jsonb saudavel). Catalogos/conta so no 1o bloco.
 * v3: `extras` = { conta: [linha], atividades: [linhas] } — ambos opcionais.
 */
export async function gravar(catalogos, diario, limpar, breakdown = [], extras = {}) {
  let total = { campanhas: 0, anuncios: 0, conjuntos: 0, diario: 0, breakdown: 0, conta: 0, atividades: 0, removidos: 0 };
  const blocos = [];
  for (let i = 0; i < Math.max(diario.length, 1); i += 800) blocos.push(diario.slice(i, i + 800));
  // breakdown/atividades tambem em blocos (backfill 90d ~4-5k linhas)
  const blocosBd = [];
  for (let i = 0; i < breakdown.length; i += 800) blocosBd.push(breakdown.slice(i, i + 800));
  const atividades = extras.atividades || [];
  const blocosAt = [];
  for (let i = 0; i < atividades.length; i += 800) blocosAt.push(atividades.slice(i, i + 800));
  const rodadas = Math.max(blocos.length, blocosBd.length, blocosAt.length);
  for (let i = 0; i < rodadas; i++) {
    const { data, error } = await db.rpc('meta_trafego_upsert', {
      p_chave: RPC_SECRET,
      p_campanhas: i === 0 ? catalogos.campanhas : [],
      p_anuncios: i === 0 ? catalogos.anuncios : [],
      p_conjuntos: i === 0 ? (catalogos.conjuntos || []) : [],
      p_diario: blocos[i] || [],
      p_breakdown: blocosBd[i] || [],
      p_conta: i === 0 ? (extras.conta || []) : [],
      p_atividades: blocosAt[i] || [],
      p_limpar: limpar && i === rodadas - 1,
    });
    if (error) throw new Error(`RPC meta_trafego_upsert: ${error.message}`);
    total = {
      campanhas: total.campanhas + (data?.campanhas || 0),
      anuncios: total.anuncios + (data?.anuncios || 0),
      conjuntos: total.conjuntos + (data?.conjuntos || 0),
      diario: total.diario + (data?.diario || 0),
      breakdown: total.breakdown + (data?.breakdown || 0),
      conta: total.conta + (data?.conta || 0),
      atividades: total.atividades + (data?.atividades || 0),
      removidos: total.removidos + (data?.removidos || 0),
    };
  }
  return total;
}

/** Config da aba (bot_config['meta_trafego']); defaults do modulo puro. */
export async function lerConfig() {
  const { data } = await db.from('bot_config').select('value').eq('key', 'meta_trafego').maybeSingle();
  const alertas = { ...ALERTAS_DEFAULT, destinatarios: TRIO, ...(data?.value?.alertas || {}) };
  return { alertas };
}

/** Roda o motor de alertas com anti-flood (1 por tipo+campanha+dia). */
export async function rodarAlertas() {
  const cfg = await lerConfig();
  if (!cfg.alertas.ativo) return { avaliados: 0, enviados: 0, motivo: 'desligado' };

  const { data: series, error } = await db.rpc('meta_trafego_series', { p_chave: RPC_SECRET, p_dias: 29 });
  if (error) throw new Error(`RPC meta_trafego_series: ${error.message}`);

  const alertas = avaliarAlertasTrafego(series || {}, cfg.alertas);
  if (!alertas.length) return { avaliados: 0, enviados: 0 };

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
