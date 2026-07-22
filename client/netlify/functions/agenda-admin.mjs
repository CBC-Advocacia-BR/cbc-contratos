/**
 * Ações server da aba "Agendamento Videochamada" (bot Ana): reagendar/cancelar uma
 * videochamada, marcar o desfecho (cor do evento), simular uma resposta da Ana (sem tocar
 * Kommo/Google) e pausar/retomar o bot num lead específico.
 *
 * SEGURANCA: JWT do Supabase (Authorization: Bearer) validado via db.auth.getUser(jwt) —
 * mesmo esqueleto de meta-trafego-action.mjs. DIFERENTE de lá: aqui NÃO há trava 2 por lista
 * fixa de e-mails — quem VÊ a aba já passou pelo RBAC do front (permissão tabs.agenda); esta
 * function só confirma que existe uma sessão válida de alguém do domínio da casa.
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

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: JSONH });
  if (req.method !== 'POST') return resp(405, { error: 'somente POST' });

  // JWT do Supabase — esqueleto de meta-trafego-action.mjs. Sem trava 2 por lista fixa de
  // e-mails: quem vê a aba já passou pelo RBAC (permissão tabs.agenda) no front; aqui só
  // exigimos sessão válida de alguém do domínio da casa.
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return resp(401, { error: 'sem credencial (Authorization: Bearer)' });
  const { data: userData, error: authErr } = await db.auth.getUser(jwt);
  const userEmail = (userData?.user?.email || '').toLowerCase();
  if (authErr || !userEmail || !userEmail.endsWith('@advocaciacbc.com')) {
    return resp(401, { error: 'sessao invalida — faca login de novo' });
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

      const cfgAll = await getConfig();
      const cfg = cfgAll.agenda_bot || {};
      const duracaoMin = cfg.regras?.duracao_evento_min || 30;
      const inicioISO = new Date(novoInicio).toISOString();
      const fimISO = new Date(new Date(novoInicio).getTime() + duracaoMin * 60000).toISOString();

      const accessToken = await getAccessToken();
      await patchEventHorario({ calendarId: vendedoraEmail, eventId, inicioISO, fimISO, accessToken });
      await upsertVC(linhaParaUpsert(atual, { scheduled_at: inicioISO }));

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
        { userEmail, eventId, vendedoraEmail, leadId: atual.lead_id, mensagemEnviada });
      return resp(200, { success: true, event_id: eventId, scheduled_at: inicioISO, mensagem_enviada: mensagemEnviada });
    }

    if (acao === 'cancelar') {
      const v = requireFields(body, ['event_id', 'vendedora_email']);
      if (!v.ok) return resp(400, { error: v.motivo });
      const { event_id: eventId, vendedora_email: vendedoraEmail, motivo } = body;

      const atual = await buscarAtendimento(eventId);
      if (!atual) return resp(404, { error: 'atendimento nao encontrado para esse event_id' });

      const accessToken = await getAccessToken();
      await cancelEvent({ calendarId: vendedoraEmail, eventId, accessToken });
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
        { userEmail, eventId, vendedoraEmail, motivo: motivo || null, leadId: atual.lead_id, movidoPerdido });
      return resp(200, { success: true, event_id: eventId, status: 'excluida', movido_perdido: movidoPerdido });
    }

    if (acao === 'desfecho') {
      const v = requireFields(body, ['event_id', 'vendedora_email', 'status']);
      if (!v.ok) return resp(400, { error: v.motivo });
      const { event_id: eventId, vendedora_email: vendedoraEmail, status } = body;
      const colorId = STATUS_TO_COR[status];
      if (!colorId) return resp(400, { error: 'status invalido (realizada|no_show|fechou)' });

      // Só a cor do evento — o sync de calendário (a cada 45min) espelha cor->status na
      // linha; não precisamos (nem devemos) mexer em agenda_videochamadas aqui.
      const accessToken = await getAccessToken();
      await setEventColor({ calendarId: vendedoraEmail, eventId, colorId, accessToken });

      await logAdvbox('agenda', 'info', `admin ${userEmail} marcou desfecho ${eventId} = ${status}`,
        { userEmail, eventId, vendedoraEmail, status, colorId });
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
        row = await getConversation(channel);
        if (row && row.context?.lead_id != null && String(row.context.lead_id) !== String(body.lead_id)) {
          return resp(400, { error: 'channel informado nao pertence a esse lead_id' });
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
