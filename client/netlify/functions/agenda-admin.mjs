/**
 * Ações server da aba "Agendamento Videochamada" (bot Ana): reagendar/cancelar uma
 * videochamada, marcar o desfecho (cor do evento), simular uma resposta da Ana (sem tocar
 * Kommo/Google) e pausar/retomar o bot num lead específico.
 *
 * SEGURANCA: JWT do Supabase (Authorization: Bearer) validado via db.auth.getUser(jwt) —
 * mesmo esqueleto de meta-trafego-action.mjs. Trava 2 (pos-review, item 3): NÃO é lista fixa
 * de e-mails feito meta-trafego-action.mjs — é a permissão REAL de `user_permissions` (coluna
 * `tabs->>'agenda'` OU `is_admin`), verificada no servidor via podeOperar() — a MESMA condição
 * que faz a aba aparecer no front (App.jsx `tabAllowed`). O RBAC do front só esconde o botão;
 * sem esta trava, qualquer sessão válida do domínio chamaria a function direto (curl/fetch)
 * mesmo sem a aba liberada.
 *
 * `vendedora_email` no body de reagendar/cancelar/desfecho é só um HINT do front — o calendarId
 * usado de fato é sempre `atual.vendedora_email` (a linha real, buscada via buscarAtendimento),
 * nunca o do body (ver resolverCalendarId — pos-review itens 1/2).
 *
 * POST { acao: 'reagendar'|'cancelar'|'desfecho'|'simular'|'pausar_lead', ... }
 *  - reagendar {event_id, vendedora_email, novo_inicio}
 *  - cancelar  {event_id, vendedora_email, motivo?, mover_perdido?}
 *  - desfecho  {event_id, vendedora_email, status: realizada|no_show|fechou}
 *  - simular   {mensagem, estado?}
 *  - pausar_lead {lead_id, horas, channel?}
 */
import { db, getConfig, logAdvbox, getConversation, upsertConversation } from './_lib/botDb.mjs';
import { getAccessToken, patchEventHorario, cancelEvent, setEventColor, COR_STATUS } from './_lib/googleAgenda.mjs';
import { decidir, estadoInicial, aplicarTemplate } from './_lib/agendaEngine.mjs';
import { formatarSlot } from './_lib/agendaSlots.mjs';
import { interpretar } from './_lib/agendaInterprete.mjs';
import { setLeadField, runSalesbot, moveLeadStage } from './_lib/kommo.mjs';
import { requireFields } from './_lib/validate.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const JSONH = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
// Deriva {realizada:'10', no_show:'11', fechou:'7'} do MESMO mapa de googleAgenda.mjs — evita
// duplicar os 3 pares status<->cor em dois arquivos.
const STATUS_TO_COR = Object.fromEntries(Object.entries(COR_STATUS).map(([cor, status]) => [status, cor]));

const resp = (status, body) => new Response(JSON.stringify(body), { status, headers: JSONH });

/**
 * Entre candidatas de bot_conversations com o mesmo lead_id (raro, mas possível se o lead
 * trocou de telefone), escolhe a mais recente por updated_at. PURA — a busca em si
 * (`context->>lead_id`) é uma query Supabase; só a ESCOLHA entre o resultado fica aqui,
 * isolada, para poder testar sem mockar o Supabase (usada por 'pausar_lead').
 */
export function escolherConversaPorLead(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows.reduce((best, r) => (!best || new Date(r.updated_at) > new Date(best.updated_at) ? r : best), null);
}

/**
 * ISO de "amanhã às 10h" em America/Sao_Paulo, offset fixo -03:00 (Brasil não tem DST desde
 * 2019 — mesma premissa já usada em agendaInterprete.mjs). PURA. Usada só para fabricar o
 * slot fake da ação 'simular' — nunca é um horário realmente ofertado a um lead.
 */
export function amanha10hSP(agora) {
  const d = new Date(agora.getTime() + 86400000);
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return `${ymd}T10:00:00-03:00`;
}

