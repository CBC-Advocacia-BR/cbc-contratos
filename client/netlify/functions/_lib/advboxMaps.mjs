// Mapeamentos ADVBOX (origem do lead + tipo de acao) — FONTE UNICA de verdade.
// Usado pela function advbox-sync.mjs e pelos testes (vitest). Modulo PURO: sem env,
// sem SDK, sem import.meta — bundla tanto na Netlify Function quanto no Vite/vitest.
// (#9) Antes existiam DUAS copias (aqui no servidor e no client advboxService.js, hoje
// removido); elas divergiram e causaram o bug do "Revisao de Distrato". Agora e uma so.

const DIACRITICOS = /[̀-ͯ]/g;
const norm = (s) => String(s).normalize('NFD').replace(DIACRITICOS, '').toLowerCase();

// ─── Origens do formulario -> IDs do ADVBOX ───
export const ORIGEM_MAP = {
  'Facebook': 557269, 'Trafego pago': 568498, 'Formulario': 560111,
  'Google': 557270, 'Indicacao': 570890, 'Instagram': 557271,
  'Organico': 571481, 'Outros': 568572,
};

// ─── Tipo de acao -> IDs do ADVBOX (grupo MULTIPROPRIEDADE) ───
export const TIPO_ACAO_MAP = {
  'Acao de cobranca': 2151644, 'Cancelamento de contrato': 2151645,
  'Cota quitada sem matricula': 2151646, 'Dano moral': 2187482,
  'Devolucao 80%': 2151642, 'Devolucao 50%': 2151643,
  'Distrato por atraso': 2151641, 'Revisao de Distrato': 2392340,
  'Execucao Honorarios': 2182736, 'Outros': 2187483,
};

/** Busca o ID da origem mais proxima (fallback: Outros) */
export function getOrigemId(origem) {
  if (!origem) return ORIGEM_MAP['Outros'];
  const n = norm(origem);
  for (const [key, id] of Object.entries(ORIGEM_MAP)) {
    if (n.includes(norm(key))) return id;
  }
  return ORIGEM_MAP['Outros'];
}

/** Busca o ID do tipo de acao (match exato por substring + fallbacks; fallback final: Outros) */
export function getTipoAcaoId(tipo) {
  if (!tipo) return TIPO_ACAO_MAP['Outros'];
  const n = norm(tipo);
  for (const [key, id] of Object.entries(TIPO_ACAO_MAP)) {
    if (n.includes(norm(key))) return id;
  }
  // Fallback por palavras-chave
  if (/revis/i.test(n)) return TIPO_ACAO_MAP['Revisao de Distrato'];
  if (/cobran/i.test(n)) return TIPO_ACAO_MAP['Acao de cobranca'];
  if (/cancelamento/i.test(n)) return TIPO_ACAO_MAP['Cancelamento de contrato'];
  if (/quitada|matricula/i.test(n)) return TIPO_ACAO_MAP['Cota quitada sem matricula'];
  if (/dano|moral/i.test(n)) return TIPO_ACAO_MAP['Dano moral'];
  if (/execu/i.test(n)) return TIPO_ACAO_MAP['Execucao Honorarios'];
  if (/atraso/i.test(n)) return TIPO_ACAO_MAP['Distrato por atraso'];
  if (/(devolu|distrato)[^0-9]*80|80\s*%/i.test(n)) return TIPO_ACAO_MAP['Devolucao 80%'];
  if (/(devolu|distrato)[^0-9]*50|50\s*%/i.test(n)) return TIPO_ACAO_MAP['Devolucao 50%'];
  return TIPO_ACAO_MAP['Outros'];
}
