/**
 * Netlify BACKGROUND Function: advbox-bot-worker-background
 * Processa a mensagem recebida via webhook do Kommo:
 *   1. Extrai texto + contact_id do payload (form-encoded ou JSON)
 *   2. SO responde se o telefone do contato estiver em bot_testers (modo teste!)
 *   3. Roda o motor do bot (ADVBOX + templates)
 *   4. Grava a resposta no campo personalizado e dispara o Salesbot
 *      (caminho oficial do Kommo para mensagem "proativa")
 *   5. Se escalar, cria tarefa no Kommo para o responsavel
 */
import { handleMessage } from './_lib/botEngine.mjs';
import { db, getConfig, findTesterByPhone, logAdvbox } from './_lib/botDb.mjs';
import { kommoConfigured, getContact, extractPhones, firstLeadId, setLeadField, setContactField, runSalesbot, createKommoTask, postNote } from './_lib/kommo.mjs';

function parsePayload(contentType, raw) {
  // JSON direto
  if (contentType.includes('json')) {
    try {
      const j = JSON.parse(raw);
      const m = j?.message?.add?.[0] || j?.payload?.message?.add?.[0] || j?.message || {};
      // (resil-2) id unico da mensagem do Kommo (chat_message_id/id), p/ dedup
      const msgId = m.chat_message_id || m.id || m.message_id || null;
      return { text: m.text || '', contactId: m.contact_id || m.contactId || null, type: m.type || m.origin || '', msgId };
    } catch { return null; }
  }
  // form-encoded: message[add][0][...]
  const params = new URLSearchParams(raw);
  const get = (k) => params.get(`message[add][0][${k}]`) || params.get(`unsorted[add][0][source_data][${k}]`) || '';
  const text = get('text');
  const contactId = get('contact_id') || get('element_id');
  const type = get('type') || get('origin') || '';
  // (resil-2) id unico da mensagem do Kommo, p/ dedup
  const msgId = get('chat_message_id') || get('id') || get('message_id') || null;
  if (!text && !contactId) return null;
  return { text, contactId, type, msgId };
}

/**
 * (resil-2) Idempotencia: o Kommo reenvia o evento add_message se nao
 * respondermos rapido, fazendo o bot responder a MESMA mensagem 2x.
 * Tenta reservar a mensagem inserindo seu id em bot_processed_messages
 * (msg_id text PK). Retorna true se ja foi processada (conflito de chave) =>
 * o caller deve abortar. Best-effort: qualquer outra falha NAO bloqueia
 * o processamento (retorna false).
 */
async function alreadyProcessed(msg) {
  try {
    let key = msg.msgId ? `k:${msg.msgId}` : null;
    if (!key) {
      // sem id no payload: chave estavel por lead/contato + texto + minuto
      const minuto = Math.floor(Date.now() / 60000);
      const txt = String(msg.text || '').slice(0, 200);
      key = `c:${msg.contactId}:${minuto}:${txt}`;
    }
    const { error } = await db.from('bot_processed_messages').insert({ msg_id: key });
    if (!error) return false; // reservou agora => primeira vez
    // 23505 = unique_violation (ja existe) => duplicado, abortar
    if (error.code === '23505' || /duplicate key|already exists/i.test(error.message || '')) {
      return true;
    }
    // qualquer outro erro (tabela ausente, permissao etc.): nao bloqueia
    console.warn('[bot-worker] dedup best-effort falhou (segue):', error.message);
    return false;
  } catch (e) {
    console.warn('[bot-worker] dedup best-effort excecao (segue):', e.message);
    return false;
  }
}