/**
 * Calendar ID REAL para cancelar/reagendar/desfecho: SEMPRE `atual.vendedora_email` (a linha
 * já buscada via buscarAtendimento/agenda_videochamadas_get), nunca o `vendedora_email` do
 * body. Bug corrigido (pos-review, itens 1/2): se o body mandasse um e-mail diferente do dono
 * real do evento, cancelEvent/patchEventHorario/setEventColor mexiam na agenda ERRADA — e como
 * `cancelEvent` TOLERA 404 (evento não existe naquela agenda), o cancelamento "funcionava"
 * silenciosamente (grava status='excluida') sem tocar o evento de verdade, que ficava
 * esquecido na agenda do dono real. PURA: só decide qual usar e se houve divergência; quem
 * chama loga o aviso (não bloqueia — o valor real sempre manda).
 */
export function resolverCalendarId(atual, vendedoraEmailBody) {
  const real = atual?.vendedora_email || null;
  const bodyNorm = String(vendedoraEmailBody || '').toLowerCase().trim();
  const realNorm = String(real || '').toLowerCase().trim();
  const divergiu = !!bodyNorm && !!realNorm && bodyNorm !== realNorm;
  return { calendarId: real, divergiu };
}

/**
 * Decide se o usuário pode operar a agenda: mesma condição que faz a aba aparecer no front
 * (App.jsx `tabAllowed`) — `tabs.agenda === true` OU `is_admin === true`. Comparação via
 * `String(...) === 'true'` (não só `=== true`) porque o equivalente em SQL seria
 * `tabs->>'agenda' = 'true'` (extração como texto); cobre tanto o boolean jsonb normal quanto
 * uma eventual string 'true' gravada por engano. `perms` null (usuário sem linha em
 * `user_permissions`) = SEM permissão — nunca abre por omissão. Fix pos-review, item 3: antes
 * a function só exigia domínio @advocaciacbc.com; qualquer sessão válida do domínio podia
 * chamar a function direto (curl/fetch), mesmo sem a aba liberada — o RBAC do front só
 * escondia o botão, não travava o servidor.
 */
export function podeOperar(perms) {
  if (!perms) return false;
  if (perms.is_admin === true) return true;
  return String(perms.tabs?.agenda) === 'true';
}

/**
 * Patch de reset ao reagendar um atendimento que já tinha desfecho marcado (no_show/realizada/
 * fechou): volta `status` p/ 'agendada' e limpa `color_id`. Sem isso, `agenda_bot_metricas`
 * continuaria contando um atendimento remarcado como concluído/no-show do agendamento
 * ANTERIOR, mesmo depois de uma nova data marcada. PURA. Fix pos-review, item 4.
 */
export function resetDesfechoAoReagendar(statusAtual) {
  return ['no_show', 'realizada', 'fechou'].includes(statusAtual) ? { status: 'agendada', color_id: null } : {};
}

/**
 * Cross-check do `channel` explícito (pausar_lead) contra o `lead_id` do payload: só retorna
 * true se o lead_id gravado no contexto do canal bate EXATAMENTE com o lead_id pedido. Fix
 * pos-review, item 5: antes, `contextLeadId` null/ausente pulava o check inteiro (tratado como
 * "bate") e pausava a conversa ERRADA quando o channel informado não pertencia de fato a esse
 * lead. PURA.
 */
export function channelPertenceAoLead(contextLeadId, bodyLeadId) {
  if (contextLeadId === undefined || contextLeadId === null) return false;
  return String(contextLeadId) === String(bodyLeadId);
}

/**
 * Busca a linha ATUAL de agenda_videochamadas via RPC (agenda_videochamadas_get, Task 10 —
 * ver supabase_agenda_bot.sql). Um SELECT direto na tabela NÃO funciona: RLS habilitada e
 * zero policies (fechada de propósito por causa do PII de cliente); só passa pela chave.
 */
async function buscarAtendimento(eventId) {
  const { data, error } = await db.rpc('agenda_videochamadas_get', { p_chave: RPC_SECRET, p_event_id: eventId });
  if (error) throw new Error(`busca atendimento: ${error.message}`);
  return data?.[0] || null;
}

