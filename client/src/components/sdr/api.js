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
 *  NOTA (11/08/2026): a tabela public.sdr_mensagens foi removida (nunca foi alimentada).
 *  O historico real de conversas vive no schema atendimento (espelho de kommo_talks).
 *  Esta funcao sera implementada quando o espelho atendimento.mensagens estiver pronto
 *  na etapa 2 (task 6b). Por enquanto, devolve lista vazia — sem parametro, porque o
 *  no-op nao usa nenhum; a etapa 2 recebe leadId de volta junto com a implementacao real. */
export async function carregarMensagens() {
  // TODO: Implementar leitura do espelho atendimento.mensagens na etapa 2
  // (assinatura futura: carregarMensagens(leadId))
  // const { data, error } = await supabase
  //   .from('atendimento.mensagens')
  //   .select('id, direcao, autor_nome, tipo, texto, criado_em')
  //   .eq('lead_id', String(leadId))
  //   .order('criado_em', { ascending: true })
  //   .limit(500);
  // if (error) throw error;
  // return data || [];
  return [];
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
