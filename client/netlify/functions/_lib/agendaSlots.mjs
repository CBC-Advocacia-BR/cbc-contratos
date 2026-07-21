// Slots de agenda do bot Ana — PURO (testado em src/utils/__tests__/agendaSlots.test.js).
// Todas as datas em Date UTC; regras expressas no fuso America/Sao_Paulo.
const TZ = 'America/Sao_Paulo';

function partesLocais(d) {
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