/** Reconstrói a linha completa p/ o upsert a partir do que já está salvo, sobrepondo só o
 *  patch indicado — agenda_videochamadas_upsert SUBSTITUI a linha inteira; sem isso, campos
 *  como cliente_email/color_id/raw seriam apagados a cada reagendar/cancelar. */
function linhaParaUpsert(atual, patch) {
  return {
    event_id: atual.event_id, vendedora_email: atual.vendedora_email, cliente_email: atual.cliente_email,
    cliente_nome: atual.cliente_nome, status: atual.status, color_id: atual.color_id,
    scheduled_at: atual.scheduled_at, tem_meet: atual.tem_meet, origem: atual.origem,
    lead_id: atual.lead_id, telefone: atual.telefone, raw: atual.raw,
    ...patch,
  };
}

async function upsertVC(row) {
  const { error } = await db.rpc('agenda_videochamadas_upsert', { p_chave: RPC_SECRET, p_rows: [row] });
  if (error) throw new Error(`upsert vc: ${error.message}`);
}

// (CRITICAL — revisão final #1) reagendar aqui SEMPRE reaproveita o MESMO event_id
// (patchEventHorario nunca cria um evento novo) — por isso usa SEMPRE esta RPC dedicada em
// vez do upsert genérico + resetDesfechoAoReagendar: o upsert genérico não inclui
// lembrete_1h_em/lembrete_t0_em/noshow_msg_em na lista de colunas (de propósito — ver
// supabase_agenda_bot.sql), então esses 3 campos ficavam com os valores do agendamento
// ANTERIOR e o cron nunca mais disparava nada pro novo horário.
async function resetReagendamento({ eventId, novoInicio }) {
  const { error } = await db.rpc('agenda_videochamadas_reset_reagendamento', { p_chave: RPC_SECRET, p_event_id: eventId, p_novo_inicio: novoInicio });
  if (error) throw new Error(`reset reagendamento: ${error.message}`);
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: JSONH });
  if (req.method !== 'POST') return resp(405, { error: 'somente POST' });

  // JWT do Supabase — esqueleto de meta-trafego-action.mjs.
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return resp(401, { error: 'sem credencial (Authorization: Bearer)' });
  const { data: userData, error: authErr } = await db.auth.getUser(jwt);
  const userEmail = (userData?.user?.email || '').toLowerCase();
  if (authErr || !userEmail || !userEmail.endsWith('@advocaciacbc.com')) {
    return resp(401, { error: 'sessao invalida — faca login de novo' });
  }

  // Trava 2 (pos-review, item 3): permissao REAL no servidor — nao so o RBAC cosmetico do
  // front (que so esconde o botao). Le user_permissions.tabs.agenda (OU is_admin), a mesma
  // tabela/coluna que App.jsx usa p/ decidir se mostra a aba (RLS "allow all" nessa tabela —
  // leitura funciona com anon key ou service role key, o que `db` estiver usando).
  const { data: perms, error: permsErr } = await db.from('user_permissions')
    .select('tabs, is_admin').eq('email', userEmail).maybeSingle();
  if (permsErr) {
    await logAdvbox('agenda', 'error', `agenda-admin: falha ao checar permissao de ${userEmail}: ${permsErr.message}`, { userEmail });
    return resp(500, { error: 'falha ao verificar permissao' });
  }
  if (!podeOperar(perms)) {
    await logAdvbox('agenda', 'aviso', `agenda-admin NEGADO p/ ${userEmail} (sem tabs.agenda)`, { userEmail });
    return resp(403, { error: 'sem permissao para operar a agenda' });
  }

  const body = await req.json().catch(() => ({}));
  const { acao } = body;

  try {
    if (acao === 'reagendar') {
      const v = requireFields(body, ['event_id', 'vendedora_email', 'novo_inicio']);
      if (!v.ok) return resp(400, { error: v.motivo });
      const { event_id: eventId, vendedora_email: vendedoraEmail, novo_inicio: novoInicio } = body;
      if (Number.isNaN(Date.parse(novoInicio))) return resp(400, { error: 'novo_inicio invalido (ISO-8601 esperado)' });

      const atual = await buscarAtendimento(eventId);
      if (!atual) return resp(404, { error: 'atendimento nao encontrado para esse event_id' });

      // Calendar ID SEMPRE o real (atual.vendedora_email) — nunca o do body (ver resolverCalendarId).
      const { calendarId, divergiu } = resolverCalendarId(atual, vendedoraEmail);
      if (divergiu) {
        await logAdvbox('agenda', 'aviso',
          `reagendar: vendedora_email do body (${vendedoraEmail}) diverge do real (${atual.vendedora_email}) — usando o real`,
          { eventId, bodyVendedoraEmail: vendedoraEmail, real: atual.vendedora_email });
      }

      const cfgAll = await getConfig();
      const cfg = cfgAll.agenda_bot || {};
      const duracaoMin = cfg.regras?.duracao_evento_min || 30;
      const inicioISO = new Date(novoInicio).toISOString();
      const fimISO = new Date(new Date(novoInicio).getTime() + duracaoMin * 60000).toISOString();

      const accessToken = await getAccessToken();
      await patchEventHorario({ calendarId, eventId, inicioISO, fimISO, accessToken });
      // (CRITICAL — revisão final #1) RPC dedicada EM VEZ do upsert genérico +
      // resetDesfechoAoReagendar: reseta scheduled_at/status/color_id E os 3 timestamps de
      // lembrete/no-show num único UPDATE (ver comentário de resetReagendamento acima).
      await resetReagendamento({ eventId, novoInicio: inicioISO });
      // (IMPORTANT — revisão final #2) limpa a cor REAL do evento: sem isso, o sync (até
      // 45min) releria a cor antiga do Calendar e reverteria o status que o reset acima
      // acabou de zerar. Não fatal — o reset acima é a defesa principal. NOTA: o token OAuth
      // hoje é readonly, então isso só será exercitado de fato no piloto (pilot-verify).
      try {
        await setEventColor({ calendarId, eventId, colorId: null, accessToken });
      } catch (e) {
        await logAdvbox('agenda', 'aviso', `reagendar: limpar cor do evento falhou (nao fatal): ${e.message}`.slice(0, 300), { eventId });
      }

      // Mensagem opcional ao lead (só se dá pra falar): reusa o MESMO template/formatação
      // de confirmação que o worker usa (agendaEngine.confirmar), nunca uma string solta.
      // NAO fatal: o reagendamento real (Calendar + agenda_videochamadas) já aconteceu acima;
      // uma falha ao avisar o lead não pode virar 500 numa ação que, na prática, deu certo.
      let mensagemEnviada = false;
      if (atual.lead_id && cfg.kommo?.campo_ana_id && cfg.kommo?.salesbot_id && cfg.mensagens?.confirmado) {
        try {
          const f = formatarSlot(new Date(inicioISO), new Date());
          const [dia, hora] = f.includes(' às ') ? f.split(' às ') : ['', f];
          const mensagem = aplicarTemplate(cfg.mensagens.confirmado, { dia, hora });
          if (mensagem) {
            await setLeadField(atual.lead_id, cfg.kommo.campo_ana_id, mensagem);
            await runSalesbot(cfg.kommo.salesbot_id, atual.lead_id, 'leads');
            mensagemEnviada = true;
          }
        } catch (e) {
          await logAdvbox('agenda', 'aviso', `reagendar: mensagem ao lead falhou (nao fatal): ${e.message}`.slice(0, 300), { eventId, leadId: atual.lead_id });
        }
      }

      await logAdvbox('agenda', 'info', `admin ${userEmail} reagendou ${eventId} p/ ${inicioISO}`,
        { userEmail, eventId, vendedoraEmail: calendarId, leadId: atual.lead_id, mensagemEnviada });
      return resp(200, { success: true, event_id: eventId, scheduled_at: inicioISO, mensagem_enviada: mensagemEnviada });
    }

    if (acao === 'cancelar') {
      const v = requireFields(body, ['event_id', 'vendedora_email']);
      if (!v.ok) return resp(400, { error: v.motivo });
      const { event_id: eventId, vendedora_email: vendedoraEmail, motivo } = body;

      const atual = await buscarAtendimento(eventId);
      if (!atual) return resp(404, { error: 'atendimento nao encontrado para esse event_id' });

      // Calendar ID SEMPRE o real (atual.vendedora_email) — nunca o do body (ver resolverCalendarId).
      // CRITICO aqui especificamente: cancelEvent TOLERA 404 (agenda errada = evento "nao existe"
      // ali), entao um calendarId errado gravaria status='excluida' sem cancelar o evento real.
      const { calendarId, divergiu } = resolverCalendarId(atual, vendedoraEmail);
      if (divergiu) {
        await logAdvbox('agenda', 'aviso',
          `cancelar: vendedora_email do body (${vendedoraEmail}) diverge do real (${atual.vendedora_email}) — usando o real`,
          { eventId, bodyVendedoraEmail: vendedoraEmail, real: atual.vendedora_email });
      }

      const accessToken = await getAccessToken();
      await cancelEvent({ calendarId, eventId, accessToken });
      await upsertVC(linhaParaUpsert(atual, { status: 'excluida' }));

      // Etapa "perdido" é OPCIONAL (cancelar nem sempre significa negócio perdido — pode ser
      // um reagendamento manual fora do fluxo) — só move se o caller pedir explicitamente.
      // NAO fatal, mesmo motivo do reagendar: o cancelamento real já aconteceu acima.
      let movidoPerdido = false;
      if (body.mover_perdido && atual.lead_id) {
        try {
          const cfgAll = await getConfig();
          const etapa = cfgAll.agenda_bot?.kommo?.etapa_perdido;
          if (etapa?.pipeline_id && etapa?.status_id) {
            await moveLeadStage(atual.lead_id, { pipelineId: etapa.pipeline_id, statusId: etapa.status_id });
            movidoPerdido = true;
          }
        } catch (e) {
          await logAdvbox('agenda', 'aviso', `cancelar: mover p/ perdido falhou (nao fatal): ${e.message}`.slice(0, 300), { eventId, leadId: atual.lead_id });
        }
      }

      await logAdvbox('agenda', 'info', `admin ${userEmail} cancelou ${eventId} (${motivo || 'sem motivo informado'})`,
        { userEmail, eventId, vendedoraEmail: calendarId, motivo: motivo || null, leadId: atual.lead_id, movidoPerdido });
      return resp(200, { success: true, event_id: eventId, status: 'excluida', movido_perdido: movidoPerdido });
    }

    if (acao === 'desfecho') {
      const v = requireFields(body, ['event_id', 'vendedora_email', 'status']);
      if (!v.ok) return resp(400, { error: v.motivo });
      const { event_id: eventId, vendedora_email: vendedoraEmail, status } = body;
      const colorId = STATUS_TO_COR[status];
      if (!colorId) return resp(400, { error: 'status invalido (realizada|no_show|fechou)' });

      // Checagem de existencia (pos-review, item 2): antes ia direto ao setEventColor sem
      // validar que o event_id e um atendimento rastreado — mesma RPC das outras acoes.
      const atual = await buscarAtendimento(eventId);
      if (!atual) return resp(404, { error: 'atendimento nao encontrado para esse event_id' });

      // Calendar ID SEMPRE o real (atual.vendedora_email) — nunca o do body (ver resolverCalendarId).
      const { calendarId, divergiu } = resolverCalendarId(atual, vendedoraEmail);
      if (divergiu) {
        await logAdvbox('agenda', 'aviso',
          `desfecho: vendedora_email do body (${vendedoraEmail}) diverge do real (${atual.vendedora_email}) — usando o real`,
          { eventId, bodyVendedoraEmail: vendedoraEmail, real: atual.vendedora_email });
      }

      // Só a cor do evento — o sync de calendário (a cada 45min) espelha cor->status na
      // linha; não precisamos (nem devemos) mexer em agenda_videochamadas aqui.
      const accessToken = await getAccessToken();
      await setEventColor({ calendarId, eventId, colorId, accessToken });

      await logAdvbox('agenda', 'info', `admin ${userEmail} marcou desfecho ${eventId} = ${status}`,
        { userEmail, eventId, vendedoraEmail: calendarId, status, colorId });
      return resp(200, { success: true, event_id: eventId, status, color_id: colorId });
    }

    if (acao === 'simular') {
      const v = requireFields(body, ['mensagem']);
      if (!v.ok) return resp(400, { error: v.motivo });

      const cfgAll = await getConfig();
      const cfg = cfgAll.agenda_bot;
      if (!cfg) return resp(500, { error: 'bot_config agenda_bot ausente' });

      const estado = body.estado || estadoInicial({ lead_id: 0 });
      const agora = new Date();
      // Único caminho desta function que chama a API Anthropic de verdade — é o propósito
      // do simulador (testar o prompt/engine sem afetar Kommo/Google).
      const interp = await interpretar({ mensagem: body.mensagem, estado, cfg });
      const vend = (cfg.vendedoras || []).find((x) => x.ativa);
      const slotsDisponiveis = [{ inicio: amanha10hSP(agora), vendedoras: vend ? [vend.email] : [] }];
      const { acoes, novoEstado } = decidir({ estado, interp, cfg, agora, slotsDisponiveis });

      return resp(200, { interp, acoes, novoEstado });
    }

    if (acao === 'pausar_lead') {
      const v = requireFields(body, ['lead_id']);
      if (!v.ok) return resp(400, { error: v.motivo });
      const horas = Number(body.horas);
      if (!Number.isFinite(horas) || horas < 0) return resp(400, { error: 'horas deve ser um numero >= 0 (0 = retomar)' });

      let channel = body.channel || null;
      let row = null;
      if (channel) {
        // Cross-check OBRIGATORIO (pos-review, item 5): channel explicito so serve se o
        // lead_id gravado no contexto bate EXATAMENTE com o lead_id do payload. Antes,
        // context.lead_id null/ausente pulava o check (tratado como "bate") e pausava a
        // conversa ERRADA quando o channel nao correspondia de fato a esse lead — agora cai
        // no 404 comum abaixo, igual a qualquer outro "nao encontrei".
        const candidata = await getConversation(channel);
        if (candidata && channelPertenceAoLead(candidata.context?.lead_id, body.lead_id)) {
          row = candidata;
        }
      } else {
        // Não temos o telefone, só o lead_id — busca por context->>lead_id (gravado por
        // estadoInicial em todo canal 'agenda:%'; ver agenda-bot-worker-background.mjs).
        const { data, error } = await db.from('bot_conversations').select('*')
          .like('channel', 'agenda:%').eq('context->>lead_id', String(body.lead_id));
        if (error) throw new Error(`busca conversa: ${error.message}`);
        row = escolherConversaPorLead(data || []);
        channel = row?.channel || null;
      }
      if (!row || !channel) return resp(404, { error: 'conversa nao encontrada para esse lead_id' });

      const pausadaAte = horas > 0 ? new Date(Date.now() + horas * 3600000).toISOString() : null;
      await upsertConversation(channel, { context: { ...(row.context || {}), pausada_ate: pausadaAte } });

      await logAdvbox('agenda', 'info', `admin ${userEmail} ${horas > 0 ? 'pausou' : 'retomou'} lead ${body.lead_id}`,
        { userEmail, leadId: body.lead_id, horas, channel, pausadaAte });
      return resp(200, { success: true, channel, pausada_ate: pausadaAte });
    }

    return resp(400, { error: `acao desconhecida: ${acao}` });
  } catch (e) {
    await logAdvbox('agenda', 'error', `agenda-admin ${acao} falhou: ${e.message}`, { userEmail, acao });
    return resp(500, { error: e.message });
  }
};
