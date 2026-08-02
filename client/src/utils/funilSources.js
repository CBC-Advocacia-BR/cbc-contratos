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
// (auditoria 01/08 — item 85) O laco de paginacao nasceu AQUI e virou utils/supabasePaged.js
// para que Trafego/Socios/relatorios/cobranca parem de reimplementar cada um o seu.
// A regra do ORDER BY TOTAL continua valendo (conferido no banco em 28/07:
// event_id 2.883/2.883, lawsuit_id 188/188 e 178/178, (mes,campaign_id) 122/122).
// So scheduled_at nao bastaria — 93 linhas da view dividem o mesmo instante.
import { fetchAllPaged } from './supabasePaged';

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
  // (auditoria 01/08 — item 231) `origem_status` vem junto: ele diz se o comparecimento
  // foi julgado pela AUDITORIA DO MEET (objetivo, quem entrou na sala) ou pela COR da
  // agenda (marcada a mao pela equipe). Sao duas reguas diferentes convivendo — em 01/08
  // o banco tinha 2.559 eventos por cor e 325 por Meet — e o funil somava tudo sem
  // sinalizar. Comparar um mes de 2025 (so cor) com julho/26 (quase todo Meet) e
  // comparar coisas medidas de formas distintas.
  return fetchAllPaged(() =>
    supabase.from('vw_funil_videochamadas').select('status, scheduled_at, origem_status')
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

/**
 * (auditoria 01/08 — item 229) Leads da Meta DIA A DIA.
 *
 * POR QUE: a etapa de leads vinha so de meta_ads_mensal e um mes que apenas
 * INTERSECTA o periodo entrava INTEIRO. Em qualquer recorte que nao fosse mes
 * fechado (7d, 90d, personalizado) o funil dividia calls do periodo por leads de
 * meses inteiros — a taxa "% dos leads agendaram" saia errada POR CONSTRUCAO
 * (para menos). O espelho diario ja existe desde 15/07 e resolve.
 *
 * `meta_ads_diario` nao guarda o nome da campanha (so campaign_id), e o nome e o
 * que permite tirar as campanhas de VAGA/RH (isCampanhaRh). Por isso esta funcao
 * devolve tambem o mapa id->nome vindo de meta_campanhas (tabela pequena).
 * `level='campaign'` evita contar o mesmo lead 2x (a tabela guarda dia x campanha
 * E dia x anuncio na mesma estrutura).
 */
export async function fetchMetaAdsDiarioFunil(desdeDia) {
  const [linhas, campanhas] = await Promise.all([
    fetchAllPaged(() => {
      let q = supabase.from('meta_ads_diario')
        .select('dia, campaign_id, conversas_iniciadas, leads_form, gasto')
        .eq('level', 'campaign');
      if (desdeDia) q = q.gte('dia', desdeDia);
      return q.order('dia').order('campaign_id');
    }),
    fetchAllPaged(() => supabase.from('meta_campanhas').select('campaign_id, nome').order('campaign_id')),
  ]);
  const nomePorId = new Map((campanhas || []).map((c) => [String(c.campaign_id), c.nome]));
  return (linhas || []).map((l) => ({ ...l, campaign_name: nomePorId.get(String(l.campaign_id)) || '' }));
}

/**
 * (auditoria 01/08/2026 — item 239) SLA de 1a resposta ao lead.
 *
 * O worker do Kommo mede desde 11/07 quanto tempo o lead espera pela primeira
 * resposta, se quem respondeu foi gente ou robo, e se o lead voltou a falar depois.
 * Tudo isso ja estava no banco (`kommo_lead_conversa` -> `vw_funil_sla`) e NENHUMA
 * tela mostrava — e o numero mais duro do funil comercial: em 02/08 eram 217 leads
 * medidos com 75 NUNCA respondidos (34,6%). Perder um terco dos leads por silencio
 * nao aparecia em lugar nenhum; aparecia so como "conversao baixa".
 *
 * A view ja e agregada POR DIA (sem PII, sem nome de cliente) e tem no maximo
 * algumas centenas de linhas, mas pagina pelo mesmo helper por regra do projeto.
 */
export function fetchFunilSla(desdeDia) {
  return fetchAllPaged(() => {
    let q = supabase.from('vw_funil_sla')
      .select('dia, leads_com_conversa, atendidos, pct_atendidos, sla_mediano_min, sla_humano_mediano_min, engajaram, pct_engajou_dos_atendidos');
    if (desdeDia) q = q.gte('dia', desdeDia);
    return q.order('dia');
  });
}
