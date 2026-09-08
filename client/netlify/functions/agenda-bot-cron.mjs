/**
 * Cron do bot Ana (*\/5 min): para cada videochamada 'agendada' de origem 'ana' na janela
 * de atuacao (RPC agenda_bot_pendencias, T-30min..T+75min do horario marcado):
 *  - T-60..T-40  e lembrete_1h_em null -> lembrete de 1h antes
 *  - T-2..T+5    e lembrete_t0_em null -> link do Google Meet (T0)
 *  - T+10..T+30  e noshow_msg_em null e status ainda 'agendada' -> no-show + oferta de reagendamento
 * Janela de 24h da Meta (janelaAberta): dentro -> fala normal (campo do lead + Salesbot);
 * fora -> template WABA (se configurado) ou nota+tarefa p/ envio manual (fallback). Templates
 * WABA reais sao [PAULO]/piloto (Task 2 Step 5) — aqui so o branch precisa estar pronto.
 * NUNCA derruba sem log (logAdvbox); sempre responde JSON { ok }.
 */
import { getConfig, db, logAdvbox, getConversation, upsertConversation } from './_lib/botDb.mjs';
import { setLeadField, runSalesbot, createKommoTask, postNote, kommoGet, moveLeadStage } from './_lib/kommo.mjs';
import { aplicarTemplate } from './_lib/agendaEngine.mjs';
import { formatarSlot, gerarSlots } from './_lib/agendaSlots.mjs';
import { getAccessToken, freeBusy } from './_lib/googleAgenda.mjs';
import { janelaAberta } from './_lib/assinaturaWhatsapp.mjs';
import { gradeDeConfig, ehJanelaEntrega } from './_lib/sdrHorario.mjs';
import { podeMoverEtapa } from './_lib/sdrFerramentas.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';

// ===================== PURA (testada em agendaCron.test.js) =====================

/**
 * Decide qual lembrete disparar p/ uma videochamada da Ana, dado quantos minutos faltam
 * para o horario marcado (`min`; negativo = ja passou) e os lembretes ja marcados nela.
 * Ramos mutuamente exclusivos no recorte de 5min do cron; o no-show ainda confere `status`
 * pois a videochamada pode ter sido concluida/cancelada por outro fluxo entre o fetch da
 * RPC (agenda_bot_pendencias ja filtra status='agendada') e este loop.
 */
export function decidirLembrete(vc, min, opts = {}) {
  // (08/09/2026) UM lembrete so, 1h antes, ja com o link (quem escreve depois de marcar
  // comparece 87%; 3+ mensagens do escritorio, 76%). O T0 fica desligado por padrao.
  if (min <= 24 * 60 && min > 24 * 60 - 20 && !vc.lembrete_vespera_em && opts.vespera) return 'lembrete_vespera';
  if (min <= 60 && min > 40 && !vc.lembrete_1h_em) return 'lembrete_1h';
  if (opts.t0 && min <= 2 && min > -5 && !vc.lembrete_t0_em) return 'lembrete_t0';
  // No-show so quando a auditoria do Meet confirmou (roda de hora em hora): o status da agenda
  // e subjetivo e demora; mandar "nao conseguimos falar" para quem compareceu seria pior.
  if (vc.meet_status === 'no_show' && !vc.noshow_msg_em && min <= -10) return 'noshow';
  return null;
}

/** Nota de 3 linhas p/ o SDR humano pegar o lead que a Ana tocou no plantao. */
export function resumoPlantao(estado) {
  const d = estado?.dados || {};
  const ag = estado?.agendamento || {};
  const quem = `Quem: ${estado?.nome || '?'} · resort ${d.resort || '?'} · cota ${d.situacao_cota || '?'} · pagou ${d.valor_pago ?? '?'} · nota ${estado?.nota ?? '?'}`;
  const oque = ag.inicio ? `Status: videochamada agendada ${new Date(ag.inicio).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} com ${ag.vendedora || '?'}`
    : estado?.escalado ? `Status: escalado pela Ana (${estado.escalado_motivo || '?'})` : `Status: conversou com a Ana (${estado?.situacao || '?'}), sem horário fechado`;
  const falta = ag.inicio ? 'Falta: nada; só acompanhar a confirmação.' : 'Falta: propor horário e fechar; ler a conversa acima.';
  return `${quem}\n${oque}\n${falta}`;
}

