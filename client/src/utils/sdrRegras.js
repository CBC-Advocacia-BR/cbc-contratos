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
  // relogio do servidor pode ficar levemente atrasado em relacao ao horario
  // gravado na mensagem; negativo nao tem sentido de espera, trata como zero
  const min = Math.max(0, minutos);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = Math.floor(min % 60);
  const dois = (n) => String(n).padStart(2, '0');
  return d > 0 ? `${d}d ${dois(h)}h` : `${dois(h)}h ${dois(m)}m`;
}

/** O grupo depende so dos campos do lead entre si (call_em vs faltou_em etc.),
 *  nunca do relogio atual - por isso, ao contrario de janelaAberta/minutosSemResposta,
 *  esta funcao nao recebe 'agora'. */
/** @returns {'risco'|'call'|'espera'|'semconvite'|'falta'|null} */
export function grupoDoLead(lead) {
  if (!lead || lead.estado === 'descartado') return null;
  if (lead.pediu_remarcar_em) return 'risco';

  // falta nao pode depender da origem limpar call_em ao registrar a falta:
  // se a falta e igual ou posterior a call marcada (ou nao ha call_em), o
  // lead faltou e fica nesse grupo ate ganhar uma call NOVA (call_em depois
  // da falta) — so ai volta a valer a regra de 'call'.
  const tCall = ms(lead.call_em);
  const tFalta = ms(lead.faltou_em);
  if (tFalta !== null && (tCall === null || tFalta >= tCall)) return 'falta';

  if (lead.call_em && !lead.confirmado) return 'call';
  if (lead.call_em && lead.confirmado) return null;
  if (lead.ultima_direcao === 'in' && lead.ultima_em) return 'espera';
  if (lead.ultima_direcao === 'out' && (lead.total_mensagens || 0) >= 4) return 'semconvite';
  return null;
}

// campo de data que define a urgencia dentro de cada grupo
const CAMPO_POR_GRUPO = {
  risco: 'pediu_remarcar_em',
  call: 'call_em',
  espera: 'ultima_em',
  semconvite: 'ultima_em',
  falta: 'faltou_em',
};

/** Ordena por grupo e, dentro do grupo, do mais antigo para o mais novo. */
export function ordenarFila(leads, agora = new Date()) {
  // o carimbo depende do GRUPO do lead, nunca de uma cadeia fixa — senao o
  // campo errado (ex.: ultima mensagem) decide a ordem de um grupo que nao
  // e sobre mensagem (ex.: call). Reserva: se o campo do grupo faltar, cai
  // para os demais campos de data disponiveis, sem quebrar.
  const carimbo = (item) => {
    const l = item.lead;
    const campoPrincipal = CAMPO_POR_GRUPO[item.grupo];
    return (
      ms(l[campoPrincipal]) ??
      ms(l.ultima_em) ??
      ms(l.call_em) ??
      ms(l.faltou_em) ??
      ms(l.pediu_remarcar_em) ??
      0
    );
  };
  return (leads || [])
    .map((l) => ({ lead: l, grupo: grupoDoLead(l, agora) }))
    .filter((x) => x.grupo)
    .sort((a, b) => (ORDEM[a.grupo] - ORDEM[b.grupo]) || (carimbo(a) - carimbo(b)))
    .map((x) => x.lead);
}
