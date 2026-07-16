/**
 * Acoes da aba Trafego na conta de anuncios Meta — pausar/reativar campanha,
 * editar orcamento diario e salvar a config de alertas.
 *
 * SEGURANCA (dupla trava, spec §5/§7):
 *  1) Authorization: Bearer <JWT do Supabase> validado NO SERVIDOR via
 *     db.auth.getUser(jwt) — identifica o usuario real (nao confia em flag do front);
 *  2) e-mail do usuario precisa estar em TRAFEGO_ACAO_EMAILS (Paulo/Bruno/Lorenza).
 * Toda acao le o estado ANTES, grava auditoria em activity_log (quem/o que/antes->depois)
 * + log no Monitor (origem 'meta'), e upserta o estado novo em meta_campanhas p/ a aba
 * refletir na hora.
 *
 * POST { acao: 'pausar'|'reativar'|'orcamento'|'config', campaign_id?, valor?, alertas? }
 *  - orcamento: valor em R$ (a Graph API recebe centavos)
 *  - config: { alertas: { ativo, cpl_mult, cpl_gasto_min_dia, queda_leads_pct, destinatarios } }
 */
import { db, logAdvbox } from './_lib/botDb.mjs';
import { campaignToRow, ALERTAS_DEFAULT } from './_lib/metaAds.mjs';

const GRAPH = 'https://graph.facebook.com/v23.0';
const TOKEN = process.env.META_ADS_TOKEN || '';
const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const JSONH = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };

// quem pode operar campanhas (decisao Paulo 14/07: trio; demais veem botoes desabilitados)
const TRAFEGO_ACAO_EMAILS = ['paulo@advocaciacbc.com', 'bruno@advocaciacbc.com', 'lorenza@advocaciacbc.com'];

const resp = (status, body) => new Response(JSON.stringify(body), { status, headers: JSONH });

async function graphPost(path, params) {
  const body = new URLSearchParams({ ...params, access_token: TOKEN });
  const r = await fetch(`${GRAPH}/${path}`, { method: 'POST', body, signal: AbortSignal.timeout(20000) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || json.error) {
    const err = json.error || {};
    throw new Error(`Meta Graph ${err.code || r.status}: ${err.message || 'erro desconhecido'}`);
  }
  return json;
}

async function graphGetCampanha(id) {
  // campos COMPLETOS (v3): o upsert do espelho substitui a linha inteira — buscar
  // so o basico aqui apagaria buying_type/datas/raw a cada acao de pausar/orcamento
  const r = await fetch(`${GRAPH}/${id}?fields=id,name,effective_status,objective,daily_budget,lifetime_budget,buying_type,bid_strategy,created_time,updated_time,start_time,stop_time,account_id&access_token=${encodeURIComponent(TOKEN)}`, { signal: AbortSignal.timeout(15000) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || json.error) throw new Error(`Meta Graph ${json.error?.code || r.status}: ${json.error?.message || 'campanha nao encontrada'}`);
  return json;
}

/** Atualiza o espelho meta_campanhas com o estado pos-acao (a aba reflete na hora). */
async function espelhar(campanha) {
  const account = `act_${campanha.account_id || ''}`.replace('act_act_', 'act_');
  const { error } = await db.rpc('meta_trafego_upsert', {
    p_chave: RPC_SECRET,
    p_campanhas: [campaignToRow(campanha, account)],
    p_anuncios: [],
    p_diario: [],
    p_limpar: false,
  });
  if (error) throw new Error(`espelho: ${error.message}`);
}

async function auditar(userEmail, acao, detalhes) {
  try {
    await db.from('activity_log').insert({
      user_email: userEmail,
      action: `trafego_${acao}`,
      details: detalhes,
    });
  } catch { /* auditoria nunca bloqueia a resposta, mas fica no Monitor tambem */ }
  await logAdvbox('meta', 'info', `trafego-action ${acao} por ${userEmail}`, detalhes);
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: JSONH });
  if (req.method !== 'POST') return resp(405, { error: 'somente POST' });
  if (!TOKEN) return resp(500, { error: 'META_ADS_TOKEN ausente' });

  // trava 1: usuario real via JWT do Supabase
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return resp(401, { error: 'sem credencial (Authorization: Bearer)' });
  const { data: userData, error: authErr } = await db.auth.getUser(jwt);
  const userEmail = (userData?.user?.email || '').toLowerCase();
  if (authErr || !userEmail) return resp(401, { error: 'sessao invalida — faca login de novo' });

  // trava 2: lista de quem opera trafego
  if (!TRAFEGO_ACAO_EMAILS.includes(userEmail)) {
    await logAdvbox('meta', 'aviso', `trafego-action NEGADO p/ ${userEmail}`, {});
    return resp(403, { error: 'sem permissao para operar campanhas' });
  }

  const body = await req.json().catch(() => ({}));
  const { acao, campaign_id: campaignId } = body;

  try {
    if (acao === 'config') {
      const { data: atual } = await db.from('bot_config').select('value').eq('key', 'meta_trafego').maybeSingle();
      const antes = atual?.value?.alertas || ALERTAS_DEFAULT;
      const depois = { ...ALERTAS_DEFAULT, ...antes, ...(body.alertas || {}) };
      // (v2 #8) metas da aba (ex.: leads_mes) convivem com os alertas na mesma config
      const metasAntes = atual?.value?.metas || {};
      const metasDepois = body.metas ? { ...metasAntes, ...body.metas } : metasAntes;
      await db.from('bot_config').upsert({
        key: 'meta_trafego',
        value: { ...(atual?.value || {}), alertas: depois, metas: metasDepois, atualizado_em: new Date().toISOString(), atualizado_por: userEmail },
        updated_at: new Date().toISOString(),
      });
      await auditar(userEmail, 'config', { antes, depois, metas: metasDepois });
      return resp(200, { success: true, alertas: depois, metas: metasDepois });
    }

    if (!campaignId) return resp(400, { error: 'campaign_id obrigatorio' });
    const antes = await graphGetCampanha(campaignId);

    if (acao === 'pausar' || acao === 'reativar') {
      const status = acao === 'pausar' ? 'PAUSED' : 'ACTIVE';
      await graphPost(campaignId, { status });
      const depois = await graphGetCampanha(campaignId);
      await espelhar(depois);
      await auditar(userEmail, acao, {
        campanha: antes.name, campaign_id: campaignId,
        antes: antes.effective_status, depois: depois.effective_status,
      });
      return resp(200, { success: true, status: depois.effective_status });
    }

    if (acao === 'orcamento') {
      const valorReais = Number(body.valor);
      if (!Number.isFinite(valorReais) || valorReais < 1) return resp(400, { error: 'valor (R$) invalido' });
      const centavos = Math.round(valorReais * 100);
      await graphPost(campaignId, { daily_budget: String(centavos) });
      const depois = await graphGetCampanha(campaignId);
      await espelhar(depois);
      await auditar(userEmail, 'orcamento', {
        campanha: antes.name, campaign_id: campaignId,
        antes_reais: antes.daily_budget ? Number(antes.daily_budget) / 100 : null,
        depois_reais: depois.daily_budget ? Number(depois.daily_budget) / 100 : null,
      });
      return resp(200, { success: true, orcamento_diario: depois.daily_budget ? Number(depois.daily_budget) / 100 : null });
    }

    return resp(400, { error: `acao desconhecida: ${acao}` });
  } catch (e) {
    await logAdvbox('meta', 'error', `trafego-action ${acao} falhou: ${e.message}`, { campaign_id: campaignId, user: userEmail });
    return resp(500, { error: e.message });
  }
};