// ===================== I/O (orquestracao — validada no piloto) =====================

// Ultima mensagem RECEBIDA do cliente (epoch segundos) — mesmo padrao de ultimaMsgCliente
// (kommo-assinatura-send.mjs), mas o contactId ja vem do estado da conversa (nao precisa
// resolver mainContactOfLead). Sem eventos em nenhum caminho => null => janela fechada
// (janelaAberta trata ausencia de mensagem como fail-safe).
async function ultimaMsgRecebida(contactId, leadId) {
  const caminhos = [];
  if (contactId) caminhos.push(`/events?filter[type]=incoming_chat_message&filter[entity]=contact&filter[entity_id][]=${encodeURIComponent(contactId)}&limit=1`);
  caminhos.push(`/events?filter[type]=incoming_chat_message&filter[entity]=lead&filter[entity_id][]=${encodeURIComponent(leadId)}&limit=1`);
  for (const c of caminhos) {
    const r = await kommoGet(c);
    const ev = r?._embedded?.events?.[0];
    if (ev?.created_at) return ev.created_at;
  }
  return null;
}

/** Envia a mensagem: dentro da janela de 24h -> fala normal; fora -> template WABA (se
 * configurado) ou nota+tarefa p/ envio manual. Retorna o canal usado (so p/ log/depuracao). */
async function enviar({ vc, mensagem, template, cfg, estado }) {
  const contactId = estado?.contact_id || null;
  const last = await ultimaMsgRecebida(contactId, vc.lead_id);
  const jan = janelaAberta(last, new Date().toISOString(), cfg.regras.janela_margem_min ?? 60);
  if (jan.aberta) {
    await setLeadField(vc.lead_id, cfg.kommo.campo_ana_id, mensagem);
    await runSalesbot(cfg.kommo.salesbot_id, vc.lead_id, 'leads');
    return 'normal';
  }
  if (cfg.kommo.salesbot_template_id) {
    await setLeadField(vc.lead_id, cfg.kommo.campo_ana_id, mensagem); // template usa variaveis proprias; campo fica de registro
    await runSalesbot(cfg.kommo.salesbot_template_id, vc.lead_id, 'leads');
    return 'template';
  }
  await postNote(vc.lead_id, `CBC.agenda.manual:${vc.event_id}:${template}`, `Fora da janela e sem template: enviar manualmente — ${mensagem}`);
  await createKommoTask(vc.lead_id, 'leads', `Enviar manualmente (Ana, fora da janela): ${mensagem}`, 1, null);
  return 'tarefa';
}

async function marcar(eventId, campo) {
  const { error } = await db.rpc('agenda_bot_marcar', { p_chave: RPC_SECRET, p_event_id: eventId, p_campo: campo });
  if (error) throw new Error(`marcar ${campo}: ${error.message}`);
}

/** Entrega da manha: para cada conversa que a Ana tocou no plantao (sdr_ia_plantao_pendentes),
 * posta nota de 3 linhas no lead, escala p/ "Precisa de humano" se nao houver agendamento nem
 * escalonamento/encerramento previo, e desliga o plantao (context.plantao_ativo=false). Falha
 * por item nao aborta o lote (mesmo padrao do loop de lembretes acima). */
