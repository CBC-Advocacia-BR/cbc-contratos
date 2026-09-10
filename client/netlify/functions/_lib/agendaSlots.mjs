// Slots de agenda do bot Ana — PURO (testado em src/utils/__tests__/agendaSlots.test.js).
// Todas as datas em Date UTC; regras expressas no fuso America/Sao_Paulo.
const TZ = 'America/Sao_Paulo';

export function partesLocais(d) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t)?.value;
  const dows = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { ymd: `${g('year')}-${g('month')}-${g('day')}`, h: +g('hour'), m: +g('minute'), dow: dows[g('weekday')] };
}
const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

export function dentroDoExpediente(date, regras) {
  const { h, m, dow, ymd } = partesLocais(date);
  if (!regras.dias.includes(dow)) return false;
  if ((regras.feriados || []).includes(ymd)) return false;
  const min = h * 60 + m;
  if (min < hm(regras.hora_inicio) || min + (regras.duracao_evento_min || 30) > hm(regras.hora_fim)) return false;
  if (regras.almoco) {
    const fimEv = min + (regras.duracao_evento_min || 30);
    if (min < hm(regras.almoco.fim) && fimEv > hm(regras.almoco.inicio)) return false;
  }
  return true;
}

const livre = (busy, ini, fim) => !(busy || []).some((b) => new Date(b.start) < fim && new Date(b.end) > ini);

export function gerarSlots({ regras, busyPorVendedora, agora, limite = 10 }) {
  const out = [];
  const passo = (regras.granularidade_min || 30) * 60000;
  const minIni = new Date(agora.getTime() + (regras.antecedencia_min_minutos ?? 60) * 60000);
  // arredonda p/ próxima grade :00/:30 (em UTC funciona: SP tem offset múltiplo de 30min)
  let t = new Date(Math.ceil(minIni.getTime() / passo) * passo);
  // trava dura de varredura: nunca conta dia útil por corte de data fixa (fds/feriados em
  // cluster fazem isso não escalar — ver bug pós-review); só o limite de dias úteis abaixo
  // decide quando parar, esta trava é só um teto de segurança contra loop indefinido.
  const capVarredura = new Date(agora.getTime() + 90 * 864e5);
  let diasUteis = new Set();
  while (t < capVarredura && out.length < limite) {
    if (dentroDoExpediente(t, regras)) {
      diasUteis.add(partesLocais(t).ymd);
      if (diasUteis.size > (regras.horizonte_dias_uteis || 5)) break;
      const fim = new Date(t.getTime() + (regras.duracao_evento_min || 30) * 60000);
      const vends = Object.keys(busyPorVendedora).filter((e) => livre(busyPorVendedora[e], t, fim));
      if (vends.length) out.push({ inicio: new Date(t), vendedoras: vends });
    }
    t = new Date(t.getTime() + passo);
  }
  return out;
}

// hash determinístico simples (seed = lead/telefone) p/ sorteio reproduzível em retry
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }

export function sortearVendedora(vendedoras, emailsLivres, seed) {
  const cand = (vendedoras || []).filter((v) => v.ativa && (v.peso || 0) > 0 && emailsLivres.includes(v.email));
  if (!cand.length) return null;
  const total = cand.reduce((s, v) => s + v.peso, 0);
  let r = hash(seed) * total;
  for (const v of cand) { r -= v.peso; if (r <= 0) return v.email; }
  return cand[cand.length - 1].email; // guarda de arredondamento float
}

export function slotMaisProximo(slots, desejadoISO) {
  if (!slots?.length || !desejadoISO) return null;
  const alvo = new Date(desejadoISO).getTime();
  return slots.reduce((best, s) => (!best || Math.abs(s.inicio - alvo) < Math.abs(best.inicio - alvo) ? s : best), null);
}

export function formatarSlot(date, agora) {
  const { h, m, ymd, dow } = partesLocais(date);
  const hora = m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  const hoje = partesLocais(agora).ymd;
  const amanha = partesLocais(new Date(agora.getTime() + 864e5)).ymd;
  if (ymd === hoje) return `hoje às ${hora}`;
  if (ymd === amanha) return `amanhã às ${hora}`;
  const nomes = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const [, mm, dd] = ymd.split('-');
  return `${nomes[dow]} (${dd}/${mm}) às ${hora}`;
}

