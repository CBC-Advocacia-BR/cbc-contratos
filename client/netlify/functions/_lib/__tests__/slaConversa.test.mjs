import { describe, it, expect } from 'vitest';
import { computeSlaConversa } from '../slaConversa.mjs';

// SLA de 1a resposta + engajamento (21/07/2026).
// t0 = 1a msg do lead (a pre-preenchida da campanha CTWA); t1 = nossa 1a resposta
// (qualquer autor); t1h = nossa 1a resposta HUMANA; t2 = 1a msg do lead DEPOIS de t1
// (= "respondeu nossa primeira mensagem", engajou).
const HUMANOS = new Set([15297463, 15297447]); // Ana, Mariana (exemplos)

const ev = (created_at, created_by = 0) => ({ created_at, created_by });

describe('computeSlaConversa', () => {
  it('fluxo normal: campanha -> bot responde -> humano responde -> lead engaja', () => {
    const r = computeSlaConversa({
      incoming: [ev(1000), ev(5000)],
      outgoing: [ev(1060, 0), ev(1600, 15297463)],
      humanIds: HUMANOS,
    });
    expect(r.ts_msg_campanha).toBe(1000);
    expect(r.ts_nossa_resposta).toBe(1060);       // bot em 60s
    expect(r.resposta_humana).toBe(false);
    expect(r.sla_seg).toBe(60);
    expect(r.ts_resposta_humana).toBe(1600);      // humano em 600s
    expect(r.sla_humano_seg).toBe(600);
    expect(r.ts_resposta_lead).toBe(5000);        // lead voltou depois da nossa 1a
    expect(r.tempo_engajar_seg).toBe(3940);       // 5000-1060
    expect(r.atendido).toBe(true);
    expect(r.engajou).toBe(true);
  });

  it('lead mandou a msg da campanha e NUNCA foi respondido', () => {
    const r = computeSlaConversa({ incoming: [ev(1000)], outgoing: [], humanIds: HUMANOS });
    expect(r.ts_msg_campanha).toBe(1000);
    expect(r.ts_nossa_resposta).toBeNull();
    expect(r.atendido).toBe(false);
    expect(r.engajou).toBe(false);
    expect(r.sla_seg).toBeNull();
  });

  it('respondido mas o lead sumiu (nao engajou)', () => {
    const r = computeSlaConversa({ incoming: [ev(1000)], outgoing: [ev(1300, 15297447)], humanIds: HUMANOS });
    expect(r.atendido).toBe(true);
    expect(r.resposta_humana).toBe(true);        // 1a resposta ja foi humana
    expect(r.sla_humano_seg).toBe(300);
    expect(r.engajou).toBe(false);
    expect(r.ts_resposta_lead).toBeNull();
  });

  it('outgoing ANTES da 1a incoming (mensagem ativa nossa) nao conta como resposta', () => {
    const r = computeSlaConversa({ incoming: [ev(2000)], outgoing: [ev(1000, 15297463), ev(2500, 15297463)], humanIds: HUMANOS });
    expect(r.ts_nossa_resposta).toBe(2500);
    expect(r.sla_seg).toBe(500);
  });

  it('incoming entre t0 e t1 NAO conta como engajamento (lead insistindo antes da resposta)', () => {
    const r = computeSlaConversa({ incoming: [ev(1000), ev(1200)], outgoing: [ev(1500, 0)], humanIds: HUMANOS });
    expect(r.engajou).toBe(false); // 1200 < t1=1500 — nao e "respondeu NOSSA mensagem"
  });

  it('sem nenhuma incoming (lead criado manualmente): metricas nulas, nao se aplica', () => {
    const r = computeSlaConversa({ incoming: [], outgoing: [ev(1000, 0)], humanIds: HUMANOS });
    expect(r.ts_msg_campanha).toBeNull();
    expect(r.atendido).toBeNull();
    expect(r.engajou).toBeNull();
  });

  it('eventos fora de ordem sao ordenados; resposta no MESMO segundo = sla 0', () => {
    const r = computeSlaConversa({ incoming: [ev(3000), ev(1000)], outgoing: [ev(4000, 0), ev(1000, 0)], humanIds: HUMANOS });
    expect(r.ts_msg_campanha).toBe(1000);
    expect(r.ts_nossa_resposta).toBe(1000);
    expect(r.sla_seg).toBe(0);
  });
});
