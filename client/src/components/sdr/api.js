/**
 * Leitura dos dados da aba SDR. So consulta: nenhuma escrita no Kommo e nenhuma
 * escrita no Google nesta etapa.
 */
import { supabase } from '../../lib/supabase';
import { fetchAllPaged } from '../../utils/supabasePaged';

/** Conversas cuja ultima mensagem foi do cliente, da mais antiga para a mais nova.
 *  ATENCAO: fetchAllPaged recebe uma FUNCAO que monta a consulta (ela chama .range()
 *  em cada pagina). E o ORDER BY precisa ser TOTAL, por isso conversa_id: lead_id
 *  pode ser nulo (nem toda conversa tem lead casado no Kommo — 3 das 930 linhas em
 *  11/08/2026), entao lead_id NAO e unico e nao serve pra paginar. conversa_id vem
 *  do DISTINCT ON (conversa_id) da propria view (migracao sdr_view_conversa_id),
 *  e por isso e garantidamente unico e sem nulo. */
export async function carregarSemResposta() {
  return fetchAllPaged(() =>
    supabase.from('vw_sdr_sem_resposta').select('*').order('conversa_id', { ascending: true })
  );
}

/** Calls de um dia (YYYY-MM-DD).
 *  Le a VIEW, nunca a tabela: agenda_videochamadas esta com RLS ligada e sem policy,
 *  entao consultar a tabela direto devolve zero linhas sem erro nenhum. */
export async function carregarCallsDoDia(diaISO) {
  const { data, error } = await supabase
    .from('vw_sdr_agenda_dia')
    .select('event_id, vendedora_email, cliente_nome, scheduled_at, status, meet_status, lead_id, kommo_match')
    .gte('scheduled_at', `${diaISO}T00:00:00-03:00`)
    .lt('scheduled_at', `${diaISO}T23:59:59-03:00`)
    .order('scheduled_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Historico de uma conversa, do mais antigo para o mais novo.
 *  Le a view public.vw_sdr_mensagens, que expoe atendimento.mensagens (687 mil linhas,
 *  espelho mantido pelo kommo-conversas-sync). O schema atendimento nao e alcancavel
 *  pelo PostgREST, por isso a view. FILTRA SEMPRE por conversa_id. */
export async function carregarMensagens(conversaId) {
  if (!conversaId) return [];
  const { data, error } = await supabase
    .from('vw_sdr_mensagens')
    .select('id, autor, autor_nome, texto, tipo, midia_label, enviada_em')
    .eq('conversa_id', conversaId)
    .order('enviada_em', { ascending: true })
    .limit(500);
  if (error) throw error;
  return data || [];
}

/** Descarte exige motivo: e ele que separa lead ruim de lead mal atendido. */
export async function descartarLead(leadId, motivo, quem) {
  if (!motivo) throw new Error('motivo obrigatorio');
  const { error } = await supabase.from('sdr_lead_estado').upsert({
    lead_id: String(leadId),
    estado: 'descartado',
    motivo_descarte: motivo,
    descartado_por: quem || null,
    descartado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
  }, { onConflict: 'lead_id' });
  if (error) throw error;
}

/** Todas as etapas de todos os funis, com a contagem de leads. Sao 129 linhas: cabe numa
 *  consulta so, e a tela agrupa por funil sem ir ao banco de novo. */
export async function carregarFunilEtapas() {
  const { data, error } = await supabase
    .from('vw_sdr_funil_etapas')
    .select('pipeline_id, pipeline_nome, status_id, status_nome, ordem, leads')
    .order('ordem', { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Os primeiros leads de cada etapa de UM funil. Nunca traz os 16 mil: a view numera
 *  por etapa e aqui a gente corta. */
export async function carregarFunilCards(pipelineId, porEtapa = 12) {
  if (!pipelineId) return [];
  const { data, error } = await supabase
    .from('vw_sdr_funil_cards')
    .select('lead_id, status_id, lead_updated_at, nome, telefone, resort, quente, posicao')
    .eq('pipeline_id', pipelineId)
    .lte('posicao', porEtapa)
    .order('posicao', { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Parametros da operacao. Uma linha so (id = 1). */
export async function carregarConfig() {
  const { data, error } = await supabase.from('sdr_config').select('*').eq('id', 1).single();
  if (error) throw error;
  return data;
}

/** Campos que a tela pode gravar. Lista explicita em vez de "tudo menos": assim uma
 *  coluna nova no banco nao passa a ser gravavel por acidente. */
const CAMPOS_EDITAVEIS = [
  'grade_inicio', 'grade_fim', 'sla_meta_min', 'segura_horario_ate', 'max_remarcacoes',
  'peso_valor', 'peso_resort', 'peso_quitado', 'piso_valor', 'limiar_topo',
  'teto_disparo_dia', 'dias_reinclusao',
];

/** So socios chegam aqui: a tela desabilita os campos para os demais. */
export async function salvarConfig(cfg) {
  const campos = {};
  CAMPOS_EDITAVEIS.forEach((k) => { if (cfg?.[k] !== undefined) campos[k] = cfg[k]; });
  const { error } = await supabase.from('sdr_config').update({
    ...campos,
    atualizado_em: new Date().toISOString(),
  }).eq('id', 1);
  if (error) throw error;
}
