// (fix funil 28/07/2026) Fonte UNICA das consultas das etapas do funil, usada pelo
// Dashboard (Funil de conversao) e pela aba Saude do Funil. As duas telas liam as
// mesmas views com codigo duplicado e ja tinham divergido — mesma classe de bug que
// causou o do Edmar (2 copias do mapa ADVBOX). Agora ha um lugar so.
//
// MOTIVO DA PAGINACAO: o PostgREST corta a resposta em 1000 linhas por requisicao
// (db-max-rows), e um .limit(N) maior NAO levanta esse teto. A vw_funil_videochamadas
// ja tinha 2.883 linhas, entao o funil recebia uma fatia arbitraria do heap e perdia
// ~40% das calls: julho/26 exibia 112 agendadas / 87 realizadas no lugar de 191 / 147.
// As demais views ainda cabem em 1000 linhas HOJE (188/178/122), mas crescem com a
// carteira e cairiam no mesmo buraco em silencio — todas paginam pelo mesmo helper.
import { supabase } from '../lib/supabase';

const PAGE = 1000;

/**
 * Paginacao com .range() ate a ultima pagina (idioma do buscarClientes).
 * `build()` precisa devolver um query builder NOVO a cada pagina — reusar o
 * mesmo acumula os modificadores e a 2a pagina vem errada.
 * ORDER BY TOTAL e obrigatorio: com empates o Postgres nao garante a mesma ordem
 * entre paginas e uma linha pode repetir ou sumir na virada. Por isso cada consulta
 * termina numa coluna UNICA (conferido no banco em 28/07: event_id 2.883/2.883,
 * lawsuit_id 188/188 e 178/178, (mes,campaign_id) 122/122). So scheduled_at nao
 * bastaria — 93 linhas da view dividem o mesmo instante.
 */
async function fetchAllPaged(build) {
  let all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < PAGE) break;
  }
  return all;
}

/** Etapa "Distribuidos": processos com n° de processo no ADVBOX. */
export function fetchProcessosDistribuidos() {
  return fetchAllPaged(() =>
    supabase.from('vw_processo_distribuido').select('lawsuit_id').order('lawsuit_id'));
}

/** Etapa "Guia Paga/JEC": processos que passaram da citacao no ADVBOX. */
export function fetchProcessosGuiaPaga() {
  return fetchAllPaged(() =>
    supabase.from('vw_processo_guia_paga').select('lawsuit_id').order('lawsuit_id'));
}

/** Etapas "Videochamada agendada/realizada": agenda do Google, view sem PII. */
export function fetchVideochamadasFunil() {
  return fetchAllPaged(() =>
    supabase.from('vw_funil_videochamadas').select('status, scheduled_at')
      .order('scheduled_at').order('event_id'));
}

/**
 * Etapa "Leads de campanha (Meta)": insights mensais por campanha.
 * `campaign_name` vem SEMPRE — e o que permite tirar as campanhas de VAGA/RH da
 * captacao (isCampanhaRh), como a aba Trafego ja fazia. Sem essa coluna o funil
 * contava curriculo como lead de venda. `gasto` so p/ quem ve investimento/CPL.
 */
export function fetchMetaAdsFunil(comGasto) {
  const cols = comGasto
    ? 'mes, campaign_name, conversas_iniciadas, leads_form, gasto'
    : 'mes, campaign_name, conversas_iniciadas, leads_form';
  // ordena tambem por campaign_id (nao precisa estar no select) — `mes` sozinho
  // empata entre as campanhas do mesmo mes e nao serve de cursor de paginacao.
  return fetchAllPaged(() =>
    supabase.from('meta_ads_mensal').select(cols).order('mes').order('campaign_id'));
}
