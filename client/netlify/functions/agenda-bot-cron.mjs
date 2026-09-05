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

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';

// ===================== PURA (testada em agendaCron.test.js) =====================

/**
 * Decide qual lembrete disparar p/ uma videochamada da Ana, dado quantos minutos faltam
 * para o horario marcado (`min`; negativo = ja passou) e os lembretes ja marcados nela.
 * Ramos mutuamente exclusivos no recorte de 5min do cron; o no-show ainda confere `status`
 * pois a videochamada pode ter sido concluida/cancelada por outro fluxo entre o fetch da
 * RPC (agenda_bot_pendencias ja filtra status='agendada') e este loop.
 */
export function decidirLembrete(vc, min) {
  if (min <= 60 && min > 40 && !vc.lembrete_1h_em) return 'lembrete_1h';
  if (min <= 2 && min > -5 && !vc.lembrete_t0_em) return 'lembrete_t0';
  if (min <= -10 && min > -30 && !vc.noshow_msg_em && vc.status === 'agendada') return 'noshow';
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
    if (!leadId) continue;
    try {
      await postNote(leadId, `CBC.ana.plantao:${hoje}`, `Plantão da Ana (${hoje}).\n${resumoPlantao(estado)}`);
      if (!estado.agendamento?.inicio && !estado.escalado && !estado.encerrado) {
        await moveLeadStage(leadId, { pipelineId: cfg.kommo.pipeline_sdr, statusId: cfg.kommo.etapas.precisa_humano });
      }
      await upsertConversation(row.channel, { context: { ...estado, plantao_ativo: false, entregue_em: new Date().toISOString() } });
      entregues++;
    } catch (e) { await logAdvbox('agenda', 'erro', `entrega da manha lead ${leadId}: ${e.message}`.slice(0, 300)); }
  }
  return { entregues };
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
      const { data: sdrCfg, error: sdrCfgErr } = await db.from('sdr_config').select('grade_inicio,grade_fim,grade_dias').eq('id', 1).maybeSingle();
      if (sdrCfgErr || !sdrCfg) await logAdvbox('agenda', 'aviso', `sdr_config ausente/erro (${sdrCfgErr?.message || 'sem linha'}); usando fallback cfg.regras p/ a grade da entrega`);
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
      const acao = decidirLembrete(vc, min);
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
          await enviar({ vc, cfg, estado, template: 'ana_lembrete_1h', mensagem: aplicarTemplate(cfg.mensagens.lembrete_1h, { hora }) });
          await marcar(vc.event_id, 'lembrete_1h_em');
          n.lembrete1h++;
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

    if (n.lembrete1h + n.t0 + n.noshow) {
      await logAdvbox('agenda', 'info', `cron Ana: 1h=${n.lembrete1h} t0=${n.t0} noshow=${n.noshow}`, n);
    }
    return json({ ok: true, ...n, pendentes: (pend || []).length, entrega });
  } catch (e) {
    await logAdvbox('agenda', 'erro', `cron Ana: ${e.message}`.slice(0, 300), {}).catch(() => {});
    return json({ ok: false, error: e.message }, 500);
  }
};

export const config = { schedule: '*/5 * * * *' };
