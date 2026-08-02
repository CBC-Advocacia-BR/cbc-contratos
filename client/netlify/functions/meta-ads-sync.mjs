/**
 * Meta Ads -> Supabase (meta_ads_mensal): leads de campanha por mes para a
 * 1a etapa da Saude do Funil (leads = conversas iniciadas click-to-WhatsApp
 * + lead forms; junto vem gasto/impressoes/cliques p/ custo por lead).
 *
 * Fonte: Graph API /act_.../insights (level=campaign, time_increment=monthly).
 * Escrita: RPC meta_ads_upsert (security definer + BOT_RPC_SECRET), padrao
 * asaas_mirror_*. Logs no console do Monitor via advbox_api_log (origem 'meta').
 *
 * Modos:
 *  - GET / scheduled  -> re-sincroniza mes anterior + corrente (atribuicao tardia)
 *  - POST { backfill:true, meses:N } -> varre N meses p/ tras (default 24, cap 36)
 * Auth (exceto scheduled): body.key | header x-bot-key === BOT_PANEL_KEY.
 * Env: META_ADS_TOKEN (obrigatoria) + META_AD_ACCOUNT_IDS (ou META_AD_ACCOUNT_ID;
 * default = conta CA - CBC Distratos).
 */
import { db, logAdvbox, heartbeat } from './_lib/botDb.mjs';
import { insightRowToLinha, ymFirstDay } from './_lib/metaAds.mjs';
import { verificarGatilho, respostaNegada } from './_lib/gatilho.mjs';

const GRAPH = 'https://graph.facebook.com/v23.0';
const TOKEN = process.env.META_ADS_TOKEN || '';
const ACCOUNTS = (process.env.META_AD_ACCOUNT_IDS || process.env.META_AD_ACCOUNT_ID || 'act_969110338250520')
  .split(',').map((s) => s.trim()).filter(Boolean);
const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const PANEL_KEY = process.env.BOT_PANEL_KEY || 'cbc-bot-2026';
const JSONH = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-bot-key' };

const _sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function graphGet(url, tentativa = 0) {
  let r;
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  } catch (e) {
    if (tentativa < 2) { await _sleep(2500 * (tentativa + 1)); return graphGet(url, tentativa + 1); }
    throw new Error(`Meta Graph: ${e.name === 'TimeoutError' ? 'timeout' : e.message}`);
  }
  // (auditoria 01/08 — item 132) A Meta AVISA o quanto da cota ja foi consumida nos
  // cabecalhos `X-Business-Use-Case-Usage` / `X-App-Usage`. O codigo so reagia ao 429,
  // ou seja, DEPOIS de levar o bloqueio — e um bloqueio no meio do sync deixa o espelho
  // pela metade. Lendo o percentual, dá para frear ANTES: acima de 90% respiramos 20s
  // (as chamadas seguintes ja entram com a cota renovada), e acima de 75% fica o registro
  // para o Paulo saber que o volume esta perto do teto.
  try {
    const bruto = r.headers.get('x-business-use-case-usage') || r.headers.get('x-app-usage');
    if (bruto) {
      const uso = JSON.parse(bruto);
      const valores = Array.isArray(uso) ? uso : Object.values(uso).flat();
      const pico = Math.max(0, ...valores.flatMap((u) => [
        Number(u?.call_count) || 0, Number(u?.total_cputime) || 0, Number(u?.total_time) || 0,
      ]));
      if (pico >= 90) {
        await logAdvbox('meta', 'aviso', `Cota da Meta em ${pico}% — pausando 20s para nao levar bloqueio`, { pico });
        await _sleep(20000);
      } else if (pico >= 75) {
        await logAdvbox('meta', 'aviso', `Cota da Meta em ${pico}% do limite nesta janela`, { pico });
      }
    }
  } catch { /* cabecalho ausente ou em formato novo: nunca derruba o sync */ }

  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.error) {
    const err = body.error || {};
    // 17/80004 = rate limit de insights da conta — espera e re-tenta
    if ((r.status === 429 || err.code === 17 || err.code === 80004) && tentativa < 3) {
      await _sleep(15000 * (tentativa + 1));
      return graphGet(url, tentativa + 1);
    }
    throw new Error(`Meta Graph ${err.code || r.status}: ${err.message || 'erro desconhecido'}`);
  }
  return body;
}

