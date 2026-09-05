import { describe, it, expect } from 'vitest';
import { situacaoDoLead } from '../../../netlify/functions/_lib/sdrGatilhos.mjs';

const cfg = {
  gatilhos: [{ pipeline_id: 14170107 }, { pipeline_id: 13916619, desde_inicio: true }],
  kommo: { etapas: { em_qualificacao: 109397015, follow_up_bot: 109400411, precisa_humano: 109397011, agendada: 109397019, nao_compareceu: 109397023, nao_quer: 110972323, cliente: 111135391 } },
};
const lead = (status_id, pipeline_id = 14170107) => ({ pipeline_id, status_id });

describe('situacaoDoLead', () => {
  it('fora dos pipelines com gatilho -> null', () => {
    expect(situacaoDoLead({ lead: lead(1, 13760367), cfg })).toBeNull();
  });
  it('terminal, cliente e nao quer -> null', () => {
    for (const s of [142, 143, 111135391, 110972323]) expect(situacaoDoLead({ lead: lead(s), cfg })).toBeNull();
  });
  it('precisa de humano -> escalado', () => {
    expect(situacaoDoLead({ lead: lead(109397011), cfg }).acao).toBe('escalado');
  });
  it('agendada com evento futuro -> remarcar; sem evento -> null', () => {
    expect(situacaoDoLead({ lead: lead(109397019), cfg, temEventoFuturo: true }).acao).toBe('remarcar');
    expect(situacaoDoLead({ lead: lead(109397019), cfg, temEventoFuturo: false })).toBeNull();
  });
  it('nao compareceu -> noshow', () => {
    expect(situacaoDoLead({ lead: lead(109397023), cfg }).acao).toBe('noshow');
  });
  it('em qualificacao: depende da ultima mensagem do escritorio', () => {
    expect(situacaoDoLead({ lead: lead(109397015), cfg, ultimaMsgEscritorio: 'Combinado, Ana. Vou reservar o seu horário e a nossa equipe confirma com você em seguida.' }).acao).toBe('handoff');
    expect(situacaoDoLead({ lead: lead(109397015), cfg, ultimaMsgEscritorio: 'Vou verificar isso e já te respondo.' }).acao).toBe('escalado');
    expect(situacaoDoLead({ lead: lead(109397015), cfg, ultimaMsgEscritorio: 'Qual é a situação da sua cota hoje?' })).toBeNull();
    expect(situacaoDoLead({ lead: lead(109397015), cfg, ultimaMsgEscritorio: 'Combinado, vou reservar o seu horário', temMeetEnviado: true })).toBeNull();
  });
  it('pipeline com desde_inicio responde desde a primeira mensagem', () => {
    expect(situacaoDoLead({ lead: lead(107389179, 13916619), cfg, ultimaMsgEscritorio: null }).acao).toBe('inicio');
  });
});
