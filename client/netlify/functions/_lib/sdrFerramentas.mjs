// As 7 ferramentas da Ana sobre Google Agenda, Kommo (fila) e Supabase. Cada ferramenta
// devolve TEXTO curto p/ o modelo e grava o efeito ANTES de devolver. Erros lancam: o loop
// converte em tool_result is_error e o modelo avisa o lead. As partes puras (formatarOferta,
// etapaDeEncerramento) sao testadas em src/utils/__tests__/sdrFerramentas.test.js.
import { db, logAdvbox, upsertConversation, getConversation } from './botDb.mjs';
import { setLeadField, moveLeadStage, createKommoTask, postNote, getEntity, listTags, setLeadTags } from './kommo.mjs';
import { escolherTagResort, palavraChave, unirTags, TAG_SITUACAO } from './sdrTags.mjs';
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
 * (revisao final C1 — CRITICO) So mexe na etapa do lead quando ele esta no PROPRIO funil do
 * SDR. Os gatilhos incluem um pipeline de piloto (`{ pipeline_id: 13916619, desde_inicio }`),
 * e `cfg.kommo.etapas.*` sao status ids do funil SDR: aplica-los num lead de outro funil
 * moveria esse lead para um estagio que nao existe no funil dele. FAIL-CLOSED: pipeline
 * desconhecido (estado antigo sem `pipeline_id`, config sem `pipeline_sdr`) nao move nada —
 * a Ana segue conversando e o efeito perdido vira log, nunca lead no funil errado.
 */
export function podeMoverEtapa(pipelineId, pipelineSdr) {
  if (pipelineId == null || pipelineSdr == null) return false;
  const a = Number(pipelineId); const b = Number(pipelineSdr);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a === b;
}

/**
 * ctx = { cfg, grade, leadId, fone, nome, estado, channel, agora, plantaoFim, pipelineId }
 * estado e MUTADO (dados, nota, slots_ofertados, agendamento, reagendamentos, escalado, encerrado)
 * e persistido pelo caller. Token do Google e obtido uma vez por turno, sob demanda.
 * `pipelineId` = pipeline REAL do lead (worker le de g.lead.pipeline_id): so com ele igual
 * ao `cfg.kommo.pipeline_sdr` e que as ferramentas mexem na etapa do funil (ver podeMoverEtapa).
 */
