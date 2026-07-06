/**
 * Netlify Function (HTTP): dispara os links de assinatura do ZapSign pelo WhatsApp
 * via Kommo (campo do lead + Salesbot), SOMENTE dentro da janela de 24h da Meta.
 * Chamada fire-and-forget pelo App apos salvar o envio (onSaveAfterSend).
 *
 * Regras aprovadas (spec 2026-07-02-assinatura-whatsapp-kommo-design.md):
 *  - 1 disparo por contrato (lock atomico em contratos.kommo_assinatura — REGRA #3);
 *  - contratantes no MESMO lead => UMA mensagem com todos os links (nunca duplicar);
 *  - fora da janela => NAO envia, NAO re-tenta depois; posta nota interna no lead
 *    (com os links) p/ o vendedor enviar manualmente; a UI (faixa M2) avisa a equipe.
 *
 * Kill-switch: bot_config.kommo.assinatura.ativo (default false). Config incompleta
 * (sem Salesbot/campo) NAO consome o disparo unico — sai antes do lock.
 */
import { db, getConfig, logAdvbox, heartbeat } from './_lib/botDb.mjs';
import {
  kommoConfigured, kommoGet, kommoPost, findCustomFieldByName,
  enqueueKommo, drainNow, postNote, mainContactOfLead,
} from './_lib/kommo.mjs';
import { parearSigners, agruparPorLead, montarMensagem, janelaAberta } from './_lib/assinaturaWhatsapp.mjs';

const PANEL_KEY = process.env.BOT_PANEL_KEY || '';
const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, x-bot-key' };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });

// Cacheia field_id/bot_id descobertos em bot_config.kommo.assinatura (padrao kommo-asaas-sync).
async function salvarConfigAssinatura(patch) {
  const { data } = await db.from('bot_config').select('value').eq('key', 'kommo').maybeSingle();
  const value = data?.value || {};
  value.assinatura = { ...(value.assinatura || {}), ...patch };
  await db.from('bot_config').upsert({ key: 'kommo', value, updated_at: new Date().toISOString() });
}

// Campo "CBC Assinatura" no lead: config -> busca por nome -> cria (textarea).
async function ensureField(cfg) {
  if (cfg.field_id) return Number(cfg.field_id);
  const nome = cfg.field_name || 'CBC Assinatura';
  const found = await findCustomFieldByName(nome).catch(() => null);
  if (found?.entity === 'leads' && found.field_id) {
    await salvarConfigAssinatura({ field_id: found.field_id });
    return Number(found.field_id);
  }
  const criado = await kommoPost('/leads/custom_fields', [{ name: nome, type: 'textarea' }]);
  const fieldId = criado?._embedded?.custom_fields?.[0]?.id;
  if (!fieldId) throw new Error('nao consegui criar o campo personalizado no Kommo');
  await salvarConfigAssinatura({ field_id: fieldId });
  await logAdvbox('kommo', 'info', `assinatura: campo "${nome}" criado no Kommo (field_id ${fieldId})`, {});
  return Number(fieldId);
}

// Salesbot "CBC - Link Assinatura": config -> lookup por nome via GET /bots.
// Criacao e MANUAL no Kommo (POST /api/v4/bots = 405) — sem bot, sai sem consumir o disparo.
async function ensureBot(cfg) {
  if (cfg.bot_id) return Number(cfg.bot_id);
  const alvo = String(cfg.bot_name || 'CBC - Link Assinatura').trim().toLowerCase();
  try {
    const r = await kommoGet('/bots?limit=250');
    const bots = r?._embedded?.bots || (Array.isArray(r) ? r : []);
    const bot = bots.find((b) => String(b?.name || '').trim().toLowerCase() === alvo);
    if (bot?.id) {
      await salvarConfigAssinatura({ bot_id: bot.id });
      await logAdvbox('kommo', 'info', `assinatura: Salesbot "${cfg.bot_name}" encontrado (bot_id ${bot.id})`, {});
      return Number(bot.id);
    }
  } catch (e) {
    await logAdvbox('kommo', 'aviso', `assinatura: lookup de Salesbot falhou (${e.message}) — configure bot_id em bot_config.kommo.assinatura`, {});
  }
  return null;
}

