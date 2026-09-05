// As 7 ferramentas da Ana sobre Google Agenda, Kommo (fila) e Supabase. Cada ferramenta
// devolve TEXTO curto p/ o modelo e grava o efeito ANTES de devolver. Erros lancam: o loop
// converte em tool_result is_error e o modelo avisa o lead. As partes puras (formatarOferta,
// etapaDeEncerramento) sao testadas em src/utils/__tests__/sdrFerramentas.test.js.
import { db, logAdvbox, upsertConversation } from './botDb.mjs';
import { setLeadField, moveLeadStage, createKommoTask, postNote } from './kommo.mjs';
import { gerarSlots, slotsParaOferta, slotId, parseSlotId, formatarSlot } from './agendaSlots.mjs';
import { calcularNota, escolherCloser } from './sdrRoteamento.mjs';
import { proximoInicioExpediente } from './sdrHorario.mjs';
import { getAccessToken, freeBusy, createEventComMeet, patchEventHorario, cancelEvent, setEventColor } from './googleAgenda.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const fmtHora = (d) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);

export function formatarOferta(slots, closer, agora, nomeCloser = null) {
  if (!slots?.length) return 'Nenhum horário livre nos próximos dias úteis. Use escalar_para_humano.';
  const sufixo = nomeCloser ? ` (${nomeCloser})` : '';
  const linhas = slots.map((s) => `${slotId(s, closer)} | ${formatarSlot(new Date(s.inicio), agora)}${sufixo}`);
  return `Horários (id | quando):\n${linhas.join('\n')}`;
}

// Descricao do evento do Google Agenda (Task 9): extraida p/ ser reusada tanto em agendar()
// quanto no ramo de troca de closer do remarcar() (fix9 item 8) — evita duas copias divergentes.
function descricaoEvento(d, leadId, fone) {
  return `Lead: https://advocaciacbc.kommo.com/leads/detail/${leadId}\nTelefone: ${fone}\nResort: ${d.resort || '?'} | Cota: ${d.situacao_cota || '?'} | Já pagou: ${d.valor_pago ?? '?'} | Titular: ${d.titular || '?'}\nObs: ${d.observacoes || ''}`;
}

export function etapaDeEncerramento(motivo, etapas) {
  if (motivo === 'nao_quer') return etapas.nao_quer;
  if (motivo === 'ja_e_cliente') return etapas.cliente;
  return etapas.precisa_humano; // nao_e_lead / outro: humano confere e fecha
}

/**
 * ctx = { cfg, grade, leadId, fone, nome, estado, channel, agora, plantaoFim }
 * estado e MUTADO (dados, nota, slots_ofertados, agendamento, reagendamentos, escalado, encerrado)
 * e persistido pelo caller. Token do Google e obtido uma vez por turno, sob demanda.
 */
