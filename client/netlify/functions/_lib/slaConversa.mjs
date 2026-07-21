/**
 * SLA de 1a resposta + engajamento da conversa (21/07/2026) — logica PURA.
 *
 * Mede, a partir dos events de chat do CONTATO no Kommo (incoming/outgoing):
 *  - t0 ts_msg_campanha: 1a mensagem DO LEAD (a pre-preenchida da campanha CTWA);
 *  - t1 ts_nossa_resposta: nossa 1a mensagem >= t0 (qualquer autor, bot conta);
 *  - t1h ts_resposta_humana: nossa 1a mensagem >= t0 enviada por USUARIO REAL
 *    (created_by presente em humanIds — salesbot/sistema tem created_by 0/robô);
 *  - t2 ts_resposta_lead: 1a mensagem do lead DEPOIS de t1 = "respondeu nossa
 *    primeira mensagem" (engajou). Mensagens do lead ANTES de t1 sao insistencia,
 *    nao engajamento.
 *
 * Timestamps em segundos unix (como a events API devolve). Sem rede/DB aqui.
 */

const sorted = (list) => [...(list || [])]
  .filter((e) => e && Number.isFinite(Number(e.created_at)))
  .sort((a, b) => Number(a.created_at) - Number(b.created_at));

/**
 * @param {object} p
 * @param {Array<{created_at:number, created_by?:number}>} p.incoming mensagens DO lead
 * @param {Array<{created_at:number, created_by?:number}>} p.outgoing mensagens NOSSAS
 * @param {Set<number>} [p.humanIds] ids de usuarios humanos da conta Kommo
 * @returns {{ts_msg_campanha:number|null, ts_nossa_resposta:number|null,
 *   resposta_created_by:number|null, resposta_humana:boolean|null,
 *   ts_resposta_humana:number|null, sla_seg:number|null, sla_humano_seg:number|null,
 *   ts_resposta_lead:number|null, tempo_engajar_seg:number|null,
 *   atendido:boolean|null, engajou:boolean|null}}
 */
export function computeSlaConversa({ incoming, outgoing, humanIds = new Set() }) {
  const ins = sorted(incoming);
  const outs = sorted(outgoing);

  const nulo = {
    ts_msg_campanha: null, ts_nossa_resposta: null, resposta_created_by: null,
    resposta_humana: null, ts_resposta_humana: null, sla_seg: null,
    sla_humano_seg: null, ts_resposta_lead: null, tempo_engajar_seg: null,
    atendido: null, engajou: null,
  };

  // Sem mensagem do lead = lead nao veio por conversa (manual/importado): nao se aplica.
  if (ins.length === 0) return nulo;

  const t0 = Number(ins[0].created_at);
  const resp = outs.find((o) => Number(o.created_at) >= t0) || null;
  const t1 = resp ? Number(resp.created_at) : null;
  const respHumana = outs.find((o) => Number(o.created_at) >= t0 && humanIds.has(Number(o.created_by))) || null;
  const t1h = respHumana ? Number(respHumana.created_at) : null;
  const volta = t1 != null ? (ins.find((i) => Number(i.created_at) > t1) || null) : null;
  const t2 = volta ? Number(volta.created_at) : null;

  return {
    ts_msg_campanha: t0,
    ts_nossa_resposta: t1,
    resposta_created_by: resp ? Number(resp.created_by ?? 0) : null,
    resposta_humana: resp ? humanIds.has(Number(resp.created_by)) : null,
    ts_resposta_humana: t1h,
    sla_seg: t1 != null ? t1 - t0 : null,
    sla_humano_seg: t1h != null ? t1h - t0 : null,
    ts_resposta_lead: t2,
    tempo_engajar_seg: t2 != null && t1 != null ? t2 - t1 : null,
    atendido: t1 != null,
    engajou: t1 != null ? t2 != null : false,
  };
}
