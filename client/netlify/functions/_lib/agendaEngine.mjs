// Máquina de estados do bot Ana — PURA (sem I/O). Falas SEMPRE via templates de cfg.mensagens.
import { formatarSlot } from './agendaSlots.mjs';

export function aplicarTemplate(txt, vars = {}) {
  return String(txt || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ''));
}

export function estadoInicial({ lead_id, contact_id = null, nome = '', origem = 'venda' }) {
  // (revisao final I4) `dados` segue o vocabulario que o SDR de IA realmente grava
  // (registrar_qualificacao): resort/situacao_cota/valor_pago/titular/observacoes. As chaves
  // antigas (situacao, valor_aprox) so existiam aqui — nada mais no fluxo da Ana as escrevia,
  // e agenda_bot_metricas contava "qualificadas" por `dados->>situacao`, que nunca preenchia.
  // `situacao`, `nota` e `pipeline_id` sobem p/ o topo porque o worker/ferramentas os gravam.
  return { etapa: 'abertura', lead_id, contact_id, nome,
    dados: { nome: null, resort: null, situacao_cota: null, tempo: null, motivo_saida: null, valor_pago: null, titular: null, observacoes: null },
    slot_escolhido: null,
    slots_ofertados: [], recusas: 0, reagendamentos: 0,
    agendamento: { event_id: null, inicio: null, vendedora: null, meet_link: null },
    pausada_ate: null, situacao: null, nota: null, pipeline_id: null, origem };
}

const varsSlots = (slots, agora) => Object.fromEntries(slots.map((s, i) => [`slot${i + 1}`, formatarSlot(new Date(s.inicio), agora)]));
const proximaPergunta = (d) => (!d.resort ? 'qual_resort' : !d.situacao ? 'qual_situacao' : !d.valor_aprox ? 'qual_valor' : null);

