/**
 * Netlify Function (HTTP): lista de inadimplentes para o painel de Cobranca.
 * Auth: BOT_PANEL_KEY (header x-bot-key ou body.key) — mesma chave do painel do Bot.
 * Le via RPC cobranca_inadimplentes (SECURITY DEFINER, BOT_RPC_SECRET) e anexa a
 * elegibilidade (cooldown/opt-out/lead) calculada pela logica pura _lib/cobranca.
 */
import { db, getConfig, logAdvbox } from './_lib/botDb.mjs';
import { avaliarElegibilidade } from './_lib/cobranca.mjs';

const PANEL_KEY = process.env.BOT_PANEL_KEY || '';
const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, x-bot-key' };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  const body = await req.json().catch(() => ({}));
  const key = req.headers.get('x-bot-key') || body.key || '';
  if (!PANEL_KEY || key !== PANEL_KEY) return json({ ok: false, error: 'unauthorized' }, 401);

  try {
    const cfg = (await getConfig().catch(() => ({}))).cobranca || {};
    const { data, error } = await db.rpc('cobranca_inadimplentes', { p_chave: RPC_SECRET });
    if (error) throw new Error(error.message);

    const hoje = new Date().toISOString().slice(0, 10);
    const resumo = { total: 0, elegiveis: 0, por_match: {} };
    const lista = (data || []).map((d) => {
      const el = avaliarElegibilidade(d, cfg, hoje);
      resumo.total++;
      resumo.por_match[d.match_source] = (resumo.por_match[d.match_source] || 0) + 1;
      if (el.elegivel) resumo.elegiveis++;
      return { ...d, elegivel: el.elegivel, motivo: el.motivo };
    });

    return json({
      ok: true,
      cfg: {
        templates: cfg.templates || [],
        janela_pagamento_dias: cfg.janela_pagamento_dias ?? 7,
        cooldown_dias: cfg.cooldown_dias ?? 5,
      },
      resumo,
      lista,
    });
  } catch (e) {
    await logAdvbox('asaas', 'erro', `cobranca-listar: ${e.message}`.slice(0, 300), {});
    return json({ ok: false, error: e.message }, 500);
  }
};
