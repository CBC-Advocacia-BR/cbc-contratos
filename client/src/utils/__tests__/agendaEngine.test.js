import { describe, it, expect } from 'vitest';
import { decidir, aplicarTemplate, estadoInicial } from '../../../netlify/functions/_lib/agendaEngine.mjs';

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
    expect(r.novoEstado.dados).toEqual({ resort: 'Hot Beach', situacao: 'pagando', valor_aprox: 'R$ 20.000' });
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
    slots_ofertados: SLOTS.map((s, i) => ({ inicio: s.inicio.toISOString(), vendedoras: s.vendedoras })) });
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
  // (Mapa de arquivos/Task 6) só cria tarefa Kommo + nota interna para tipo 'handoff' — nunca
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
