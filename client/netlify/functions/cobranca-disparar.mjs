/**
 * Netlify Function (HTTP): dispara cobranca de inadimplentes (sob demanda).
 * Auth: BOT_PANEL_KEY (header x-bot-key ou body.key).
 *
 * Body: { template: string, cpfs: string[], dryRun?: bool, userEmail?: string }
 * UNIDADE = devedor (CPF). Para cada devedor elegivel enfileira UM job composto
 * 'cobranca_send' (seta o campo do lead + roda o Salesbot do template) e registra
 * em cobranca_disparos. Pulados (sem_lead/opt_out/cooldown) sao contados, nao enviados.
 *
 * dryRun=true: so calcula o preview (quem entra / quem pula e por que), sem enfileirar
 * nem gravar nada.
 */
import { db, getConfig, logAdvbox, heartbeat } from './_lib/botDb.mjs';
import { enqueueKommo, kommoConfigured } from './_lib/kommo.mjs';
import { avaliarElegibilidade, dedupeKey, digits } from './_lib/cobranca.mjs';

const PANEL_KEY = process.env.BOT_PANEL_KEY || '';
const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, x-bot-key' };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  const body = await req.json().catch(() => ({}));
  const key = req.headers.get('x-bot-key') || body.key || '';
  if (!PANEL_KEY || key !== PANEL_KEY) return json({ ok: false, error: 'unauthorized' }, 401);

  const templateName = String(body.template || '').trim();
  const cpfs = (Array.isArray(body.cpfs) ? body.cpfs : []).map(digits).filter(Boolean);
  const dryRun = body.dryRun === true;
  const userEmail = String(body.userEmail || '').slice(0, 120);
  if (!templateName) return json({ ok: false, error: 'template obrigatorio' }, 400);
  if (!cpfs.length) return json({ ok: false, error: 'nenhum devedor selecionado' }, 400);

  try {
    const cfg = (await getConfig()).cobranca || {};
    const tpl = (cfg.templates || []).find((t) => t.name === templateName);
    if (!tpl) return json({ ok: false, error: `template "${templateName}" nao encontrado em bot_config.cobranca` }, 400);
    // Campo do lead onde gravamos o LINK do boleto-ancora (invoice_url do Asaas, sempre com
    // 2a via + PIX atualizados). O Salesbot ecoa esse campo quando o cliente toca "Boleto atualizado".
    const fieldId = cfg.field_id_link || null;

    const { data, error } = await db.rpc('cobranca_inadimplentes', { p_chave: RPC_SECRET });
    if (error) throw new Error(error.message);
    const hoje = new Date().toISOString().slice(0, 10);
    const selset = new Set(cpfs);
    const selecionados = (data || []).filter((d) => selset.has(digits(d.cpf)));

    const preview = { enviar: 0, pulados: {} };
    const enviaveis = [];
    for (const d of selecionados) {
      const el = avaliarElegibilidade(d, cfg, hoje);
      if (!el.elegivel) { preview.pulados[el.motivo] = (preview.pulados[el.motivo] || 0) + 1; continue; }
      preview.enviar++;
      enviaveis.push(d);
    }

    if (dryRun) return json({ ok: true, dryRun: true, total: selecionados.length, preview });

    // validacoes do envio real
    if (!kommoConfigured()) return json({ ok: false, error: 'KOMMO_TOKEN ausente no ambiente' }, 503);
    if (!tpl.bot_id) return json({ ok: false, error: `template "${templateName}" sem Salesbot (bot_id) configurado em bot_config.cobranca` }, 400);

    const rows = [];
    let enfileirados = 0;
    for (const d of enviaveis) {
      const rowBase = {
        customer_cpf: digits(d.cpf), customer_name: d.customer_name, lead_id: d.lead_id || null,
        template_name: templateName, canal: 'whatsapp_kommo', boleto_ancora_id: d.boleto_ancora_id || null,
        total_em_aberto_no_disparo: d.total_em_aberto, parcelas_no_disparo: d.parcelas,
        dias_atraso_no_disparo: d.maior_atraso_dias, disparado_por: userEmail,
        dedupe_key: dedupeKey(d.cpf, templateName, hoje),
      };
      try {
        const job = await enqueueKommo('cobranca_send',
          { leadId: String(d.lead_id), fieldId, value: d.ancora_link || '', botId: tpl.bot_id },
          { source: 'cobranca', priority: 3, dedupeKey: `cobranca_send:${d.lead_id}:${templateName}:${hoje}` });
        rows.push({ ...rowBase, resultado: 'enfileirado', motivo_pulo: null, kommo_queue_id: job?.id || null });
        enfileirados++;
      } catch (e) {
        rows.push({ ...rowBase, resultado: 'erro', motivo_pulo: null, kommo_queue_id: null });
        await logAdvbox('asaas', 'erro', `cobranca enqueue lead ${d.lead_id}: ${e.message}`.slice(0, 200), {});
      }
    }

    if (rows.length) {
      const { error: regErr } = await db.rpc('cobranca_disparo_registrar', { p_chave: RPC_SECRET, p_rows: rows });
      if (regErr) await logAdvbox('asaas', 'erro', `cobranca_disparo_registrar: ${regErr.message}`.slice(0, 200), {});
    }
    await logAdvbox('asaas', 'info', `cobranca "${templateName}": ${enfileirados} enfileirados; pulados ${JSON.stringify(preview.pulados)}`, { por: userEmail });
    await heartbeat('cobranca-disparar', true, `${enfileirados} enfileirados`);
    return json({ ok: true, enfileirados, pulados: preview.pulados, registrados: rows.length });
  } catch (e) {
    await logAdvbox('asaas', 'erro', `cobranca-disparar: ${e.message}`.slice(0, 300), {});
    return json({ ok: false, error: e.message }, 500);
  }
};