async function syncAccount(account, since, until) {
  const linhas = [];
  const tr = encodeURIComponent(JSON.stringify({ since, until }));
  let url = `${GRAPH}/${account}/insights?level=campaign&fields=campaign_id,campaign_name,actions,spend,impressions,clicks&time_increment=monthly&time_range=${tr}&limit=200&access_token=${encodeURIComponent(TOKEN)}`;
  let paginas = 0;
  while (url && paginas < 25) {
    const body = await graphGet(url);
    for (const row of body.data || []) linhas.push(insightRowToLinha(row, account));
    url = body.paging?.next || null;
    paginas++;
  }
  return linhas;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: JSONH });
  // (auditoria 01/08 — item 9) ANTES: `|| req.method === 'GET'` fazia QUALQUER acesso
  // pelo navegador ser tratado como "veio do agendador" — e o bloco de checagem de chave
  // abaixo era pulado. Bastava abrir a URL para disparar o robo (aqui, inclusive
  // backfills que consomem cota paga de API de terceiros). Agora: ou vem do agendador
  // da Netlify (cabecalho x-netlify-event), ou apresenta a BOT_PANEL_KEY.
  const gatilho = verificarGatilho(req, { agendada: true });
  if (!gatilho.ok) return respostaNegada(gatilho);
  const isScheduled = gatilho.origem === 'cron';
  let body = {};
  if (req.method === 'POST') body = await req.json().catch(() => ({}));
  // GET ?backfill=1&meses=N — religada manual do historico (upsert idempotente,
  // sem exposicao de dados; mesmo modelo do kommo-leads-sync via GET).
  if (req.method === 'GET') {
    const qs = new URL(req.url).searchParams;
    if (qs.get('backfill')) body = { backfill: true, meses: Number(qs.get('meses')) || undefined };
  }
  // (item 9) a checagem de chave ja foi feita por verificarGatilho() acima —
  // o bloco antigo daqui so olhava body.key/cabecalho e barrava o disparo via ?key=.
  if (!TOKEN) return new Response(JSON.stringify({ error: 'META_ADS_TOKEN ausente' }), { status: 500, headers: JSONH });

  try {
    const hoje = new Date();
    let since;
    if (body.backfill) {
      const meses = Math.min(Number(body.meses) || 24, 36);
      since = ymFirstDay(new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - meses, 1)));
    } else {
      since = ymFirstDay(new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1)));
    }
    const until = hoje.toISOString().slice(0, 10);

    let gravadas = 0;
    const porConta = {};
    for (const account of ACCOUNTS) {
      const linhas = await syncAccount(account, since, until);
      if (linhas.length) {
        const { data, error } = await db.rpc('meta_ads_upsert', { p_chave: RPC_SECRET, p_linhas: linhas });
        if (error) throw new Error(`RPC meta_ads_upsert: ${error.message}`);
        gravadas += data || 0;
      }
      porConta[account] = linhas.length;
    }
    await logAdvbox('meta', 'info', `meta-ads-sync ok: ${gravadas} linhas mes/campanha (${since} a ${until})`, { porConta, backfill: !!body.backfill });
    await heartbeat('meta-ads-sync', true, `${gravadas} linhas (${since} a ${until})`).catch(() => {}); // (observ 28/07)
    return new Response(JSON.stringify({ success: true, gravadas, since, until, porConta }), { headers: JSONH });
  } catch (e) {
    await logAdvbox('meta', 'error', `meta-ads-sync falhou: ${e.message}`, { contas: ACCOUNTS });
    await heartbeat('meta-ads-sync', false, e.message).catch(() => {});
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: JSONH });
  }
};

export const config = {
  schedule: '0 10 * * *', // 07h BRT diario — leads de campanha p/ a Saude do Funil
};