export default async (req) => {
  try {
    const { contentType = '', raw = '' } = await req.json();
    const msg = parsePayload(contentType, raw);
    if (!msg || !msg.text || !msg.contactId) {
      console.log('[bot-worker] payload sem texto/contato — ignorado');
      return new Response('ok');
    }
    // ignora mensagens de saida (do proprio atendente/bot)
    if (msg.type && /out|robot|bot/i.test(String(msg.type)) && !/incoming|in/i.test(String(msg.type))) {
      console.log(`[bot-worker] mensagem nao-incoming (type=${msg.type}) — ignorada`);
      return new Response('ok');
    }
    if (!kommoConfigured()) { console.error('[bot-worker] KOMMO_TOKEN ausente'); return new Response('ok'); }

    // (resil-2) dedup: aborta se o Kommo reenviou a mesma mensagem (evita responder 2x)
    if (await alreadyProcessed(msg)) {
      console.log(`[bot-worker] mensagem ja processada (msgId=${msg.msgId || 'composto'}) — ignorada`);
      return new Response('ok');
    }

    const cfg = await getConfig();
    const kommoCfg = cfg.kommo || {};
    if (!kommoCfg.ativo) { console.log('[bot-worker] bot desativado em bot_config.kommo.ativo'); return new Response('ok'); }

    const contact = await getContact(msg.contactId);
    const phones = extractPhones(contact);

    // MODO TESTE: so responde a testadores cadastrados
    let tester = null;
    for (const ph of phones) { tester = await findTesterByPhone(ph); if (tester) break; }
    if (!tester) {
      console.log(`[bot-worker] contato ${msg.contactId} (${phones.join(',') || 'sem fone'}) nao e testador — ignorado`);
      return new Response('ok');
    }

    const channel = `wa:${String(tester.phone).replace(/\D/g, '')}`;
    const t0 = Date.now();
    const result = await handleMessage({ channel, text: msg.text, tester });
    console.log(`[bot-worker] tester=${tester.name} intent=${result.intent} ${Date.now() - t0}ms`);

    // entrega: grava no campo e dispara o Salesbot
    const leadId = firstLeadId(contact);
    const preferLead = (kommoCfg.entidade_preferida || 'lead') === 'lead' && leadId && kommoCfg.field_id_lead;
    let entityId, entityType;
    if (preferLead) {
      await setLeadField(leadId, kommoCfg.field_id_lead, result.reply);
      entityId = leadId; entityType = 'leads';
    } else if (kommoCfg.field_id_contato) {
      await setContactField(msg.contactId, kommoCfg.field_id_contato, result.reply);
      entityId = msg.contactId; entityType = 'contacts';
    } else {
      console.error('[bot-worker] nenhum field_id configurado em bot_config.kommo');
      return new Response('ok');
    }

    if (kommoCfg.bot_id) {
      await runSalesbot(kommoCfg.bot_id, entityId, entityType);
      console.log(`[bot-worker] salesbot ${kommoCfg.bot_id} disparado em ${entityType}/${entityId}`);
    } else {
      console.error('[bot-worker] bot_id nao configurado em bot_config.kommo — resposta gravada no campo, sem envio');
    }

    // escalonamento: cria tarefa para humano + nota com o resumo da conversa (#20)
    if (result.escalate) {
      try {
        const target = leadId ? { id: leadId, type: 'leads' } : { id: msg.contactId, type: 'contacts' };
        await createKommoTask(target.id, target.type,
          `🤖 Bot: testador ${tester.name} pediu atendimento humano. Última msg: "${msg.text.slice(0, 200)}"`, 24);
      } catch (e) { console.error('[bot-worker] falha ao criar tarefa:', e.message); }
      try {
        if (leadId && result.conversation?.id) {
          const { data: msgs } = await db.from('bot_messages')
            .select('direction, text, created_at')
            .eq('conversation_id', result.conversation.id)
            .order('created_at', { ascending: false }).limit(8);
          const resumo = (msgs || []).reverse()
            .map(m => `${m.direction === 'in' ? '👤' : '🤖'} ${String(m.text || '').slice(0, 160)}`)
            .join('\n');
          await postNote(leadId, `CBC.bot.handoff:${result.conversation.id}:${Date.now()}`,
            `🤖→👤 Cliente pediu atendimento humano no bot.\n\nResumo da conversa:\n${resumo}\n\n— transferido pelo Bot ADVBOX.`);
        }
      } catch (e) { console.error('[bot-worker] falha ao postar resumo:', e.message); }
    }
  } catch (err) {
    console.error('[bot-worker] erro:', err);
    await logAdvbox('bot', 'erro', `falha ao processar mensagem do WhatsApp: ${err.message}`, {});
  }
  return new Response('ok');
};

export const config = { path: '/.netlify/functions/advbox-bot-worker-background' };