async function entregarPlantao(cfg) {
  const { data: rows, error } = await db.rpc('sdr_ia_plantao_pendentes', { p_chave: RPC_SECRET });
  if (error) { await logAdvbox('agenda', 'erro', `plantao_pendentes: ${error.message}`); return { entregues: 0 }; }
  let entregues = 0;
  const hoje = new Date().toISOString().slice(0, 10);
  for (const row of rows || []) {
    const estado = row.context || {};
    const leadId = estado.lead_id || row.customer_id;
    // (revisao final M13) sem lead nao ha nota nem etapa a mexer, mas o plantao PRECISA ser
    // desligado: um `continue` seco deixava a conversa em plantao_ativo=true para sempre e ela
    // voltava em TODA rodada de sdr_ia_plantao_pendentes, pesando o lote todo dia.
    if (!leadId) {
      try {
        await upsertConversation(row.channel, { context: { ...estado, plantao_ativo: false, entregue_em: new Date().toISOString() } });
        await logAdvbox('agenda', 'aviso', `entrega da manha sem lead_id no canal ${row.channel}: plantao desligado sem nota`, { channel: row.channel });
      } catch (e) { await logAdvbox('agenda', 'erro', `entrega da manha sem lead (${row.channel}): ${e.message}`.slice(0, 300)); }
      continue;
    }
    try {
      await postNote(leadId, `CBC.ana.plantao:${hoje}`, `Plantão da Ana (${hoje}).\n${resumoPlantao(estado)}`);
      // (revisao final C1 — CRITICO) mesma regra das ferramentas: so move a etapa se o lead
      // estiver no proprio funil do SDR (o piloto roda noutro pipeline). Fail-closed: estado
      // antigo sem `pipeline_id` nao move nada, so registra.
      if (!estado.agendamento?.inicio && !estado.escalado && !estado.encerrado) {
        if (podeMoverEtapa(estado.pipeline_id, cfg.kommo.pipeline_sdr)) {
          await moveLeadStage(leadId, { pipelineId: cfg.kommo.pipeline_sdr, statusId: cfg.kommo.etapas.precisa_humano });
        } else {
          await logAdvbox('agenda', 'info', `etapa nao movida (pipeline ${estado.pipeline_id} != SDR): entrega da manha`, { leadId });
        }
      }
      await upsertConversation(row.channel, { context: { ...estado, plantao_ativo: false, entregue_em: new Date().toISOString() } });
      entregues++;
    } catch (e) { await logAdvbox('agenda', 'erro', `entrega da manha lead ${leadId}: ${e.message}`.slice(0, 300)); }
  }
  return { entregues };
}

/** Reservas vencidas: o escritorio respondeu? (qualquer outgoing no contato depois da msg do
 *  lead) -> cancela; senao re-despacha o worker com `reserva: true` (pula a grade e o dedupe). */
async function processarReservas(cfg) {
  const r = { vistas: 0, assumidas: 0, canceladas: 0 };
  if (!(Number(cfg.regras?.reserva_comercial_min) > 0)) return r;
  const { data: rows, error } = await db.rpc('sdr_ia_reservas_pendentes', { p_chave: RPC_SECRET });
  if (error) throw new Error(`reservas_pendentes: ${error.message}`);
  for (const row of rows || []) {
    r.vistas++;
    const ctx = row.context || {}; const res = ctx.reserva_pendente || {};
    const limpar = async () => upsertConversation(row.channel, { context: { ...ctx, reserva_pendente: null } });
    try {
      let respondeu = false;
      if (res.contact_id) {
        const ev = await kommoGet(`/events?filter[type]=outgoing_chat_message&filter[entity]=contact&filter[entity_id][]=${res.contact_id}&limit=5`);
        respondeu = (ev?._embedded?.events || []).some((e) => Number(e.created_at) * 1000 > Date.parse(res.msg_em || 0));
      }
      if (respondeu) { await limpar(); r.canceladas++; await logAdvbox('ana', 'info', 'reserva cancelada: escritorio respondeu', { leadId: ctx.lead_id, contactId: res.contact_id }); continue; }
      await limpar();
      const resp = await fetch(`${process.env.URL}/.netlify/functions/agenda-bot-worker-background`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType: res.contentType, raw: res.raw, reserva: true }) });
      r.assumidas++;
      await logAdvbox('ana', 'info', 'reserva assumida: Ana entra em horario comercial', { leadId: ctx.lead_id, contactId: res.contact_id, http: resp.status });
    } catch (e) {
      await logAdvbox('agenda', 'erro', `reserva ${row.channel}: ${e.message}`.slice(0, 300));
    }
  }
  return r;
}

