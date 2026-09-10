import { describe, it, expect } from 'vitest';
import { decidir, aplicarTemplate, estadoInicial, confirmar } from '../../../netlify/functions/_lib/agendaEngine.mjs';

const CFG = {
  regras: { slots_por_oferta: 2, max_recusas: 2, max_reagendamentos: 2 },
  llm: { confianca_minima: 0.6 },
  mensagens: {
    abertura: 'Oi! Sou a Ana. O que houve com a sua cota?', qual_resort: 'Qual resort?',
    qual_situacao: 'Pagando ou quitou?', qual_valor: 'Quanto já pagou?',
    pitch_oferta: 'Pitch. Tenho {{slot1}} ou {{slot2}}. Qual prefere?',
    oferta_slots: 'Consigo {{slot1}} ou {{slot2}}.', confirmado: 'Ok, agendado {{dia}} às {{hora}}!',
    slot_ocupado: 'Ocupou 😅 {{slot1}} ou {{slot2}}?', preco: 'Sem preço antes. {{slot1}} ou {{slot2}}?',
    handoff: 'Chamando a equipe!', impasse: 'Equipe vai combinar!', pede_texto: 'Pode escrever?',
  },
};
const AGORA = new Date('2026-07-21T13:00:00Z');
const SLOTS = [
  { inicio: new Date('2026-07-21T17:00:00Z'), vendedoras: ['a@x.com'] },
  { inicio: new Date('2026-07-22T12:00:00Z'), vendedoras: ['b@x.com'] },
];
const interp = (x) => ({ intencao: 'outro', resort: null, situacao: null, valor_aprox: null,
  horario_aceito_idx: null, horario_proposto: null, pede_humano: false, pergunta_preco: false, confianca: 0.9, ...x });

describe('aplicarTemplate', () => {
  it('substitui e tolera chave ausente', () => {
    expect(aplicarTemplate('A {{x}} e {{y}}.', { x: '1' })).toBe('A 1 e .');
  });
});

describe('fluxo de qualificação', () => {
  it('abertura → responde com template e vai para qual_resort', () => {
    const { novoEstado, acoes } = decidir({ estado: estadoInicial({ lead_id: 1 }), interp: interp({ intencao: 'saudacao' }), cfg: CFG, agora: AGORA });
    expect(acoes).toEqual([{ tipo: 'responder', mensagem: CFG.mensagens.abertura }]);
    expect(novoEstado.etapa).toBe('qual_resort');
  });
  it('pula perguntas já respondidas (lead contou tudo de uma vez) e pede slots', () => {
    const est = { ...estadoInicial({ lead_id: 1 }), etapa: 'qual_resort' };
    const r = decidir({ estado: est, interp: interp({ intencao: 'responde_qualificacao', resort: 'Hot Beach', situacao: 'pagando', valor_aprox: 'R$ 20.000' }), cfg: CFG, agora: AGORA });
    // (revisao final I4) estadoInicial passou a semear `dados` com o vocabulario do SDR de IA
    // (situacao_cota/valor_pago/titular/observacoes); o motor legado segue gravando as suas
    // proprias chaves por cima, entao a assercao vira toMatchObject.
    expect(r.novoEstado.dados).toMatchObject({ resort: 'Hot Beach', situacao: 'pagando', valor_aprox: 'R$ 20.000' });
    expect(r.acoes[0]).toEqual({ tipo: 'salvar_campos', campos: { investimento: 'R$ 20.000' } });
    expect(r.acoes[1]).toEqual({ tipo: 'buscar_slots' });
    expect(r.novoEstado.etapa).toBe('oferta');
  });
  it('em oferta com slots disponíveis, oferta formatada e guarda slots_ofertados', () => {
    const est = { ...estadoInicial({ lead_id: 1 }), etapa: 'oferta', dados: { resort: 'X', situacao: 'pagando', valor_aprox: 'R$ 5 mil' } };
    const r = decidir({ estado: est, interp: interp({}), cfg: CFG, agora: AGORA, slotsDisponiveis: SLOTS });
    expect(r.acoes[0].tipo).toBe('responder');
    expect(r.acoes[0].mensagem).toContain('hoje às 14h');
    expect(r.acoes[0].mensagem).toContain('amanhã às 9h');
    expect(r.novoEstado.slots_ofertados).toHaveLength(2);
    expect(r.novoEstado.etapa).toBe('negociacao');
  });
});