// ---- SDR de IA: oferta de slots (PURO, testado em agendaSlots.test.js) ----
export function periodoDoSlot(date) { return partesLocais(date).h < 12 ? 'manha' : 'tarde'; }

/** Escolhe ate n slots: primeiro os do periodo pedido, depois completa com os demais; filtra closer e piso de horario. */
/** Prioridade de horario medida em 682 videochamadas (jun-set/2026): 8-11h e 13-14h comparecem
 *  81-82%, 12h 77%, 15-16h 72-73%. Menor = oferecido antes. */
export function prioridadeHora(h) {
  if (h >= 8 && h <= 11) return 0;
  if (h === 13 || h === 14) return 1;
  if (h === 12) return 2;
  if (h === 15 || h === 16) return 3;
  return 4;
}

/** ymd (local) do proximo dia util a partir de `agora` (sabado/domingo pulam para segunda). */
export function ymdProximoDiaUtil(agora) {
  let t = new Date(agora.getTime());
  for (let i = 0; i < 7; i++) {
    t = new Date(t.getTime() + 864e5);
    const { dow, ymd } = partesLocais(t);
    if (dow >= 1 && dow <= 5) return ymd;
  }
  return partesLocais(t).ymd;
}

/**
 * Oferta p/ o lead. Regras (analise 08/09/2026):
 *  - sem `aPartirDeISO` (lead nao pediu dia), so HOJE e o PROXIMO DIA UTIL entram (dia seguinte
 *    comparece 80%, 2-3 dias 72%); com `aPartirDeISO` valido o lead escolheu o dia e vale tudo;
 *  - ordem por prioridadeHora (8-11h e 13-14h primeiro), depois pelo horario; a saida volta
 *    em ordem cronologica p/ a fala da Ana ficar natural.
 */
export function slotsParaOferta({ slots, preferencia = 'qualquer', aPartirDeISO = null, closer = null, n = 3, agora = null }) {
  // (revisao final I3) `a_partir_de` vem do modelo e as vezes chega como texto livre
  // ("segunda", "amanhã de manhã"). Date.parse disso e NaN, e toda comparacao com NaN e
  // false: o filtro abaixo zerava a oferta e a Ana anunciava que nao havia horario nenhum.
  // Data impossivel de interpretar vale como SEM piso (comporta-se como a_partir_de null).
  const parsed = aPartirDeISO ? Date.parse(aPartirDeISO) : NaN;
  const pediuDia = Number.isFinite(parsed);
  const piso = pediuDia ? parsed : 0;
  let base = (slots || []).filter((s) => new Date(s.inicio).getTime() >= piso && (!closer || (s.vendedoras || []).includes(closer)));
  if (!pediuDia && agora instanceof Date && !Number.isNaN(agora.getTime())) {
    const teto = ymdProximoDiaUtil(agora);
    const curto = base.filter((s) => partesLocais(new Date(s.inicio)).ymd <= teto);
    if (curto.length) base = curto; // sem nada ate amanha, cai no que houver (nunca oferta vazia por regra)
  }
  const chave = (s) => { const { h } = partesLocais(new Date(s.inicio)); return [prioridadeHora(h), new Date(s.inicio).getTime()]; };
  const cmp = (a, b) => { const ka = chave(a), kb = chave(b); return ka[0] - kb[0] || ka[1] - kb[1]; };
  const ordenada = [...base].sort(cmp);
  const pref = preferencia === 'qualquer' ? ordenada : ordenada.filter((s) => periodoDoSlot(new Date(s.inicio)) === preferencia);
  const out = pref.slice(0, n);
  for (const s of ordenada) { if (out.length >= n) break; if (!out.includes(s)) out.push(s); }
  return out.sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
}

export function slotId(slot, closer) { return `${new Date(slot.inicio).toISOString()}|${closer}`; }

export function parseSlotId(id) {
  const [iso, closer] = String(id || '').split('|');
  if (!iso || !closer || Number.isNaN(Date.parse(iso))) return null;
  return { inicioISO: new Date(iso).toISOString(), closer };
}