// Ultima mensagem RECEBIDA do cliente na conversa do lead (created_at em epoch segundos).
// (validado ao vivo 02/07) events de chat NAO retornam filtrando por LEAD — so por
// CONTATO. Resolve o contato principal do lead e consulta por ele; mantem a variante
// por lead como fallback. 204 (sem eventos) => null => janela fechada (fail-safe).
async function ultimaMsgCliente(leadId) {
  const caminhos = [];
  const contactId = await mainContactOfLead(leadId).catch(() => null);
  if (contactId) caminhos.push(`/events?filter[type]=incoming_chat_message&filter[entity]=contact&filter[entity_id][]=${encodeURIComponent(contactId)}&limit=1`);
  caminhos.push(`/events?filter[type]=incoming_chat_message&filter[entity]=lead&filter[entity_id][]=${encodeURIComponent(leadId)}&limit=1`);
  for (const path of caminhos) {
    const r = await kommoGet(path);
    const ev = r?._embedded?.events?.[0];
    if (ev?.created_at) return ev.created_at;
  }
  return null;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'metodo' }, 405);
  const body = await req.json().catch(() => ({}));
  const key = req.headers.get('x-bot-key') || body.key || '';
  if (!PANEL_KEY || key !== PANEL_KEY) return json({ ok: false, error: 'unauthorized' }, 401);

  const contratoId = body.contratoId;
  if (!contratoId) return json({ ok: false, error: 'contratoId obrigatorio' }, 400);

  try {
    const cfg = (await getConfig()).kommo?.assinatura || {};
    if (cfg.ativo !== true) return json({ ok: true, skipped: 'assinatura desativada (bot_config.kommo.assinatura.ativo)' });
    if (!kommoConfigured()) return json({ ok: false, error: 'KOMMO_TOKEN ausente' }, 503);

    // Config completa ANTES do lock — config faltando nao pode queimar o disparo unico.
    const botId = await ensureBot(cfg);
    if (!botId) return json({ ok: true, skipped: 'Salesbot nao configurado — crie "CBC - Link Assinatura" no Kommo' });
    const fieldId = await ensureField(cfg);

    // LOCK atomico (REGRA #3): so processa quem ainda nao foi tentado.
    const startedAt = new Date().toISOString();
    const { data: locked, error: lockErr } = await db.from('contratos')
      .update({ kommo_assinatura: { status: 'processando', started_at: startedAt } })
      .eq('id', contratoId)
      .eq('status', 'enviado_zapsign')
      .is('kommo_assinatura', null)
      .select('id, zapsign_links, dados');
    if (lockErr) throw lockErr;
    if (!locked?.length) return json({ ok: true, skipped: 'ja processado ou contrato fora do estado enviado_zapsign' });

    const contrato = locked[0];
    const signers = contrato.zapsign_links || [];
    const contratantes = contrato.dados?.contratantes || [];
    const leads = [];

    if (!signers.length) {
      leads.push({ leadId: null, contratantes: [], resultado: 'erro', erro: 'contrato sem zapsign_links' });
    } else {
      const { grupos, invalidos } = agruparPorLead(parearSigners(signers, contratantes));
      for (const nome of invalidos) {
        leads.push({ leadId: null, contratantes: [nome], resultado: 'erro', erro: 'sem link Kommo valido no contratante' });
      }

      for (const g of grupos) {
        const nomes = g.itens.map((i) => i.nome);
        try {
          const last = await ultimaMsgCliente(g.leadId);
          const jan = janelaAberta(last, new Date().toISOString(), cfg.janela_margem_min ?? 60);
          const lastIso = (typeof last === 'number') ? new Date(last * 1000).toISOString() : (last || null);

          if (jan.aberta) {
            const mensagem = montarMensagem(g.itens, cfg);
            const job = await enqueueKommo('assinatura_send',
              { leadId: String(g.leadId), fieldId, value: mensagem, botId },
              { source: 'assinatura', priority: 2, dedupeKey: `assinatura:${contratoId}:${g.leadId}` });
            await drainNow(job.id); // envia agora; se falhar transitorio, o worker da fila entrega
            leads.push({ leadId: g.leadId, contratantes: nomes, resultado: 'enviado', sent_at: new Date().toISOString(), last_msg_at: lastIso });
          } else {
            // Fora da janela: NAO envia e NAO re-tenta (decisao Paulo 02/07).
            // Nota interna (idempotente) com os links p/ o vendedor mandar manualmente.
            const linksTxt = g.itens.map((i) => `• ${i.nome}: ${i.link}`).join('\n');
            const texto = ['✍️ Contrato enviado para assinatura — link NAO foi ao WhatsApp',
              'Cliente fora da janela de 24h (sem mensagem recebida recente).',
              'Envie o link manualmente por esta conversa:', linksTxt].join('\n');
            await postNote(g.leadId, `CBC.assinatura.manual:${contratoId}`, texto);
            leads.push({ leadId: g.leadId, contratantes: nomes, resultado: 'fora_janela', last_msg_at: lastIso });
          }
        } catch (e) {
          leads.push({ leadId: g.leadId, contratantes: nomes, resultado: 'erro', erro: String(e.message || e).slice(0, 200) });
        }
      }
    }

    const enviados = leads.filter((l) => l.resultado === 'enviado').length;
    const status = enviados === leads.length && enviados > 0 ? 'ok'
      : enviados > 0 ? 'parcial'
      : leads.some((l) => l.resultado === 'fora_janela') && !leads.some((l) => l.resultado === 'erro') ? 'fora_janela'
      : 'erro';

    const final = { status, started_at: startedAt, checked_at: new Date().toISOString(), leads };
    await db.from('contratos').update({ kommo_assinatura: final }).eq('id', contratoId);

    const resumo = `assinatura contrato ${contratoId}: ${status} (${enviados}/${leads.length} enviados)`;
    await logAdvbox('kommo', status === 'ok' ? 'info' : 'aviso', resumo, { contratoId, leads });
    await heartbeat('kommo-assinatura', status !== 'erro', resumo);
    return json({ ok: true, status, leads });
  } catch (e) {
    // Nunca deixa o lock orfao em 'processando': grava o erro no contrato.
    try {
      await db.from('contratos').update({
        kommo_assinatura: { status: 'erro', checked_at: new Date().toISOString(), leads: [], erro: String(e.message || e).slice(0, 300) },
      }).eq('id', contratoId).eq('kommo_assinatura->>status', 'processando');
    } catch { /* best-effort */ }
    await logAdvbox('kommo', 'erro', `kommo-assinatura-send ${contratoId}: ${e.message}`.slice(0, 300), {});
    await heartbeat('kommo-assinatura', false, e.message);
    return json({ ok: false, error: e.message }, 500);
  }
};