describe('negociação', () => {
  const emNegociacao = () => ({ ...estadoInicial({ lead_id: 1 }), etapa: 'negociacao',
    dados: { resort: 'X', situacao: 'pagando', valor_aprox: 'R$ 5 mil' },
    slots_ofertados: SLOTS.map((s) => ({ inicio: s.inicio.toISOString(), vendedoras: s.vendedoras })) });
  it('aceite do slot 2 → agendar', () => {
    const r = decidir({ estado: emNegociacao(), interp: interp({ intencao: 'aceita_slot', horario_aceito_idx: 1 }), cfg: CFG, agora: AGORA });
    expect(r.acoes[0]).toEqual({ tipo: 'agendar', slotIdx: 1 });
  });
  it('contraproposta → buscar_slots com desejado', () => {
    const r = decidir({ estado: emNegociacao(), interp: interp({ intencao: 'propoe_horario', horario_proposto: '2026-07-23T13:00:00-03:00' }), cfg: CFG, agora: AGORA });
    expect(r.acoes[0]).toEqual({ tipo: 'buscar_slots', desejado: '2026-07-23T13:00:00-03:00' });
  });
  it('pergunta de preço responde template preco COM slots e não perde a etapa', () => {
    const r = decidir({ estado: emNegociacao(), interp: interp({ intencao: 'pergunta_preco', pergunta_preco: true }), cfg: CFG, agora: AGORA });
    expect(r.acoes[0].mensagem).toContain('Sem preço antes');
    expect(r.acoes[0].mensagem).toContain('hoje às 14h');
    expect(r.novoEstado.etapa).toBe('negociacao');
  });
  it('2ª recusa → salvar preferência + impasse + handoff', () => {
    const est = { ...emNegociacao(), recusas: 1 };
    const r = decidir({ estado: est, interp: interp({ intencao: 'recusa' }), cfg: CFG, agora: AGORA });
    expect(r.acoes.map((a) => a.tipo)).toEqual(['salvar_campos', 'responder', 'handoff']);
    expect(r.novoEstado.etapa).toBe('handoff');
  });
  it('confiança baixa → handoff', () => {
    const r = decidir({ estado: emNegociacao(), interp: interp({ confianca: 0.3 }), cfg: CFG, agora: AGORA });
    expect(r.acoes.some((a) => a.tipo === 'handoff')).toBe(true);
  });
  // Desvio justificado do código de referência: o guarda-corpo de pede_humano (acima) chama
  // resp('handoff') antes de empurrar a ação handoff — o guarda-corpo de confiança baixa, no
  // código do brief, empurrava SÓ a ação handoff, sem responder nada ao lead. Como o worker
  // (Task 8 — worker) só cria tarefa Kommo + nota interna para tipo 'handoff' — nunca
  // fala com o lead nessa ação — o lead ficava em silêncio total. O texto semeado de
  // mensagens.handoff ("Perfeito! Já estou chamando alguém da equipe para falar com você por
  // aqui") é escrito em 1ª pessoa PARA o lead, e a própria regra de negócio do brief agrupa
  // pede_humano/confiança-baixa como equivalentes. Ver client/netlify/functions/_lib/agendaEngine.mjs.
  it('confiança baixa também responde com o handoff da casa (lead não fica sem resposta)', () => {
    const r = decidir({ estado: emNegociacao(), interp: interp({ confianca: 0.3 }), cfg: CFG, agora: AGORA });
    expect(r.acoes.map((a) => a.tipo)).toEqual(['responder', 'handoff']);
    expect(r.acoes[0].mensagem).toBe(CFG.mensagens.handoff);
  });
  it('pede humano em qualquer etapa → responder handoff + handoff', () => {
    const r = decidir({ estado: { ...estadoInicial({ lead_id: 1 }), etapa: 'qual_valor' }, interp: interp({ pede_humano: true, intencao: 'pede_humano' }), cfg: CFG, agora: AGORA });
    expect(r.acoes.map((a) => a.tipo)).toEqual(['responder', 'handoff']);
  });
});

