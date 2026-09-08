// Memoria por contato da Ana (SDR de IA) + fusao do historico. Partes puras testadas em
// src/utils/__tests__/sdrMemoria.test.js; gerarMemoria() e I/O (Anthropic, Haiku 4.5).
//
// Por que existe (08/09/2026): a Ana so via as ultimas 40 mensagens do espelho do Kommo dos
// ultimos 30 dias, cruas, e o espelho atrasa minutos — as proprias falas dela nem sempre
// estavam no prompt do turno seguinte. Agora: (a) o log da Ana (bot_messages) e fundido ao
// espelho; (b) ao fim de cada sessao um resumo de 10-15 linhas por CONTATO e gravado em
// sdr_ia_memoria e entra no contexto de todo turno com ~200 tokens; (c) o historico cru fica
// so com o que veio depois do resumo (minimo de 10 mensagens).
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** bot_messages -> mesmo formato do espelho ({autor, autor_nome, corpo, tipo, enviada_em}). */
export function botMsgsParaHistorico(rows = []) {
  return (rows || []).map((r) => ({
    autor: r.direction === 'out' ? 'atendente' : 'cliente', autor_nome: r.direction === 'out' ? 'Ana' : null,
    corpo: r.text || '', tipo: 'texto', enviada_em: r.created_at, _fonte: 'ana',
  }));
}

/** Une espelho + log da Ana, sem duplicar (mesmo texto a menos de 15 min), em ordem; cap. */
export function unificarHistorico(espelho = [], botRows = [], cap = 40) {
  const base = (espelho || []).map((m) => ({ ...m, _fonte: m._fonte || 'espelho' }));
  const extras = botMsgsParaHistorico(botRows).filter((b) => {
    const nb = norm(b.corpo); if (!nb) return false;
    const tb = Date.parse(b.enviada_em);
    return !base.some((m) => norm(m.corpo) === nb && Math.abs(Date.parse(m.enviada_em) - tb) < 15 * 60000);
  });
  const todos = [...base, ...extras].filter((m) => Number.isFinite(Date.parse(m.enviada_em)))
    .sort((a, b) => Date.parse(a.enviada_em) - Date.parse(b.enviada_em));
  return todos.slice(-cap);
}

/** Com memoria, o cru e so o que veio depois de msgs_ate (mas nunca menos que `minimo`). */
export function historicoAposMemoria(historico = [], memoria = null, minimo = 10) {
  const ate = memoria?.msgs_ate ? Date.parse(memoria.msgs_ate) : NaN;
  if (!Number.isFinite(ate)) return historico;
  const depois = historico.filter((m) => Date.parse(m.enviada_em) > ate);
  return depois.length >= minimo ? depois : historico.slice(-minimo);
}

/** Precisa refazer a memoria antes do turno? (existe, esta velha e ha conversa nova) */
export function memoriaEstaVelha(memoria, historico = [], agora = new Date(), horas = 24, minNovas = 5) {
  if (!memoria?.atualizado_em) return false;
  if (agora.getTime() - Date.parse(memoria.atualizado_em) < horas * 36e5) return false;
  const ate = Date.parse(memoria.msgs_ate || 0);
  return historico.filter((m) => Date.parse(m.enviada_em) > ate).length >= minNovas;
}

export const MODELO_MEMORIA = 'claude-haiku-4-5-20251001';
const PRECO_HAIKU = { in: 1, out: 5 }; // USD/M

export function montarPromptMemoria({ anterior = null, mensagens = [], nomeContato = '' }) {
  const linhas = mensagens.map((m) => `[${String(m.enviada_em).slice(0, 16).replace('T', ' ')}] ${m.autor === 'cliente' ? 'LEAD' : (m.autor_nome || 'ESCRITÓRIO')}: ${String(m.corpo || '').replace(/\s+/g, ' ').slice(0, 600)}`);
  const system = `Você resume conversas de WhatsApp entre um escritório de advocacia (distrato de cotas de multipropriedade em resorts) e um lead, para que a próxima pessoa ou assistente que atender lembre da história. Responda SOMENTE com JSON válido, sem texto fora dele, no formato:
{"resumo": "10 a 15 linhas curtas em português: quem é, resort e situação da cota, história (como comprou, o que prometeram, por que quer sair), o que o escritório já disse/prometeu, objeções, videochamadas marcadas/realizadas/faltas, pendências e tom do lead", "fatos": {"nome": string|null, "resort": string|null, "situacao_cota": "pagando"|"quitada"|"parou_de_pagar"|null, "motivo_saida": string|null, "objecoes": [string], "pendencias": [string], "tom": string|null, "ja_cliente": true|false|null}}
Regras: não invente; se algo não aparece, null ou lista vazia. Não inclua saúde, dívidas fora da cota ou família a menos que o lead tenha trazido espontaneamente e seja relevante. Datas no formato dd/mm.`;
  const user = `${anterior ? `RESUMO ANTERIOR (atualize com o que vier abaixo, sem perder o que ainda vale):\n${anterior}\n\n` : ''}CONTATO: ${nomeContato || '(sem nome)'}\nMENSAGENS NOVAS (${mensagens.length}):\n${linhas.join('\n') || '(nenhuma)'}`;
  return { system, user };
}

export function parseMemoria(texto) {
  const s = String(texto || '');
  const i = s.indexOf('{'); const j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try {
    const o = JSON.parse(s.slice(i, j + 1));
    if (!o || typeof o.resumo !== 'string') return null;
    return { resumo: o.resumo.trim().slice(0, 4000), fatos: (o.fatos && typeof o.fatos === 'object') ? o.fatos : {} };
  } catch { return null; }
}

/** Chama o Haiku e devolve {resumo, fatos, custo_usd, usage} (lanca se a API falhar/JSON invalido). */
export async function gerarMemoria({ client, anterior = null, mensagens = [], nomeContato = '', modelo = MODELO_MEMORIA }) {
  const { system, user } = montarPromptMemoria({ anterior, mensagens, nomeContato });
  const resp = await client.messages.create({ model: modelo, max_tokens: 1200, system, messages: [{ role: 'user', content: user }] });
  const texto = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const parsed = parseMemoria(texto);
  if (!parsed) throw new Error('memoria: resposta sem JSON valido');
  const u = resp.usage || {};
  const custo_usd = ((u.input_tokens || 0) * PRECO_HAIKU.in + (u.output_tokens || 0) * PRECO_HAIKU.out) / 1e6;
  return { ...parsed, custo_usd, usage: u, modelo: resp.model || modelo };
}

/** Linha do [Contexto] com a memoria (curta; o resumo ja vem limitado). */
export function linhaMemoria(memoria) {
  if (!memoria?.resumo) return null;
  const ate = memoria.msgs_ate ? String(memoria.msgs_ate).slice(0, 10).split('-').reverse().join('/') : '?';
  const pend = Array.isArray(memoria.fatos?.pendencias) && memoria.fatos.pendencias.length ? ` Pendências: ${memoria.fatos.pendencias.join('; ')}.` : '';
  return `Memória deste contato (conversas anteriores até ${ate}; use para não perguntar de novo e para retomar de onde parou): ${memoria.resumo.replace(/\s+/g, ' ')}${pend}`;
}