export function criarExecutor(ctx) {
  if (!ctx.grade?.dias) throw new Error('criarExecutor: ctx.grade obrigatorio');
  const { cfg, leadId, fone, estado, channel, agora } = ctx;
  const etapas = cfg.kommo.etapas;
  let tokenGoogle = null;
  const at = async () => (tokenGoogle ||= await getAccessToken());

  async function slotsLivres() {
    const emails = cfg.vendedoras.filter((v) => v.ativa).map((v) => v.email);
    const fim = new Date(agora.getTime() + (cfg.regras.horizonte_dias_uteis + 4) * 864e5);
    const busy = await freeBusy(emails, agora.toISOString(), fim.toISOString(), await at());
    return gerarSlots({ regras: cfg.regras, busyPorVendedora: busy, agora, limite: 40 });
  }

  async function persistir() { await upsertConversation(channel, { customer_id: leadId, customer_name: estado.nome, context: estado }); }

  async function espelhoUpsert(row) {
    const { error } = await db.rpc('agenda_videochamadas_upsert', { p_chave: RPC_SECRET, p_rows: [row] });
    if (error) await logAdvbox('agenda', 'erro', `upsert espelho falhou (calendar-sync reconcilia): ${error.message}`.slice(0, 300), { leadId });
  }

  const ferramentas = {
    async consultar_horarios({ preferencia = 'qualquer', a_partir_de = null }) {
      const slots = await slotsLivres();
      const nota = estado.nota ?? calcularNota({ ...(estado.dados || {}), mandou_audio: estado.mandou_audio }, cfg.roteamento);
      // fix9 item 3: fixa a closer entre consultas — sem isso cada chamada podia sortear outra
      // closer (escolherCloser) e o lead recebia horarios de vendedoras diferentes a cada volta.
      const closer = estado.agendamento?.vendedora || estado.closer_escolhida || escolherCloser({ nota, cfg, slots, seed: String(leadId) })?.email;
      if (!closer) { estado.slots_ofertados = []; return formatarOferta([], null, agora); }
      const oferta = slotsParaOferta({ slots, preferencia, aPartirDeISO: a_partir_de, closer, n: 3 });
      estado.slots_ofertados = oferta.map((s) => ({ id: slotId(s, closer), inicio: new Date(s.inicio).toISOString(), closer }));
      estado.closer_escolhida = closer;
      await persistir();
      const nomeCloser = cfg.vendedoras.find((v) => v.email === closer)?.nome;
      return formatarOferta(oferta, closer, agora, nomeCloser);
    },

    async agendar({ slot_id, email, nome }) {
      const p = parseSlotId(slot_id);
      if (!p || !(estado.slots_ofertados || []).some((s) => s.id === slot_id)) throw new Error('slot_id não é um dos horários oferecidos; chame consultar_horarios de novo');
      if (estado.agendamento?.event_id) throw new Error('já existe videochamada marcada; use remarcar');
      // fix9 item 6: mensagem honesta quando o slot so expirou de tao proximo (antecedencia
      // minima), em vez de cair no "acabou de ser ocupado" do free/busy logo abaixo.
      if (new Date(p.inicioISO) < new Date(agora.getTime() + (cfg.regras.antecedencia_min_minutos ?? 60) * 60000)) throw new Error('esse horário já está muito próximo; chame consultar_horarios de novo');
      // revalida concorrencia: o horario ainda esta livre p/ essa closer?
      const livre = (await slotsLivres()).find((s) => new Date(s.inicio).toISOString() === p.inicioISO && s.vendedoras.includes(p.closer));
      if (!livre) throw new Error('esse horário acabou de ser ocupado; chame consultar_horarios de novo');
      const ini = new Date(p.inicioISO); const fim = new Date(ini.getTime() + cfg.regras.duracao_evento_min * 60000);
      const d = estado.dados || {};
      const { eventId, meetLink } = await createEventComMeet({
        calendarId: p.closer, inicioISO: ini.toISOString(), fimISO: fim.toISOString(),
        titulo: `Videochamada — ${nome || estado.nome || fone} (CBC/Ana)`,
        descricao: descricaoEvento(d, leadId, fone),
        leadId, telefone: fone, nome: nome || estado.nome, accessToken: await at(), convidados: email ? [email] : [],
      });
      estado.agendamento = { event_id: eventId, inicio: ini.toISOString(), vendedora: p.closer, meet_link: meetLink, email };
      estado.nome = nome || estado.nome;
      await persistir(); // ANTES dos efeitos no Kommo: se algo falhar, a proxima msg cai em remarcar, nunca em duplicar
      const vend = cfg.vendedoras.find((v) => v.email === p.closer);
      // fix9 item 2: o evento JA existe no Google Agenda a essa altura — os efeitos abaixo
      // (espelho/Kommo/nota) sao best-effort; falhar aqui nunca deve fazer o lead achar que
      // o agendamento nao aconteceu (e tentar de novo, duplicando o evento).
      try {
        await espelhoUpsert({ event_id: eventId, vendedora_email: p.closer, cliente_email: email || null, cliente_nome: estado.nome || null,
          status: 'agendada', color_id: null, scheduled_at: ini.toISOString(), tem_meet: true, source: 'live', origem: 'ana', lead_id: leadId, telefone: fone, raw: {} });
        await moveLeadStage(leadId, { pipelineId: cfg.kommo.pipeline_sdr, statusId: etapas.agendada });
        if (vend?.user_id) await createKommoTask(leadId, 'leads', `Videochamada (Ana): ${fmtHora(ini)} — Meet: ${meetLink}`, Math.max(1, (ini - Date.now()) / 36e5), vend.user_id);
        await postNote(leadId, `CBC.ana.agendou:${eventId}`, `Ana agendou ${fmtHora(ini)} com ${vend?.nome || p.closer}. Meet: ${meetLink}. E-mail: ${email}. Dados: ${JSON.stringify(d)}`);
      } catch (e) {
        await logAdvbox('agenda', 'erro', `agendar: efeito pos-booking falhou (nao fatal): ${e.message}`.slice(0, 300), { leadId, eventId });
      }
      return `Agendado: ${fmtHora(ini)} com ${vend?.nome || 'a advogada'}. Link do Meet: ${meetLink}. Convite enviado para ${email}.`;
    },

    async remarcar({ slot_id }) {
      const ag = estado.agendamento || {};
      if (!ag.event_id) throw new Error('não há videochamada marcada; use consultar_horarios e agendar');
      if ((estado.reagendamentos || 0) >= (cfg.regras.max_reagendamentos ?? 2)) throw new Error('limite de remarcações atingido; use escalar_para_humano');
      const p = parseSlotId(slot_id);
      if (!p || !(estado.slots_ofertados || []).some((s) => s.id === slot_id)) throw new Error('slot_id não é um dos horários oferecidos; chame consultar_horarios de novo');
      // fix9 item 6: mesma mensagem honesta do agendar quando o slot so expirou de tao proximo.
      if (new Date(p.inicioISO) < new Date(agora.getTime() + (cfg.regras.antecedencia_min_minutos ?? 60) * 60000)) throw new Error('esse horário já está muito próximo; chame consultar_horarios de novo');
      const livre = (await slotsLivres()).find((s) => new Date(s.inicio).toISOString() === p.inicioISO && s.vendedoras.includes(p.closer));
      if (!livre) throw new Error('esse horário acabou de ser ocupado; chame consultar_horarios de novo');
      const ini = new Date(p.inicioISO); const fim = new Date(ini.getTime() + cfg.regras.duracao_evento_min * 60000);
      const closerAnterior = ag.vendedora;
      let eventId = ag.event_id; let meetLink = ag.meet_link;
      if (p.closer === ag.vendedora) {
        await patchEventHorario({ calendarId: ag.vendedora, eventId, inicioISO: ini.toISOString(), fimISO: fim.toISOString(), accessToken: await at(), notificar: true });
        try { await setEventColor({ calendarId: ag.vendedora, eventId, colorId: null, accessToken: await at() }); } catch (e) { await logAdvbox('agenda', 'aviso', `setEventColor falhou (nao fatal): ${e.message}`, { leadId }); }
        const { error } = await db.rpc('agenda_videochamadas_reset_reagendamento', { p_chave: RPC_SECRET, p_event_id: eventId, p_novo_inicio: ini.toISOString() });
        if (error) await logAdvbox('agenda', 'erro', `reset reagendamento falhou: ${error.message}`, { leadId, eventId });
      } else {
        try { await cancelEvent({ calendarId: ag.vendedora, eventId: ag.event_id, accessToken: await at(), notificar: true }); } catch (e) { await logAdvbox('agenda', 'aviso', `cancelEvent falhou ao remarcar (segue): ${e.message}`, { leadId }); }
        // fix9 item 1: retira o espelho do evento ANTIGO antes de criar o novo — sem isso o
        // cron de lembrete continua achando o evento cancelado como se estivesse ativo.
        await espelhoUpsert({ event_id: ag.event_id, vendedora_email: ag.vendedora, cliente_email: ag.email || null, cliente_nome: estado.nome || null,
          status: 'cancelada', color_id: null, scheduled_at: ag.inicio, tem_meet: true, source: 'live', origem: 'ana', lead_id: leadId, telefone: fone, raw: {} });
        const d = estado.dados || {};
        let c;
        try {
          c = await createEventComMeet({ calendarId: p.closer, inicioISO: ini.toISOString(), fimISO: fim.toISOString(),
            titulo: `Videochamada — ${estado.nome || fone} (CBC/Ana)`, descricao: descricaoEvento(d, leadId, fone),
            leadId, telefone: fone, nome: estado.nome, accessToken: await at(), convidados: ag.email ? [ag.email] : [] });
        } catch (e) {
          // fix9 item 4: o evento antigo ja foi cancelado (ou tentamos) — sem rollback aqui o
          // lead ficaria com um agendamento fantasma (estado aponta p/ evento que nao existe).
          estado.agendamento = { event_id: null, inicio: null, vendedora: null, meet_link: null };
          await persistir();
          await logAdvbox('agenda', 'erro', `remarcar: recriar evento em outra closer falhou: ${e.message}`.slice(0, 300), { leadId });
          throw new Error('não consegui recriar o evento; chame consultar_horarios e agendar de novo');
        }
        eventId = c.eventId; meetLink = c.meetLink;
        await espelhoUpsert({ event_id: eventId, vendedora_email: p.closer, cliente_email: ag.email || null, cliente_nome: estado.nome || null,
          status: 'agendada', color_id: null, scheduled_at: ini.toISOString(), tem_meet: true, source: 'live', origem: 'ana', lead_id: leadId, telefone: fone, raw: {} });
      }
      estado.agendamento = { ...ag, event_id: eventId, inicio: ini.toISOString(), vendedora: p.closer, meet_link: meetLink };
      estado.reagendamentos = (estado.reagendamentos || 0) + 1;
      await persistir();
      await postNote(leadId, `CBC.ana.remarcou:${eventId}:${estado.reagendamentos}`, `Ana remarcou para ${fmtHora(ini)} (${estado.reagendamentos}ª vez).`);
      // fix9 item 5: tarefa da closer (possivelmente nova) + aviso p/ quem perdeu a call.
      const vend = cfg.vendedoras.find((v) => v.email === p.closer);
      if (vend?.user_id) await createKommoTask(leadId, 'leads', `Videochamada (Ana): ${fmtHora(ini)} — Meet: ${meetLink}`, Math.max(1, (ini - Date.now()) / 36e5), vend.user_id);
      if (closerAnterior && closerAnterior !== p.closer) {
        const vendAnterior = cfg.vendedoras.find((v) => v.email === closerAnterior);
        await postNote(leadId, `CBC.ana.remarcou_closer:${eventId}`, `Ana remarcou e trocou de closer: ${vendAnterior?.nome || closerAnterior} não tem mais esta videochamada.`);
      }
      return `Remarcado: ${fmtHora(ini)}. Link do Meet: ${meetLink}.`;
    },

    async cancelar({ motivo }) {
      const ag = estado.agendamento || {};
      if (ag.event_id) {
        await cancelEvent({ calendarId: ag.vendedora, eventId: ag.event_id, accessToken: await at(), notificar: true });
        await espelhoUpsert({ event_id: ag.event_id, vendedora_email: ag.vendedora, cliente_email: ag.email || null, cliente_nome: estado.nome || null,
          status: 'cancelada', color_id: null, scheduled_at: ag.inicio, tem_meet: true, source: 'live', origem: 'ana', lead_id: leadId, telefone: fone, raw: {} });
      }
      estado.agendamento = { event_id: null, inicio: null, vendedora: null, meet_link: null };
      await persistir();
      const statusId = motivo === 'desistiu' ? etapas.nao_quer : etapas.follow_up_bot;
      await moveLeadStage(leadId, { pipelineId: cfg.kommo.pipeline_sdr, statusId });
      await postNote(leadId, `CBC.ana.cancelou:${Date.now()}`, `Ana cancelou a videochamada. Motivo: ${motivo}.`);
      return `Cancelado (${motivo}).`;
    },

    async registrar_qualificacao({ resort, situacao_cota, titular, valor_pago, observacoes }) {
      estado.dados = { ...(estado.dados || {}) };
      if (resort) estado.dados.resort = resort;
      if (situacao_cota) estado.dados.situacao_cota = situacao_cota;
      if (titular) estado.dados.titular = titular;
      if (valor_pago != null) estado.dados.valor_pago = Number(valor_pago);
      if (observacoes) estado.dados.observacoes = observacoes;
      estado.nota = calcularNota({ ...estado.dados, mandou_audio: estado.mandou_audio }, cfg.roteamento);
      await persistir();
      if (valor_pago != null && cfg.kommo.campo_investimento_id) await setLeadField(leadId, cfg.kommo.campo_investimento_id, String(valor_pago));
      return `Registrado. Nota do lead: ${estado.nota}.`;
    },

    // (fix Task 10) efeitos no Kommo ANTES de marcar estado.escalado — se moveLeadStage/
    // createKommoTask/postNote falharem, estado.escalado fica false e o proximo turno
    // tenta escalar de novo (com escalado=true antes, uma falha no Kommo deixava o lead
    // marcado como escalado sem NENHUM efeito real, e o retry nunca acontecia).
    async escalar_para_humano({ motivo, resumo }) {
      if (estado.escalado) return 'Já escalado nesta conversa. Apenas avise o lead do prazo.';
      // flag em memoria ANTES dos efeitos (bloqueia repeticao no mesmo turno); persiste DEPOIS
      // (falha no Kommo nao grava 'escalado', entao o proximo turno pode tentar de novo)
      estado.escalado = true; estado.escalado_motivo = motivo;
      try {
        await moveLeadStage(leadId, { pipelineId: cfg.kommo.pipeline_sdr, statusId: etapas.precisa_humano });
        await createKommoTask(leadId, 'leads', `Ana escalou (${motivo}). ${resumo}`, 1, null);
        await postNote(leadId, `CBC.ana.escalou:${new Date().toISOString().slice(0, 10)}`, `Ana → humano. Motivo: ${motivo}. Resumo: ${resumo}`);
      } catch (e) { estado.escalado = false; estado.escalado_motivo = null; throw e; }
      await persistir();
      const volta = proximoInicioExpediente(new Date(), ctx.grade, cfg.regras.feriados || []);
      return `Escalado. Diga ao lead que a equipe responde a partir de ${fmtHora(volta)}.`;
    },

    // mesmo principio de ordenacao do escalar_para_humano acima.
    async encerrar({ motivo }) {
      if (estado.encerrado) return 'Já encerrado.';
      estado.encerrado = true; estado.encerrado_motivo = motivo;
      try {
        await moveLeadStage(leadId, { pipelineId: cfg.kommo.pipeline_sdr, statusId: etapaDeEncerramento(motivo, etapas) });
        await postNote(leadId, `CBC.ana.encerrou:${new Date().toISOString().slice(0, 10)}`, `Ana encerrou. Motivo: ${motivo}.`);
      } catch (e) { estado.encerrado = false; estado.encerrado_motivo = null; throw e; }
      await persistir();
      return `Encerrado (${motivo}). Despeça-se em uma frase.`;
    },
  };

  return {
    estado,
    async executar(nome, input) {
      const fn = ferramentas[nome];
      if (!fn) throw new Error(`ferramenta desconhecida: ${nome}`);
      return fn(input || {});
    },
  };
}