// Pós-review: o protocolo "worker re-chama decidir() com slotsDisponiveis" (null = ainda não
// buscou; [] = buscou e não achou nada; array não-vazio = achou e deve apresentar) só era
// honrado pelos cases qual_*→oferta. Os outros 3 emissores de `buscar_slots` (propoe_horario em
// negociacao/pos_noshow, recusa/outro em negociacao/pos_noshow, e o pedido de reagendar em
// confirmado) ignoravam `slotsDisponiveis` por completo e devolviam sempre o MESMO `buscar_slots`
// — o worker reexecuta a busca, chama decidir() de novo com o resultado, e cai no mesmo branch
// de novo (loop). pergunta_preco tratava null e [] como equivalentes (`slotsDisponiveis?.length`),
// então um [] (buscou, não achou) reemitia buscar_slots em vez de fechar em impasse. Estes testes
// reproduzem cada um dos 4 pontos ANTES da correção (RED) — ver task-4-report.md, seção "Fix
// pós-review", para a saída real do vitest em cada fase.
describe('protocolo buscar_slots — re-entrada (pós-review)', () => {
  const emNegociacao = () => ({ ...estadoInicial({ lead_id: 1 }), etapa: 'negociacao',
    dados: { resort: 'X', situacao: 'pagando', valor_aprox: 'R$ 5 mil' },
    slots_ofertados: SLOTS.map((s) => ({ inicio: s.inicio.toISOString(), vendedoras: s.vendedoras })) });
  const emConfirmado = () => ({ ...estadoInicial({ lead_id: 1 }), etapa: 'confirmado',
    dados: { resort: 'X', situacao: 'pagando', valor_aprox: 'R$ 5 mil' },
    agendamento: { event_id: 'ev0', inicio: SLOTS[0].inicio.toISOString(), vendedora: 'a@x.com', meet_link: 'https://meet/0' } });

  it('contraproposta (negociação) com slots reais → responde oferta_slots, atualiza slots_ofertados e mantém etapa', () => {
    const novos = [
      { inicio: new Date('2026-07-23T14:00:00Z'), vendedoras: ['c@x.com'] },
      { inicio: new Date('2026-07-24T14:00:00Z'), vendedoras: ['d@x.com'] },
    ];
    const r = decidir({ estado: emNegociacao(), interp: interp({ intencao: 'propoe_horario', horario_proposto: '2026-07-23T13:00:00-03:00' }), cfg: CFG, agora: AGORA, slotsDisponiveis: novos });
    expect(r.acoes.map((a) => a.tipo)).toEqual(['responder']);
    expect(r.acoes[0].mensagem).toContain('quinta (23/07)');
    expect(r.novoEstado.slots_ofertados).toEqual(novos.map((s) => ({ inicio: s.inicio.toISOString(), vendedoras: s.vendedoras })));
    expect(r.novoEstado.etapa).toBe('negociacao');
    // vendedoras copiado (spread) — mutar o array original não pode vazar pro estado salvo
    novos[0].vendedoras.push('hacked@x.com');
    expect(r.novoEstado.slots_ofertados[0].vendedoras).toEqual(['c@x.com']);
  });
  it('contraproposta (negociação) com slotsDisponiveis=[] → impasse + handoff (não re-pergunta)', () => {
    const r = decidir({ estado: emNegociacao(), interp: interp({ intencao: 'propoe_horario', horario_proposto: '2026-07-23T13:00:00-03:00' }), cfg: CFG, agora: AGORA, slotsDisponiveis: [] });
    expect(r.acoes.map((a) => a.tipo)).toEqual(['responder', 'handoff']);
    expect(r.acoes[0].mensagem).toBe(CFG.mensagens.impasse);
    expect(r.acoes[1]).toEqual({ tipo: 'handoff', motivo: 'sem_slots' });
    expect(r.novoEstado.etapa).toBe('handoff');
  });
  it('1ª recusa com slots reais → responde oferta_slots (recusas=1 persistido, não re-pergunta)', () => {
    const r = decidir({ estado: emNegociacao(), interp: interp({ intencao: 'recusa' }), cfg: CFG, agora: AGORA, slotsDisponiveis: SLOTS });
    expect(r.acoes.map((a) => a.tipo)).toEqual(['responder']);
    expect(r.acoes[0].mensagem).toContain('hoje às 14h');
    expect(r.novoEstado.recusas).toBe(1);
  });
  it('1ª recusa sem slotsDisponiveis (null) → ainda emite buscar_slots (comportamento mantido)', () => {
    const r = decidir({ estado: emNegociacao(), interp: interp({ intencao: 'recusa' }), cfg: CFG, agora: AGORA });
    expect(r.acoes).toEqual([{ tipo: 'buscar_slots' }]);
    expect(r.novoEstado.recusas).toBe(1);
  });
  it('reagendar a partir de confirmado com slots reais → responde oferta_slots e muda etapa p/ pos_noshow', () => {
    const r = decidir({ estado: emConfirmado(), interp: interp({ intencao: 'propoe_horario', horario_proposto: '2026-07-23T13:00:00-03:00' }), cfg: CFG, agora: AGORA, slotsDisponiveis: SLOTS });
    expect(r.acoes.map((a) => a.tipo)).toEqual(['responder']);
    expect(r.acoes[0].mensagem).toContain('hoje às 14h');
    expect(r.novoEstado.etapa).toBe('pos_noshow');
    expect(r.novoEstado.slots_ofertados).toHaveLength(2);
  });
  it('reagendar a partir de confirmado sem slotsDisponiveis (null) → buscar_slots + etapa pos_noshow (comportamento mantido)', () => {
    const r = decidir({ estado: emConfirmado(), interp: interp({ intencao: 'propoe_horario', horario_proposto: '2026-07-23T13:00:00-03:00' }), cfg: CFG, agora: AGORA });
    expect(r.acoes).toEqual([{ tipo: 'buscar_slots', desejado: '2026-07-23T13:00:00-03:00' }]);
    expect(r.novoEstado.etapa).toBe('pos_noshow');
  });
  it('pergunta_preco com slotsDisponiveis=[] → impasse + handoff (não re-pergunta)', () => {
    const est = { ...estadoInicial({ lead_id: 1 }), etapa: 'negociacao' };
    const r = decidir({ estado: est, interp: interp({ intencao: 'pergunta_preco', pergunta_preco: true }), cfg: CFG, agora: AGORA, slotsDisponiveis: [] });
    expect(r.acoes.map((a) => a.tipo)).toEqual(['responder', 'handoff']);
    expect(r.acoes[0].mensagem).toBe(CFG.mensagens.impasse);
    expect(r.acoes[1]).toEqual({ tipo: 'handoff', motivo: 'sem_slots' });
    expect(r.novoEstado.etapa).toBe('handoff');
  });
});

