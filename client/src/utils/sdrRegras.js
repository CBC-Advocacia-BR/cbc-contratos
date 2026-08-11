/**
 * Regras puras da fila do SDR. Sem React, sem rede, sem Supabase: so decisao.
 *
 * A ordem existe por evidencia, nao por gosto (ver spec §1):
 *  - quem pediu para remarcar tem horario segurado e some as 17h;
 *  - call de hoje sem confirmacao falta 33,9% das vezes contra 18,2%;
 *  - passar de 12h sem resposta derruba o agendamento de ~32% para 21,8%;
 *  - conversa engajada sem convite e o maior vazamento do funil (2.560 casos).
 */

const ORDEM = { risco: 0, call: 1, espera: 2, semconvite: 3, falta: 4 };
const MS_24H = 24 * 3600 * 1000;

const ms = (iso) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
};

/** A janela da Meta fecha em 24h contadas da ultima mensagem DO CLIENTE. */
export function janelaAberta(ultimaEntradaISO, agora = new Date()) {
  const t = ms(ultimaEntradaISO);
  if (t === null) return false;
  return agora.getTime() - t < MS_24H;
}

export function minutosSemResposta(ultimaEntradaISO, agora = new Date()) {
  const t = ms(ultimaEntradaISO);
  if (t === null) return null;
  return Math.floor((agora.getTime() - t) / 60000);
}

export function fmtEspera(minutos) {
  if (minutos === null || minutos === undefined || !Number.isFinite(minutos)) return '—';
  const d = Math.floor(minutos / 1440);
  const h = Math.floor((minutos % 1440) / 60);
  const m = Math.floor(minutos % 60);
  const dois = (n) => String(n).padStart(2, '0');
  return d > 0 ? `${d}d ${dois(h)}h` : `${dois(h)}h ${dois(m)}m`;
}

/** @returns {'risco'|'call'|'espera'|'semconvite'|'falta'|null} */
export function grupoDoLead(lead, agora = new Date()) {
  if (!lead || lead.estado === 'descartado') return null;
  if (lead.pediu_remarcar_em) return 'risco';
  if (lead.call_em && !lead.confirmado) return 'call';
  if (lead.call_em && lead.confirmado) return null;
  if (lead.ultima_direcao === 'in' && lead.ultima_em) return 'espera';
  if (lead.ultima_direcao === 'out' && (lead.total_mensagens || 0) >= 4) return 'semconvite';
  if (lead.faltou_em) return 'falta';
  return null;
}

/** Ordena por grupo e, dentro do grupo, do mais antigo para o mais novo. */
export function ordenarFila(leads, agora = new Date()) {
  const carimbo = (l) => ms(l.pediu_remarcar_em) ?? ms(l.ultima_em) ?? ms(l.faltou_em) ?? ms(l.call_em) ?? 0;
  return (leads || [])
    .map((l) => ({ lead: l, grupo: grupoDoLead(l, agora) }))
    .filter((x) => x.grupo)
    .sort((a, b) => (ORDEM[a.grupo] - ORDEM[b.grupo]) || (carimbo(a.lead) - carimbo(b.lead)))
    .map((x) => x.lead);
}
