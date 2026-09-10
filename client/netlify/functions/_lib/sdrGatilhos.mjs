// Decide se a Ana deve agir num lead e em que situacao (v1: DEPOIS do roteiro fixo do
// Salesbot). PURO (testado em src/utils/__tests__/sdrGatilhos.test.js).
export const ETAPAS_TERMINAIS = [142, 143];
const RE_HANDOFF = /vou reservar o seu hor/i;
const RE_ESCALA = /vou verificar isso e j/i;

export function situacaoDoLead({ lead, cfg, ultimaMsgEscritorio = null, temEventoFuturo = false, temMeetEnviado = false }) {
  if (!lead || !cfg) return null;
  const g = (cfg.gatilhos || []).find((x) => Number(x.pipeline_id) === Number(lead.pipeline_id));
  if (!g) return null;
  const e = cfg.kommo?.etapas || {};
  const st = Number(lead.status_id);
  if (ETAPAS_TERMINAIS.includes(st) || st === e.cliente || st === e.nao_quer) return null;
  if (st === e.precisa_humano) return { acao: 'escalado', motivo: 'etapa precisa de humano' };
  if (st === e.agendada) return temEventoFuturo ? { acao: 'remarcar', motivo: 'lead com call marcada escreveu' } : null;
  if (st === e.nao_compareceu) return { acao: 'noshow', motivo: 'lead faltou e escreveu' };
  if (g.desde_inicio) return { acao: 'inicio', motivo: 'pipeline de piloto' };
  // Precedencia intencional: etapas (precisa_humano/agendada/nao_compareceu) decidem ANTES do
  // texto; e um Meet ja enviado pelo escritorio silencia os gatilhos por texto (handoff E
  // escalado), porque significa que um humano ja assumiu esse lead.
  if (temMeetEnviado) return null;
  const u = String(ultimaMsgEscritorio || '');
  if (RE_HANDOFF.test(u)) return { acao: 'handoff', motivo: 'roteiro terminou com sim' };
  if (RE_ESCALA.test(u)) return { acao: 'escalado', motivo: 'roteiro escalou' };
  return null; // roteiro ainda em curso: nao interferir
}