export function criarExecutor(ctx) {
  if (!ctx.grade?.dias) throw new Error('criarExecutor: ctx.grade obrigatorio');
  const { cfg, leadId, fone, estado, channel, agora, plantaoFim } = ctx;
  const etapas = cfg.kommo.etapas;
  let tokenGoogle = null;
  const at = async () => (tokenGoogle ||= await getAccessToken());

  // (revisao final C1) unico ponto que move etapa nas 7 ferramentas. Lead de piloto (outro
  // pipeline) nunca entra no funil do SDR: o efeito vira log e a conversa segue igual.
  async function moverEtapa(statusId, rotulo) {
    if (podeMoverEtapa(ctx.pipelineId, cfg.kommo.pipeline_sdr)) {
      await moveLeadStage(leadId, { pipelineId: cfg.kommo.pipeline_sdr, statusId });
      return;
    }
    await logAdvbox('agenda', 'info', `etapa nao movida (pipeline ${ctx.pipelineId} != SDR): ${rotulo}`, { leadId });
  }

  // Tags de resort/situacao no lead. O PATCH do Kommo SUBSTITUI o conjunto (testado 08/09/2026),
  // entao le as atuais, une e grava. Devolve os nomes aplicados de novo (vazio = nada mudou).
  async function aplicarTags({ resort, situacao_cota }) {
    const situacaoId = situacao_cota ? (TAG_SITUACAO[situacao_cota] || null) : null;
    let resortTag = null;
    if (resort) {
      const chave = palavraChave(resort);
      const candidatos = chave ? await listTags(chave).catch(() => []) : [];
      resortTag = escolherTagResort(resort, candidatos);
    }
    if (!resortTag && !situacaoId) return [];
    const lead = await getEntity('leads', leadId);
    const atuais = (lead?._embedded?.tags || []).map((t) => Number(t.id));
    const novas = unirTags(atuais, { resortId: resortTag?.id || null, situacaoId });
    const mudou = novas.length !== atuais.length || novas.some((id) => !atuais.includes(id));
    if (!mudou) return [];
    await setLeadTags(leadId, novas);
    const nomes = [];
    if (resortTag && !atuais.includes(resortTag.id)) nomes.push(resortTag.name);
    if (situacaoId && !atuais.includes(situacaoId)) nomes.push(situacao_cota);
    estado.tags_kommo = novas;
    await persistir();
    await logAdvbox('agenda', 'info', `tags aplicadas no lead ${leadId}: ${nomes.join(', ') || '(reordenadas)'}`, { leadId, tags: novas });
    return nomes;
  }

  async function slotsLivres() {
    const emails = cfg.vendedoras.filter((v) => v.ativa).map((v) => v.email);
    const fim = new Date(agora.getTime() + (cfg.regras.horizonte_dias_uteis + 4) * 864e5);
    const busy = await freeBusy(emails, agora.toISOString(), fim.toISOString(), await at());
    return gerarSlots({ regras: cfg.regras, busyPorVendedora: busy, agora, limite: 40 });
  }

  async function persistir() { await upsertConversation(channel, { customer_id: leadId, customer_name: estado.nome, context: estado }); }

  // (revisao final I1) reserva ATOMICA do par (closer, inicio) no Postgres. O free/busy do
  // Google e um cheque otimista: entre ele e o createEventComMeet cabe outro turno (ou outro
  // lead) pegando o MESMO horario — o Google aceita os dois eventos e a closer fica com dois
  // leads no mesmo slot. A RPC insere com `on conflict do nothing` e devolve false quando a
  // linha ja e de OUTRO lead (mesmo lead = idempotente, retry nao se auto-bloqueia).
  // Fail-open: RPC ausente (SQL v2 ainda nao aplicado) ou com erro => segue so com o freeBusy.
  async function reservarSlot(inicioISO, closer) {
    const { data, error } = await db.rpc('sdr_ia_reservar', { p_chave: RPC_SECRET, p_vendedora: closer, p_inicio: inicioISO, p_lead: leadId });
    if (error) { await logAdvbox('agenda', 'aviso', `reserva de slot indisponivel (segue so com o freeBusy): ${error.message}`.slice(0, 300), { leadId }); return; }
    if (data === false) throw new Error('esse horário acabou de ser reservado; chame consultar_horarios de novo');
  }

  /** Devolve o slot ao pool (cancelamento, remarcacao, rollback). Best-effort: falha vira log. */
  async function liberarSlot(inicioISO, closer) {
    if (!inicioISO || !closer) return;
    const { error } = await db.rpc('sdr_ia_liberar', { p_chave: RPC_SECRET, p_vendedora: closer, p_inicio: new Date(inicioISO).toISOString() });
    if (error) await logAdvbox('agenda', 'aviso', `liberar reserva falhou (${closer} ${inicioISO}): ${error.message}`.slice(0, 300), { leadId });
  }

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
      const oferta = slotsParaOferta({ slots, preferencia, aPartirDeISO: a_partir_de, closer, n: 3, agora });
      estado.slots_ofertados = oferta.map((s) => ({ id: slotId(s, closer), inicio: new Date(s.inicio).toISOString(), closer }));
      estado.closer_escolhida = closer;
      await persistir();
      const nomeCloser = cfg.vendedoras.find((v) => v.email === closer)?.nome;
      return formatarOferta(oferta, closer, agora, nomeCloser);
    },

    async escolher_horario({ slot_id }) {
      const s = (estado.slots_ofertados || []).find((x) => x.id === slot_id);
      if (!s) throw new Error('slot_id não é um dos horários oferecidos; chame consultar_horarios de novo');
      estado.slot_escolhido = { id: s.id, inicio: s.inicio, closer: s.closer };
      // Marcou para depois de amanha (o lead pediu o dia): o cron manda lembrete na vespera
      // (analise 08/09: 2-3 dias comparece 72% vs 80% no dia seguinte).
      estado.horario_fora_padrao = new Date(s.inicio).getTime() > agora.getTime() + 36 * 36e5;
      await persistir();
      const d = estado.dados || {};
      const falta = [d.valor_pago == null ? 'valor aproximado já pago (1 pergunta; se não souber, siga)' : null, !d.nome ? 'nome do lead' : null, 'e-mail'].filter(Boolean);
      return `Anotado: ${fmtHora(new Date(s.inicio))}. Não ofereça horário de novo. Falta perguntar, uma por mensagem: ${falta.join(', ')}. Depois chame agendar com slot_id ${s.id}.`;
    },

    async agendar({ slot_id, email, nome }) {
      if (!(estado.slots_ofertados || []).some((x) => x.id === slot_id) && estado.slot_escolhido?.id) slot_id = estado.slot_escolhido.id;
      if (nome) { estado.dados = { ...(estado.dados || {}), nome: String(nome).trim() }; }
      const p = parseSlotId(slot_id);
      if (!p || !(estado.slots_ofertados || []).some((s) => s.id === slot_id)) throw new Error('slot_id não é um dos horários oferecidos; chame consultar_horarios de novo');
      if (estado.agendamento?.event_id) throw new Error('já existe videochamada marcada; use remarcar');
      // (revisao final I1) o guard acima so ve a copia em MEMORIA deste turno. Duas mensagens
      // do mesmo lead em paralelo (webhook duplicado, lead escrevendo duas vezes) leem o mesmo
      // estado antigo e as duas criam evento. Re-le o que ja foi persistido antes de reservar.
      const persistido = await getConversation(channel).catch(() => null);
      if (persistido?.context?.agendamento?.event_id) {
        estado.agendamento = persistido.context.agendamento; // adota o agendamento real p/ remarcar/cancelar
        throw new Error('já existe videochamada marcada; use remarcar');
      }
      // fix9 item 6: mensagem honesta quando o slot so expirou de tao proximo (antecedencia
      // minima), em vez de cair no "acabou de ser ocupado" do free/busy logo abaixo.
      if (new Date(p.inicioISO) < new Date(agora.getTime() + (cfg.regras.antecedencia_min_minutos ?? 60) * 60000)) throw new Error('esse horário já está muito próximo; chame consultar_horarios de novo');
      // revalida concorrencia: o horario ainda esta livre p/ essa closer?
      const livre = (await slotsLivres()).find((s) => new Date(s.inicio).toISOString() === p.inicioISO && s.vendedoras.includes(p.closer));
      if (!livre) throw new Error('esse horário acabou de ser ocupado; chame consultar_horarios de novo');
      await reservarSlot(p.inicioISO, p.closer); // (I1) trava o par (closer, inicio) antes de criar o evento
      const ini = new Date(p.inicioISO); const fim = new Date(ini.getTime() + cfg.regras.duracao_evento_min * 60000);
      const d = estado.dados || {};
      let eventId; let meetLink;
      try {
        ({ eventId, meetLink } = await createEventComMeet({
          calendarId: p.closer, inicioISO: ini.toISOString(), fimISO: fim.toISOString(),
          titulo: `Videochamada — ${nome || estado.nome || fone} (CBC/Ana)`,
          descricao: descricaoEvento(d, leadId, fone),
          leadId, telefone: fone, nome: nome || estado.nome, accessToken: await at(), convidados: email ? [email] : [],
        }));
      } catch (e) {
        // (I1) sem evento criado a reserva nao pode ficar de pe: ela bloquearia esse horario
        // para sempre (o freeBusy mostraria livre e a reserva recusaria todo mundo).
        await liberarSlot(p.inicioISO, p.closer);
        throw e;
      }
      estado.agendamento = { event_id: eventId, inicio: ini.toISOString(), vendedora: p.closer, meet_link: meetLink, email };
      estado.nome = nome || estado.nome;
      estado.slot_escolhido = null;
      await persistir(); // ANTES dos efeitos no Kommo: se algo falhar, a proxima msg cai em remarcar, nunca em duplicar
      const vend = cfg.vendedoras.find((v) => v.email === p.closer);
      // fix9 item 2: o evento JA existe no Google Agenda a essa altura — os efeitos abaixo
      // (espelho/Kommo/nota) sao best-effort; falhar aqui nunca deve fazer o lead achar que
      // o agendamento nao aconteceu (e tentar de novo, duplicando o evento).
      try {
        await espelhoUpsert({ event_id: eventId, vendedora_email: p.closer, cliente_email: email || null, cliente_nome: estado.nome || null,
          status: 'agendada', color_id: null, scheduled_at: ini.toISOString(), tem_meet: true, source: 'live', origem: 'ana', lead_id: leadId, telefone: fone, raw: {} });
        await moverEtapa(etapas.agendada, 'agendada');
        if (vend?.user_id) await createKommoTask(leadId, 'leads', `Videochamada (Ana): ${fmtHora(ini)} — Meet: ${meetLink}`, Math.max(1, (ini - Date.now()) / 36e5), vend.user_id);
        await postNote(leadId, `CBC.ana.agendou:${eventId}`, `Ana agendou ${fmtHora(ini)} com ${vend?.nome || p.closer}. Meet: ${meetLink}. E-mail: ${email}. Dados: ${JSON.stringify(d)}`);
      } catch (e) {
        await logAdvbox('agenda', 'erro', `agendar: efeito pos-booking falhou (nao fatal): ${e.message}`.slice(0, 300), { leadId, eventId });
      }
      return `Agendado: ${fmtHora(ini)} com ${vend?.nome || 'a equipe'}. Link do Meet: ${meetLink}. Convite enviado para ${email}.`;
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
      await reservarSlot(p.inicioISO, p.closer); // (I1) mesma trava do agendar
      const ini = new Date(p.inicioISO); const fim = new Date(ini.getTime() + cfg.regras.duracao_evento_min * 60000);
      const closerAnterior = ag.vendedora;
      let eventId = ag.event_id; let meetLink = ag.meet_link;
      if (p.closer === ag.vendedora) {
        // (revisao final I7) sem este try/catch, um patchEventHorario que falhasse deixava
        // a reserva do horario novo de pe para sempre: o freeBusy mostraria livre e a RPC de
        // reserva recusaria todo mundo — o mesmo vazamento que o agendar() ja evitava (I1).
        try {
          await patchEventHorario({ calendarId: ag.vendedora, eventId, inicioISO: ini.toISOString(), fimISO: fim.toISOString(), accessToken: await at(), notificar: true });
        } catch (e) {
          await liberarSlot(p.inicioISO, p.closer);
          await logAdvbox('agenda', 'erro', `remarcar: patchEventHorario falhou (reserva liberada): ${e.message}`.slice(0, 300), { leadId, eventId });
          throw new Error('não consegui mover o evento; chame consultar_horarios de novo');
        }
        try { await setEventColor({ calendarId: ag.vendedora, eventId, colorId: null, accessToken: await at() }); } catch (e) { await logAdvbox('agenda', 'aviso', `setEventColor falhou (nao fatal): ${e.message}`, { leadId }); }
        const { error } = await db.rpc('agenda_videochamadas_reset_reagendamento', { p_chave: RPC_SECRET, p_event_id: eventId, p_novo_inicio: ini.toISOString() });
        if (error) await logAdvbox('agenda', 'erro', `reset reagendamento falhou: ${error.message}`, { leadId, eventId });
      } else {
        // (revisao final I6) engolir esta falha era o pior dos mundos: o evento ANTIGO segue
        // vivo na agenda da closer anterior, um evento NOVO nasce na outra, e o estado passa a
        // apontar so para o novo — a videochamada zumbi nunca mais e cancelavel pela Ana.
        // Falhou o cancelamento => nada acontece, estado intacto, o modelo avisa o lead.
        try {
          await cancelEvent({ calendarId: ag.vendedora, eventId: ag.event_id, accessToken: await at(), notificar: true });
        } catch (e) {
          await logAdvbox('agenda', 'erro', `remarcar: cancelEvent do evento anterior falhou (abortado): ${e.message}`.slice(0, 300), { leadId, eventId: ag.event_id });
          await liberarSlot(p.inicioISO, p.closer); // desfaz a reserva do horario novo, que nao sera usado
          throw new Error('não consegui liberar o horário anterior; tente remarcar com o mesmo horário mais tarde ou use escalar_para_humano');
        }
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
          // (I1) o antigo ja foi cancelado e o novo nao nasceu: devolve os DOIS horarios ao pool.
          await liberarSlot(ag.inicio, ag.vendedora);
          await liberarSlot(p.inicioISO, p.closer);
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
      // (I1) o horario ANTIGO voltou a ficar livre na agenda: sem devolver a reserva, ele
      // ficaria bloqueado para sempre para qualquer outro lead.
      if (ag.inicio && !(ag.vendedora === p.closer && ag.inicio === ini.toISOString())) await liberarSlot(ag.inicio, ag.vendedora);
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
        await liberarSlot(ag.inicio, ag.vendedora); // (I1) horario volta ao pool p/ os proximos leads
      }
      estado.agendamento = { event_id: null, inicio: null, vendedora: null, meet_link: null };
      await persistir();
      const statusId = motivo === 'desistiu' ? etapas.nao_quer : etapas.follow_up_bot;
      await moverEtapa(statusId, `cancelar (${motivo})`);
      await postNote(leadId, `CBC.ana.cancelou:${Date.now()}`, `Ana cancelou a videochamada. Motivo: ${motivo}.`);
      return `Cancelado (${motivo}).`;
    },

    async registrar_qualificacao({ nome, resort, situacao_cota, tempo, motivo_saida, titular, valor_pago, observacoes }) {
      estado.dados = { ...(estado.dados || {}) };
      if (nome) { estado.dados.nome = String(nome).trim(); estado.nome = estado.dados.nome; }
      if (resort) estado.dados.resort = resort;
      if (situacao_cota) estado.dados.situacao_cota = situacao_cota;
      if (tempo) estado.dados.tempo = tempo;
      if (motivo_saida) estado.dados.motivo_saida = motivo_saida;
      if (titular) estado.dados.titular = titular;
      if (valor_pago != null) estado.dados.valor_pago = Number(valor_pago);
      if (observacoes) estado.dados.observacoes = observacoes;
      estado.nota = calcularNota({ ...estado.dados, mandou_audio: estado.mandou_audio }, cfg.roteamento);
      await persistir();
      if (valor_pago != null && cfg.kommo.campo_investimento_id) await setLeadField(leadId, cfg.kommo.campo_investimento_id, String(valor_pago));
      // Tags no lead (pedido do Paulo 08/09): resort + situacao, SO tags que ja existem. Best-effort:
      // falha vira log, nunca derruba o turno. Vale em qualquer pipeline (inclusive piloto).
      const aplicadas = await aplicarTags({ resort: resort || null, situacao_cota: situacao_cota || null }).catch(async (e) => {
        await logAdvbox('agenda', 'aviso', `tags nao aplicadas: ${e.message}`.slice(0, 300), { leadId });
        return [];
      });
      return `Registrado. Nota do lead: ${estado.nota}.${aplicadas.length ? ` Tags no Kommo: ${aplicadas.join(', ')}.` : ''}`;
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
        await moverEtapa(etapas.precisa_humano, 'precisa_humano');
        // (revisao final M6) tarefa sem responsavel some da fila de todo mundo no Kommo. Quando
        // a config traz `sdr_user_id`, a escalada cai na pessoa certa; sem ela, segue como antes.
        await createKommoTask(leadId, 'leads', `Ana escalou (${motivo}). ${resumo}`, 1, cfg.kommo.sdr_user_id || null);
        await postNote(leadId, `CBC.ana.escalou:${new Date().toISOString().slice(0, 10)}`, `Ana → humano. Motivo: ${motivo}. Resumo: ${resumo}`);
      } catch (e) { estado.escalado = false; estado.escalado_motivo = null; throw e; }
      await persistir();
      // (revisao final M12) o worker ja calculou o fim do plantao neste turno (ctx.plantaoFim);
      // recalcular aqui com `new Date()` dava uma segunda resposta p/ a mesma pergunta — e a
      // Ana podia prometer ao lead um horario diferente do que o [Contexto] do prompt dizia.
      const volta = plantaoFim instanceof Date && !Number.isNaN(plantaoFim.getTime())
        ? plantaoFim
        : proximoInicioExpediente(new Date(), ctx.grade, cfg.regras.feriados || []);
      return `Escalado. Diga ao lead que a equipe responde a partir de ${fmtHora(volta)}.`;
    },

    // mesmo principio de ordenacao do escalar_para_humano acima.
    async encerrar({ motivo }) {
      if (estado.encerrado) return 'Já encerrado.';
      estado.encerrado = true; estado.encerrado_motivo = motivo;
      try {
        await moverEtapa(etapaDeEncerramento(motivo, etapas), `encerrar (${motivo})`);
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
