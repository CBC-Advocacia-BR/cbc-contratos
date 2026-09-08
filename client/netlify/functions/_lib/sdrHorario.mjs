// Plantao da Ana: ela so fala FORA da grade do SDR humano (sdr_config) e nos feriados.
// PURO (testado em src/utils/__tests__/sdrHorario.test.js). Datas em Date UTC, regras em SP.
import { partesLocais } from './agendaSlots.mjs';

const hm = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
const soHHMM = (t, padrao) => (t ? String(t).slice(0, 5) : padrao);

/** Grade a partir da linha de sdr_config (aba SDR); fallback = agenda_bot.regras. */
export function gradeDeConfig(row, regras = {}) {
  return {
    inicio: soHHMM(row?.grade_inicio, regras.hora_inicio || '08:00'),
    fim: soHHMM(row?.grade_fim, regras.hora_fim || '17:00'),
    dias: (row?.grade_dias && row.grade_dias.length ? row.grade_dias : (regras.dias || [1, 2, 3, 4, 5])).map(Number),
  };
}

export function foraDoHorario(agora, grade, feriados = []) {
  const { h, m, dow, ymd } = partesLocais(agora);
  if (!grade.dias.includes(dow)) return true;
  if ((feriados || []).includes(ymd)) return true;
  const min = h * 60 + m;
  return min < hm(grade.inicio) || min >= hm(grade.fim);
}

/** Primeiro instante dentro da grade a partir de `agora` (passo de 1 min, teto 30 dias). */
export function proximoInicioExpediente(agora, grade, feriados = []) {
  if (!foraDoHorario(agora, grade, feriados)) return new Date(agora);
  const passo = 60000;
  let t = new Date(Math.ceil(agora.getTime() / passo) * passo);
  const teto = agora.getTime() + 30 * 864e5;
  while (t.getTime() < teto) {
    const { h, m, dow, ymd } = partesLocais(t);
    if (grade.dias.includes(dow) && !(feriados || []).includes(ymd) && h * 60 + m === hm(grade.inicio)) return t;
    // pula direto p/ o proximo inicio de dia quando ja passou da grade
    if (h * 60 + m >= hm(grade.fim)) { t = new Date(t.getTime() + (24 * 60 - (h * 60 + m)) * passo); continue; }
    t = new Date(t.getTime() + passo);
  }
  return t;
}

/** Janela em que o cron faz a "entrega da manha": [inicio, inicio + tolerancia) em dia util. */
export function ehJanelaEntrega(agora, grade, feriados = [], toleranciaMin = 5) {
  const { h, m, dow, ymd } = partesLocais(agora);
  if (!grade.dias.includes(dow) || (feriados || []).includes(ymd)) return false;
  const min = h * 60 + m;
  return min >= hm(grade.inicio) && min < hm(grade.inicio) + toleranciaMin;
}
