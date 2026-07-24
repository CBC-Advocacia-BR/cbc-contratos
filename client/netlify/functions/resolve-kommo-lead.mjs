/**
 * resolve-kommo-lead: dado o link/lead do Kommo, devolve os dados CRUS para o
 * "Vincular" preencher o formulario (mapeamento no client via utils/kommoResolve).
 * Le ao vivo: Kommo (lead+contato+tags) + Cadastro Unico (clientes, JWT do caller)
 * + Arquivo CBC Conversas (RPC atendimento.primeira_msg_por_telefone, best-effort).
 *
 * Instrumentado: cada chamada externa tem timeout e o passo atual e logado — se
 * algo travar/crashar, vira {ok:false, motivo:'<passo>: <erro>'} + log no Monitor,
 * em vez de um 502 mudo.
 * POST { link } com Authorization: Bearer <JWT do Supabase>.
 */
import { createClient } from '@supabase/supabase-js';
import { db, logAdvbox } from './_lib/botDb.mjs';
import { kommoConfigured, kommoGet, getContact, extractPhones, extrairLeadId } from './_lib/kommo.mjs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://vygczeepvoyaehfchxko.supabase.co';
const ANON = process.env.VITE_SUPABASE_ANON_KEY || '';
const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const JSONH = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
const resp = (s, b) => new Response(JSON.stringify(b), { status: s, headers: JSONH });
const so11 = (t) => (t || '').replace(/\D/g, '').slice(-11);
const withTimeout = (p, ms, label) => Promise.race([
  Promise.resolve(p),
  new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${label} ${ms}ms`)), ms)),
]);

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: JSONH });
  if (req.method !== 'POST') return resp(405, { error: 'somente POST' });
  if (!kommoConfigured()) return resp(500, { error: 'KOMMO_TOKEN ausente' });

  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return resp(401, { error: 'sem credencial (Authorization: Bearer)' });

  let passo = 'auth';
  try {
    const { data: userData, error: authErr } = await withTimeout(db.auth.getUser(jwt), 6000, 'auth.getUser');
    const email = (userData?.user?.email || '').toLowerCase();
    if (authErr || !email) return resp(401, { error: 'sessao invalida — faca login de novo' });

    passo = 'body';
    const { link } = await req.json().catch(() => ({}));
    const leadId = extrairLeadId(link);
    if (!leadId) return resp(400, { ok: false, motivo: 'link do Kommo invalido' });

    const dbUser = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });

    passo = 'kommo:lead';
    const lead = await withTimeout(kommoGet(`/leads/${leadId}?with=contacts`), 6000, 'lead');
    if (!lead || lead.id == null) return resp(200, { ok: false, motivo: 'lead nao encontrado no Kommo' });
    const tags = (lead._embedded?.tags || []).map((t) => t.name).filter(Boolean);
    const leadCriadoEm = lead.created_at ? new Date(lead.created_at * 1000).toISOString() : null;

    passo = 'kommo:contato';
    let telefone = '';
    let emailContato = '';
    const contactId = lead._embedded?.contacts?.[0]?.id;
    if (contactId) {
      const contato = await withTimeout(getContact(contactId), 6000, 'contato');
      const fones = extractPhones(contato) || [];
      telefone = fones[0] || '';
      for (const f of contato?.custom_fields_values || []) {
        if (f.field_code === 'EMAIL') { emailContato = f.values?.[0]?.value || ''; break; }
      }
    }

    passo = 'cadastro';
    let cliente = null;
    try {
      const idq = await withTimeout(dbUser.from('clientes').select('*').eq('kommo_lead_id', String(leadId)).limit(1), 6000, 'clientes:lead');
      if (!idq.error && idq.data?.length) cliente = idq.data[0];
      const t11 = so11(telefone);
      if (!cliente && t11.length >= 10) {
        const eqq = await withTimeout(dbUser.from('clientes').select('*').eq('telefone', t11).limit(1), 6000, 'clientes:tel');
        if (!eqq.error && eqq.data?.length) cliente = eqq.data[0];
      }
    } catch (e) { await logAdvbox('kommo', 'aviso', `resolve cadastro falhou: ${e.message}`.slice(0, 200), { leadId }).catch(() => {}); }

    passo = 'conversas';
    let primeiraMsgConversas = null;
    const t11b = so11(telefone);
    if (t11b.length >= 10 && RPC_SECRET) {
      try {
        const { data: cv } = await withTimeout(dbUser.schema('atendimento').rpc('primeira_msg_por_telefone', { p_tel: telefone, p_chave: RPC_SECRET }), 6000, 'rpc:conversas');
        const row = Array.isArray(cv) ? cv[0] : cv;
        if (row?.tem_conversa) primeiraMsgConversas = row.primeira_msg || null;
      } catch (e) { await logAdvbox('kommo', 'aviso', `resolve conversas falhou: ${e.message}`.slice(0, 200), { leadId }).catch(() => {}); }
    }

    return resp(200, {
      ok: true,
      contato: { telefone, email: emailContato },
      tags,
      cliente,
      clienteConhecido: !!cliente,
      primeiraMsgConversas,
      leadCriadoEm,
      origemSugerida: 'Trafego pago',
    });
  } catch (e) {
    await logAdvbox('kommo', 'erro', `resolve-kommo-lead [${passo}]: ${e.message}`.slice(0, 300), { passo }).catch(() => {});
    return resp(200, { ok: false, motivo: `${passo}: ${e.message}` });
  }
};
