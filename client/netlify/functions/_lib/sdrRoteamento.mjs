// Nota do lead e escolha da closer: melhores leads -> preferida (Mariana), resto -> rodizio.
// PURO (testado em src/utils/__tests__/sdrRoteamento.test.js). Parametros vem de
// bot_config.agenda_bot.roteamento (editaveis sem deploy); ROTEAMENTO_PADRAO e o fallback.
import { sortearVendedora, partesLocais } from './agendaSlots.mjs';

export const ROTEAMENTO_PADRAO = {
  limiar: 3,
  preferida: 'marianamaciel@advocaciacbc.com',
  janela_dias_uteis: 2,
  valor_alto_min: 30000,
  resorts_alta: ['hot beach you', 'hard rock', 'barretos', 'solar das aguas', 'ondas', 'thermas', 'praias do lago'],
  pontos: { resort_alta: 2, quitada: 1, valor_alto: 1, audio: 1, resort_nao_identificado: -2 },
};

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function calcularNota(dados = {}, rotIn = {}) {
  const rot = { ...ROTEAMENTO_PADRAO, ...rotIn, pontos: { ...ROTEAMENTO_PADRAO.pontos, ...(rotIn.pontos || {}) } };
  let n = 0;
  const resort = semAcento(dados.resort);
  if (!resort) n += rot.pontos.resort_nao_identificado;
  else if (rot.resorts_alta.some((r) => resort.includes(semAcento(r)))) n += rot.pontos.resort_alta;
  if (semAcento(dados.situacao_cota) === 'quitada') n += rot.pontos.quitada;
  if (Number(dados.valor_pago) >= rot.valor_alto_min) n += rot.pontos.valor_alto;
  if (dados.mandou_audio) n += rot.pontos.audio;
  return n;
}

/** Devolve { email, motivo: 'nota'|'rodizio' } ou null se nenhuma closer tem slot. */
export function escolherCloser({ nota, cfg, slots, seed }) {
  const rot = { ...ROTEAMENTO_PADRAO, ...(cfg?.roteamento || {}) };
  const ativas = (cfg?.vendedoras || []).filter((v) => v.ativa);
  const livres = new Set((slots || []).flatMap((s) => s.vendedoras || []));
  if (!livres.size) return null;
  const preferida = ativas.find((v) => v.email === rot.preferida);
  if (preferida && Number(nota) >= rot.limiar) {
    // dias uteis distintos dos slots, em ordem; a preferida precisa ter slot nos primeiros N
    const dias = [...new Set((slots || []).map((s) => partesLocais(new Date(s.inicio)).ymd))].slice(0, rot.janela_dias_uteis);
    const temNaJanela = (slots || []).some((s) => (s.vendedoras || []).includes(preferida.email) && dias.includes(partesLocais(new Date(s.inicio)).ymd));
    if (temNaJanela) return { email: preferida.email, motivo: 'nota' };
  }
  const outras = ativas.filter((v) => v.email !== rot.preferida);
  const email = sortearVendedora(outras, [...livres], String(seed || ''));
  if (email) return { email, motivo: 'rodizio' };
  // so a preferida tem horario: melhor ela que ninguem
  if (preferida && livres.has(preferida.email)) return { email: preferida.email, motivo: 'rodizio' };
  return null;
}
