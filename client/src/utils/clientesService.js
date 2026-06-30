// Camada de dados da aba "Clientes" — fala com o cadastro unico (golden record)
// via as views/RPCs em public (criadas 29/06). Tudo como usuario logado (authenticated).
import { supabase } from '../lib/supabase';

const onlyDigits = (s) => (s || '').replace(/\D/g, '');

export function cpfValido(s) {
  const d = onlyDigits(s);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  let sum = 0; for (let i = 0; i < 9; i++) sum += +d[i] * (10 - i);
  let r = (sum * 10) % 11; if (r === 10) r = 0; if (r !== +d[9]) return false;
  sum = 0; for (let i = 0; i < 10; i++) sum += +d[i] * (11 - i);
  r = (sum * 10) % 11; if (r === 10) r = 0; return r === +d[10];
}
export const cpfInvalido = (r) => !!r.cpf && onlyDigits(r.cpf).length === 11 && !cpfValido(r.cpf);

function mapRow(r) {
  return {
    id: r.cliente_uid, cpf: r.cpf, cpf_fmt: r.cpf_fmt, nome: r.nome || '', email: r.email,
    telefone: r.telefone, nascimento: r.nascimento, cidade: r.cidade, uf: r.uf,
    relacao: r.relacao, eh_pj: r.eh_pj,
    em_advbox: r.em_advbox, em_asaas: r.em_asaas, em_kommo: r.em_kommo, em_contrato: r.em_contrato,
    advbox: r.advbox_customer_id, asaas: r.asaas_customer_id, kommo: r.kommo_lead_id,
    nome_conflito: r.nome_conflito, atualizado_em: r.atualizado_em,
  };
}

export async function buscarClientes() {
  const cols = 'cliente_uid,cpf,cpf_fmt,nome,email,telefone,nascimento,cidade,uf,relacao,eh_pj,em_advbox,em_asaas,em_kommo,em_contrato,advbox_customer_id,asaas_customer_id,kommo_lead_id,nome_conflito,atualizado_em';
  // PostgREST corta em 1000 linhas/requisicao -> pagina com .range() ate trazer todos
  const PAGE = 1000;
  let all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('vw_cliente_canonico').select(cols).order('nome').range(from, from + PAGE - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < PAGE) break;
  }
  return all.map(mapRow);
}

export async function editarCliente(uid, patch) {
  const { data, error } = await supabase.rpc('cliente_editar', { p_uid: uid, p_patch: patch });
  if (error) throw new Error(error.message);
  return data;
}
export async function setRelacao(uids, relacao) {
  const { data, error } = await supabase.rpc('cliente_set_relacao', { p_uids: uids, p_relacao: relacao });
  if (error) throw new Error(error.message);
  return data;
}
export async function fundirClientes(sobrevive, absorvidos) {
  const { data, error } = await supabase.rpc('cliente_fundir', { p_sobrevive: sobrevive, p_absorvidos: absorvidos });
  if (error) throw new Error(error.message);
  return data;
}

// Fila de revisao (conflitos marcados pela reconciliacao) — admin
export async function buscarFilaRevisao() {
  const { data, error } = await supabase.rpc('merge_fila_listar');
  if (error) throw new Error(error.message);
  return data || [];
}
export async function resolverFila(itemId, decisao, args = {}) {
  const { data, error } = await supabase.rpc('merge_resolver', { p_item: itemId, p_decisao: decisao, p_args: args });
  if (error) throw new Error(error.message);
  return data;
}

// Vincular numero/link do Kommo ao cliente (marca manual; vazio = desvincula)
export async function setKommo(uid, lead) {
  const { data, error } = await supabase.rpc('cliente_set_kommo', { p_uid: uid, p_lead: lead || null });
  if (error) throw new Error(error.message);
  return data;
}

// Vinculo de conjuge (admin)
export async function vincularConjuge(a, b) {
  const { data, error } = await supabase.rpc('cliente_vincular_conjuge', { p_a: a, p_b: b });
  if (error) throw new Error(error.message);
  return data;
}
export async function desvincularConjuge(uid) {
  const { data, error } = await supabase.rpc('cliente_desvincular_conjuge', { p_uid: uid });
  if (error) throw new Error(error.message);
  return data;
}

// Visao 360 de um cliente (cadastro + perfil + cobrancas + contratos + portal + conjuge)
export async function buscar360(uid) {
  const { data, error } = await supabase.from('vw_cliente_360_full').select('*').eq('cliente_uid', uid).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// Devedores: Map CPF(so digitos) -> link do boleto mais antigo. Le a view leve (1 linha por CPF).
export async function buscarCpfsDevedores() {
  const { data, error } = await supabase.from('vw_boletos_devedores').select('cpf,bank_slip_url');
  if (error) throw error;
  const m = new Map();
  for (const b of (data || [])) { if (b.cpf) m.set(b.cpf, b.bank_slip_url || null); }
  return m;
}

// Prestacao de Contas / Peticoes ligadas ao cliente (por processo/cpf/nome)
export async function buscarPrestacao(uid) {
  const { data, error } = await supabase.rpc('cliente_prestacao', { p_uid: uid });
  if (error) throw new Error(error.message);
  return data || [];
}

// Lista guiada: correcoes feitas no golden que ainda divergem do AdvBox (corrigir la na mao)
export async function buscarCorrecoesAdvbox() {
  const { data, error } = await supabase.from('vw_advbox_correcoes_pendentes').select('*').order('cliente_nome');
  if (error) throw new Error(error.message);
  return data || [];
}

// Proveniencia: campos editados a mao (vencem a sincronizacao). Retorna Set de nomes de campo.
export async function buscarProveniencia(uid) {
  const { data, error } = await supabase.rpc('cliente_proveniencia', { p_uid: uid });
  if (error) throw new Error(error.message);
  const manual = new Set();
  for (const r of (data || [])) { if (r.sistema === 'manual') manual.add(r.campo); }
  return manual;
}