export function decidir({ estado, interp, cfg, agora, slotsDisponiveis = null }) {
  const M = cfg.mensagens; const e = structuredClone(estado); const acoes = [];
  const resp = (tpl, vars) => acoes.push({ tipo: 'responder', mensagem: aplicarTemplate(M[tpl], vars) });

  // guarda-corpos globais (qualquer etapa)
  if (interp.pede_humano) { resp('handoff'); acoes.push({ tipo: 'handoff', motivo: 'pediu_humano' }); e.etapa = 'handoff'; return { novoEstado: e, acoes }; }
  if ((interp.confianca ?? 1) < (cfg.llm?.confianca_minima ?? 0.6)) {
    // pós-review: o código de referência do brief empurrava só a ação 'handoff' aqui, sem
    // resp('handoff') (diferente do guarda-corpo pede_humano acima). O worker só cria tarefa
    // Kommo + nota interna para 'handoff' — nunca fala com o lead nessa ação — então o lead
    // ficava sem NENHUMA resposta quando a confiança do LLM vinha baixa. Corrigido p/ espelhar
    // pede_humano (responde o template da casa antes do handoff); teste em agendaEngine.test.js.
    resp('handoff'); acoes.push({ tipo: 'handoff', motivo: 'confianca_baixa' }); e.etapa = 'handoff'; return { novoEstado: e, acoes };
  }
  // absorve dados de qualificação que vieram em QUALQUER mensagem
  for (const k of ['resort', 'situacao', 'valor_aprox']) if (interp[k] && !e.dados[k]) e.dados[k] = interp[k];
  if (interp.valor_aprox && !acoes.some((a) => a.tipo === 'salvar_campos'))
    acoes.push({ tipo: 'salvar_campos', campos: { investimento: String(interp.valor_aprox) } });

  // pergunta de preço: deflexão da casa (com slots se houver/na negociação). Protocolo
  // buscar_slots unificado (pós-review): null = ainda não buscou; [] = buscou e não achou
  // (impasse); array não-vazio = apresenta. Antes, `slotsDisponiveis?.length` tratava null e []
  // como equivalentes — um [] reemitia buscar_slots (loop) em vez de fechar em impasse.
  if (interp.pergunta_preco) {
    if (e.slots_ofertados.length) { resp('preco', varsSlots(e.slots_ofertados, agora)); return { novoEstado: e, acoes }; }
    if (slotsDisponiveis == null) { acoes.push({ tipo: 'buscar_slots', proposito: 'preco' }); return { novoEstado: e, acoes }; }
    if (!slotsDisponiveis.length) { resp('impasse'); acoes.push({ tipo: 'handoff', motivo: 'sem_slots' }); e.etapa = 'handoff'; return { novoEstado: e, acoes }; }
    const s = slotsDisponiveis.slice(0, cfg.regras.slots_por_oferta);
    e.slots_ofertados = s.map((x) => ({ inicio: new Date(x.inicio).toISOString(), vendedoras: [...x.vendedoras] }));
    e.etapa = 'negociacao';
    resp('preco', varsSlots(s, agora));
    return { novoEstado: e, acoes };
  }

  switch (e.etapa) {
    case 'abertura': resp('abertura'); e.etapa = 'qual_resort'; return { novoEstado: e, acoes };
    case 'qual_resort': case 'qual_situacao': case 'qual_valor': {
      const falta = proximaPergunta(e.dados);
      if (falta) { resp(falta); e.etapa = falta; return { novoEstado: e, acoes }; }
      e.etapa = 'oferta';
      if (!slotsDisponiveis) { acoes.push({ tipo: 'buscar_slots' }); return { novoEstado: e, acoes }; }
      // cai no case 'oferta' abaixo
    }
    case 'oferta': {
      if (!slotsDisponiveis) { acoes.push({ tipo: 'buscar_slots' }); return { novoEstado: e, acoes }; }
      if (!slotsDisponiveis.length) { resp('impasse'); acoes.push({ tipo: 'handoff', motivo: 'sem_slots' }); e.etapa = 'handoff'; return { novoEstado: e, acoes }; }
      const s = slotsDisponiveis.slice(0, cfg.regras.slots_por_oferta);
      e.slots_ofertados = s.map((x) => ({ inicio: new Date(x.inicio).toISOString(), vendedoras: [...x.vendedoras] }));
      const tpl = e.dados.situacao ? 'pitch_oferta' : 'oferta_slots';
      resp(tpl, varsSlots(s, agora)); e.etapa = 'negociacao'; return { novoEstado: e, acoes };
    }
    case 'negociacao': case 'pos_noshow': {
      if (interp.intencao === 'aceita_slot' && Number.isInteger(interp.horario_aceito_idx) && e.slots_ofertados[interp.horario_aceito_idx]) {
        acoes.push({ tipo: e.etapa === 'pos_noshow' ? 'reagendar' : 'agendar', slotIdx: interp.horario_aceito_idx });
        return { novoEstado: e, acoes };
      }
      // protocolo buscar_slots unificado (pós-review): antes, este branch ignorava
      // slotsDisponiveis por completo e devolvia sempre o mesmo buscar_slots, mesmo na
      // re-entrada — o worker já reordena por slotMaisProximo(desejado), então o slot mais
      // próximo do horário pedido é sempre o slot1 aqui.
      if (interp.intencao === 'propoe_horario' && interp.horario_proposto) {
        if (!slotsDisponiveis) { acoes.push({ tipo: 'buscar_slots', desejado: interp.horario_proposto }); return { novoEstado: e, acoes }; }
        if (!slotsDisponiveis.length) { resp('impasse'); acoes.push({ tipo: 'handoff', motivo: 'sem_slots' }); e.etapa = 'handoff'; return { novoEstado: e, acoes }; }
        const s = slotsDisponiveis.slice(0, cfg.regras.slots_por_oferta);
        e.slots_ofertados = s.map((x) => ({ inicio: new Date(x.inicio).toISOString(), vendedoras: [...x.vendedoras] }));
        resp('oferta_slots', varsSlots(s, agora));
        return { novoEstado: e, acoes };
      }
      if (interp.intencao === 'recusa' || interp.intencao === 'outro') {
        e.recusas += 1;
        if (e.recusas >= (cfg.regras.max_recusas ?? 2)) {
          acoes.push({ tipo: 'salvar_campos', campos: { preferencia: 'lead pediu outro horário — combinar manualmente' } });
          resp('impasse'); acoes.push({ tipo: 'handoff', motivo: 'impasse_horario' }); e.etapa = 'handoff';
          return { novoEstado: e, acoes };
        }
        if (!slotsDisponiveis) { acoes.push({ tipo: 'buscar_slots' }); return { novoEstado: e, acoes }; }
        if (!slotsDisponiveis.length) { resp('impasse'); acoes.push({ tipo: 'handoff', motivo: 'sem_slots' }); e.etapa = 'handoff'; return { novoEstado: e, acoes }; }
        const s = slotsDisponiveis.slice(0, cfg.regras.slots_por_oferta);
        e.slots_ofertados = s.map((x) => ({ inicio: new Date(x.inicio).toISOString(), vendedoras: [...x.vendedoras] }));
        resp('oferta_slots', varsSlots(s, agora));
        return { novoEstado: e, acoes };
      }
      resp('oferta_slots', varsSlots(e.slots_ofertados, agora)); return { novoEstado: e, acoes };
    }
    case 'confirmado': {
      if (interp.intencao === 'propoe_horario' || interp.intencao === 'recusa') {
        if ((e.reagendamentos ?? 0) >= (cfg.regras.max_reagendamentos ?? 2)) {
          resp('impasse'); acoes.push({ tipo: 'handoff', motivo: 'reagendamentos_esgotados' }); e.etapa = 'handoff';
          return { novoEstado: e, acoes };
        }
        // mesmo protocolo unificado do case acima (pós-review) — só muda o destino da etapa
        // (pos_noshow) e o fato de "desejado" poder vir null (recusa não tem horario_proposto).
        const desejado = interp.horario_proposto || null;
        if (!slotsDisponiveis) { acoes.push({ tipo: 'buscar_slots', desejado }); e.etapa = 'pos_noshow'; return { novoEstado: e, acoes }; }
        if (!slotsDisponiveis.length) { resp('impasse'); acoes.push({ tipo: 'handoff', motivo: 'sem_slots' }); e.etapa = 'handoff'; return { novoEstado: e, acoes }; }
        const s = slotsDisponiveis.slice(0, cfg.regras.slots_por_oferta);
        e.slots_ofertados = s.map((x) => ({ inicio: new Date(x.inicio).toISOString(), vendedoras: [...x.vendedoras] }));
        e.etapa = 'pos_noshow';
        resp('oferta_slots', varsSlots(s, agora));
        return { novoEstado: e, acoes };
      }
      return { novoEstado: e, acoes }; // "obrigado", "🙏" etc.: silêncio
    }
    default: return { novoEstado: e, acoes };
  }
}

// pós-agendamento (worker chama depois de criar o evento com sucesso)
export function confirmar({ estado, slot, agora, cfg, eventId, meetLink, vendedora }) {
  const e = structuredClone(estado);
  e.agendamento = { event_id: eventId, inicio: new Date(slot.inicio).toISOString(), vendedora, meet_link: meetLink };
  if (e.etapa === 'pos_noshow') e.reagendamentos = (e.reagendamentos ?? 0) + 1;
  e.etapa = 'confirmado'; e.recusas = 0;
  const f = formatarSlot(new Date(slot.inicio), agora);
  const [dia, hora] = f.includes(' às ') ? f.split(' às ') : ['', f];
  return { novoEstado: e, mensagem: aplicarTemplate(cfg.mensagens.confirmado, { dia, hora }) };
}