export default async () => {
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  try {
    const cfg = (await getConfig()).agenda_bot;
    if (!cfg?.ativo) return json({ ok: true, skip: 'inativo' });

    // Entrega da manha (Task 11): no inicio da grade do SDR humano, entrega pro time o que a
    // Ana tocou durante o plantao noturno. Guardada em try/catch propria — uma falha aqui
    // (RPC/Kommo) nunca pode bloquear o loop de lembretes abaixo, que e o core do cron.
    let entrega = null;
    try {
      // (revisao final M5) mesma RPC do worker; a policy anon sobre sdr_config foi removida.
      const { data: gradeRows, error: sdrCfgErr } = await db.rpc('sdr_ia_grade', { p_chave: RPC_SECRET });
      const sdrCfg = Array.isArray(gradeRows) ? gradeRows[0] : gradeRows;
      if (sdrCfgErr || !sdrCfg) await logAdvbox('agenda', 'aviso', `grade do SDR ausente/erro (${sdrCfgErr?.message || 'sem linha'}); usando fallback cfg.regras p/ a grade da entrega`);
      const grade = gradeDeConfig(sdrCfg, cfg.regras);
      if (ehJanelaEntrega(new Date(), grade, cfg.regras.feriados || [])) entrega = await entregarPlantao(cfg);
    } catch (e) {
      await logAdvbox('agenda', 'erro', `entrega da manha: ${e.message}`.slice(0, 300));
    }

    const { data: pend, error } = await db.rpc('agenda_bot_pendencias', { p_chave: RPC_SECRET });
    if (error) throw new Error(`pendencias: ${error.message}`);

    const agora = Date.now();
    const n = { lembrete1h: 0, t0: 0, noshow: 0 };

    for (const vc of pend || []) {
      const min = (new Date(vc.scheduled_at).getTime() - agora) / 60000;
      const canalPrev = `agenda:${(vc.telefone || '').replace(/\D/g, '')}`;
      const convPrev = vc.origem === 'ana' && min > 60 ? await getConversation(canalPrev) : null;
      const acao = decidirLembrete(vc, min, { t0: !!cfg.regras.lembrete_t0, vespera: !!convPrev?.context?.horario_fora_padrao });
      if (!acao) continue;

      // (RECOMENDADO — revisão final #4) try/catch por item: sem isso, uma falha isolada
      // (Kommo/Google) num item abortava o `for` inteiro — todos os itens SEGUINTES de
      // `pend` nesse tick de 5min ficavam sem processar, não só o que falhou.
      // agenda_bot_pendencias é idempotente (reconsulta do zero a cada tick) — loga e segue
      // pro próximo item em vez de abortar o lote.
      try {
        const canal = `agenda:${(vc.telefone || '').replace(/\D/g, '')}`;
        const conv = await getConversation(canal);
        const estado = conv?.context || null;

        if (acao === 'lembrete_1h') {
          const hora = formatarSlot(new Date(vc.scheduled_at), new Date()).split(' às ')[1] || '';
          const link = estado?.agendamento?.meet_link || vc.raw?.meetLink || '';
          await enviar({ vc, cfg, estado, template: 'ana_lembrete_1h', mensagem: aplicarTemplate(cfg.mensagens.lembrete_1h, { hora, link }) });
          await marcar(vc.event_id, 'lembrete_1h_em');
          n.lembrete1h++;
        } else if (acao === 'lembrete_vespera') {
          const quando = formatarSlot(new Date(vc.scheduled_at), new Date());
          await enviar({ vc, cfg, estado, template: 'ana_lembrete_vespera', mensagem: aplicarTemplate(cfg.mensagens.lembrete_vespera || 'Passando para confirmar a nossa videochamada de {{quando}} 😊 Continua de pé para você?', { quando }) });
          await marcar(vc.event_id, 'lembrete_vespera_em');
          n.vespera = (n.vespera || 0) + 1;
        } else if (acao === 'lembrete_t0') {
          const link = estado?.agendamento?.meet_link || '';
          await enviar({ vc, cfg, estado, template: 'ana_link_meet', mensagem: aplicarTemplate(cfg.mensagens.lembrete_t0, { link }) });
          await marcar(vc.event_id, 'lembrete_t0_em');
          n.t0++;
        } else if (acao === 'noshow') {
          // oferta de reagendamento com slots reais (mesmo horizonte curto do worker: 6 dias)
          const at = await getAccessToken();
          const emails = cfg.vendedoras.filter((v) => v.ativa).map((v) => v.email);
          const busy = await freeBusy(emails, new Date().toISOString(), new Date(agora + 6 * 864e5).toISOString(), at);
          const slots = gerarSlots({ regras: cfg.regras, busyPorVendedora: busy, agora: new Date(), limite: 2 });
          const vars = Object.fromEntries(slots.map((s, i) => [`slot${i + 1}`, formatarSlot(new Date(s.inicio), new Date())]));
          await enviar({ vc, cfg, estado, template: 'ana_reagendar', mensagem: aplicarTemplate(cfg.mensagens.noshow, vars) });
          if (estado) {
            estado.etapa = 'pos_noshow';
            estado.slots_ofertados = slots.map((s) => ({ inicio: new Date(s.inicio).toISOString(), vendedoras: s.vendedoras }));
            await upsertConversation(canal, { context: estado });
          }
          await marcar(vc.event_id, 'noshow_msg_em');
          n.noshow++;
        }
      } catch (e) {
        await logAdvbox('agenda', 'erro', `cron Ana: item ${vc.event_id} (${acao}) falhou: ${e.message}`.slice(0, 300), { eventId: vc.event_id, acao });
      }
    }

    // (08/09/2026, item 1) RESERVA EM HORARIO COMERCIAL: o worker guardou a mensagem do lead
    // (context.reserva_pendente) porque estava dentro da grade; passados `reserva_comercial_min`
    // sem NENHUMA resposta do escritorio (humano ou bot), a Ana assume. 16% dos "sim" ao convite
    // nunca recebem resposta humana; respondidos em ate 1h agendam 60%.
    let reservas = { vistas: 0, assumidas: 0, canceladas: 0 };
    try { reservas = await processarReservas(cfg); } catch (e) { await logAdvbox('agenda', 'erro', `reservas: ${e.message}`.slice(0, 300)); }
    if (reservas.assumidas || reservas.canceladas) n.reservas = reservas;

    if (n.lembrete1h + n.t0 + n.noshow + (n.vespera || 0)) {
      await logAdvbox('agenda', 'info', `cron Ana: 1h=${n.lembrete1h} t0=${n.t0} noshow=${n.noshow}`, n);
    }
    const fezAlgo = Object.values(n || {}).some((v) => Number(v) > 0) || (entrega && entrega.entregues > 0);
    if (fezAlgo) await logAdvbox('ana', 'info', 'cron', { ...n, pendentes: (pend || []).length, entrega }).catch(() => {});
    return json({ ok: true, ...n, pendentes: (pend || []).length, entrega });
  } catch (e) {
    await logAdvbox('agenda', 'erro', `cron Ana: ${e.message}`.slice(0, 300), {}).catch(() => {});
    return json({ ok: false, error: e.message }, 500);
  }
};

export const config = { schedule: '*/5 * * * *' };
