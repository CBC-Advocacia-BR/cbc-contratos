/**
 * resolve-kommo-lead: dado o link/lead do Kommo, devolve os dados CRUS para o
 * "Vincular" preencher o formulario. O mapeamento fica no client (utils/kommoResolve).
 *
 * Le ao vivo:
 *  - Kommo: lead + contato + tags (nome do contato NAO e usado — regra do Paulo).
 *  - Cadastro Unico (clientes, RLS 'authenticated' -> client com o JWT do caller).
 *  - Arquivo CBC Conversas (RPC atendimento.primeira_msg_por_telefone, BEST-EFFORT;
 *    se o schema/atendimento nao estiver exposto ou a RPC falhar, cai no fallback
 *    da data de criacao do lead).
 *
 * POST { link } com Authorization: Bearer <JWT do Supabase>.
 * Nunca lanca a ponto de travar o form: em erro devolve { ok:false, motivo } e o
 * front cai no fluxo "Preencher sem vincular".
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

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: JSONH });
  if (req.method !== 'POST') return resp(405, { error: 'somente POST' });
  if (!kommoConfigured()) return resp(500, { error: 'KOMMO_TOKEN ausente' });

  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return resp(401, { error: 'sem credencial (Authorization: Bearer)' });
  const { data: userData, error: authErr } = await db.auth.getUser(jwt);
  const email = (userData?.user?.email || '').toLowerCase();
  if (authErr || !email) return resp(401, { error: 'sessao invalida — faca login de novo' });

  const { link } = await req.json().catch(() => ({}));
  const leadId = extrairLeadId(link);
  if (!leadId) return resp(400, { ok: false, motivo: 'link do Kommo invalido' });

  // client escopado ao caller: respeita RLS 'authenticated' (le clientes; chama a RPC do atendimento)
  const dbUser = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });

  try {
    // 1) lead + contato + tags no Kommo
    const lead = await kommoGet(`/leads/${leadId}?with=contacts`);
    if (!lead || lead.id == null) return resp(200, { ok: false, motivo: 'lead nao encontrado no Kommo' });
    const tags = (lead._embedded?.tags || []).map((t) => t.name).filter(Boolean);
    const leadCriadoEm = lead.created_at ? new Date(lead.created_at * 1000).toISOString() : null;

    let telefone = '';
    let emailContato = '';
    const contactId = lead._embedded?.contacts?.[0]?.id;
    if (contactId) {
      const contato = await getContact(contactId);
      const fones = extractPhones(contato) || [];
      telefone = fones[0] || '';
      for (const f of contato?.custom_fields_values || []) {
        if (f.field_code === 'EMAIL') { emailContato = f.values?.[0]?.value || ''; break; }
      }
    }

    // 2) Cadastro Unico (clientes) — por kommo_lead_id, senao por telefone (so11)
    let cliente = null;
    const idq = await dbUser.from('clientes').select('*').eq('kommo_lead_id', String(leadId)).limit(1);
    if (!idq.error && idq.data?.length) cliente = idq.data[0];
    const t11 = so11(telefone);
    if (!cliente && t11.length >= 10) {
      const eqq = await dbUser.from('clientes').select('*').eq('telefone', t11).limit(1);
      if (!eqq.error && eqq.data?.length) cliente = eqq.data[0];
      if (!cliente) {
        const likeq = await dbUser.from('clientes').select('*').ilike('telefone', `%${t11.slice(-8)}%`).limit(10);
        if (!likeq.error && likeq.data?.length) cliente = likeq.data.find((c) => so11(c.telefone) === t11) || null;
      }
    }

    // 3) 1a mensagem no Arquivo CBC Conversas (best-effort)
    let primeiraMsgConversas = null;
    if (t11.length >= 10 && RPC_SECRET) {
      try {
        const { data: cv } = await dbUser.schema('atendimento').rpc('primeira_msg_por_telefone', { p_tel: telefone, p_chave: RPC_SECRET });
        const row = Array.isArray(cv) ? cv[0] : cv;
        if (row?.tem_conversa) primeiraMsgConversas = row.primeira_msg || null;
      } catch { /* arquivo indisponivel/schema nao exposto -> fallback do lead */ }
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
    await logAdvbox('kommo', 'erro', `resolve-kommo-lead falhou: ${e.message}`.slice(0, 300), { leadId }).catch(() => {});
    return resp(200, { ok: false, motivo: 'nao consegui ler o lead no Kommo agora' });
  }
};