describe('confirmar()', () => {
  const base = () => ({ ...estadoInicial({ lead_id: 1 }), dados: { resort: 'X', situacao: 'pagando', valor_aprox: 'R$ 5 mil' } });

  it('incrementa reagendamentos só quando o estado de origem é pos_noshow (não em negociacao)', () => {
    const rPos = confirmar({ estado: { ...base(), etapa: 'pos_noshow', reagendamentos: 0 }, slot: { inicio: SLOTS[0].inicio }, agora: AGORA, cfg: CFG, eventId: 'ev1', meetLink: 'https://meet/1', vendedora: 'a@x.com' });
    expect(rPos.novoEstado.reagendamentos).toBe(1);
    expect(rPos.novoEstado.etapa).toBe('confirmado');
    const rNeg = confirmar({ estado: { ...base(), etapa: 'negociacao', reagendamentos: 0 }, slot: { inicio: SLOTS[0].inicio }, agora: AGORA, cfg: CFG, eventId: 'ev2', meetLink: 'https://meet/2', vendedora: 'a@x.com' });
    expect(rNeg.novoEstado.reagendamentos).toBe(0);
    expect(rNeg.novoEstado.etapa).toBe('confirmado');
  });
  it('zera recusas ao confirmar', () => {
    const r = confirmar({ estado: { ...base(), etapa: 'negociacao', recusas: 2 }, slot: { inicio: SLOTS[0].inicio }, agora: AGORA, cfg: CFG, eventId: 'ev3', meetLink: 'https://meet/3', vendedora: 'a@x.com' });
    expect(r.novoEstado.recusas).toBe(0);
  });
  it('dia/hora corretos nas 3 variantes de formatarSlot (hoje, amanhã, dia da semana)', () => {
    const est = { ...base(), etapa: 'negociacao' };
    const rHoje = confirmar({ estado: est, slot: { inicio: SLOTS[0].inicio }, agora: AGORA, cfg: CFG, eventId: 'e1', meetLink: 'm1', vendedora: 'a@x.com' });
    expect(rHoje.mensagem).toBe('Ok, agendado hoje às 14h!');
    const rAmanha = confirmar({ estado: est, slot: { inicio: SLOTS[1].inicio }, agora: AGORA, cfg: CFG, eventId: 'e2', meetLink: 'm2', vendedora: 'b@x.com' });
    expect(rAmanha.mensagem).toBe('Ok, agendado amanhã às 9h!');
    const rQuinta = confirmar({ estado: est, slot: { inicio: new Date('2026-07-23T14:00:00Z') }, agora: AGORA, cfg: CFG, eventId: 'e3', meetLink: 'm3', vendedora: 'a@x.com' });
    expect(rQuinta.mensagem).toBe('Ok, agendado quinta (23/07) às 11h!');
  });
});
