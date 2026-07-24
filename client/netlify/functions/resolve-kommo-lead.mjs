/**
 * resolve-kommo-lead: dado o link/lead do Kommo, devolve os dados CRUS para o
 * "Vincular" preencher o formulario (mapeamento no client via utils/kommoResolve).
 *
 * Le ao vivo: Kommo (lead+contato+tags) + RPC public.resolve_kommo_dados (SECURITY
 * DEFINER, segredo BOT_RPC_SECRET) que devolve o cliente do Cadastro Unico + a 1a
 * mensagem no Arquivo CBC Conversas — via o `db` do botDb (anon com fallback proprio).
 * NAO usa createClient/JWT do caller (evita o "supabaseKey is required" das functions).
 *
 * Instrumentado: cada chamada externa tem timeout e o passo e logado — falha vira
 * {ok:false, motivo:'<passo>: <erro>'} + log no Monitor, nunca 502 mudo.
 * POST { link } com Authorization: Bearer <JWT do Supabase>.
 */
import { db, logAdvbox } from './_lib/botDb.mjs';
import { kommoConfigured, kommoGet, getContact, extractPhones, extrairLeadId } from './_lib/kommo.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const JSONH = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
const resp = (s, b) => new Response(JSON.stringify(b), { status: s, headers: JSONH });
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

    passo = 'dados';
    let cliente = null;
    let primeiraMsgConversas = null;
    if (RPC_SECRET) {
      const { data: dd, error } = await withTimeout(
        db.rpc('resolve_kommo_dados', { p_lead: String(leadId), p_tel: telefone, p_chave: RPC_SECRET }),
        6000, 'rpc:dados',
      );
      if (error) {
        await logAdvbox('kommo', 'aviso', `resolve dados: ${error.message}`.slice(0, 200), { leadId }).catch(() => {});
      } else if (dd) {
        cliente = dd.cliente || null;
        if (dd.tem_conversa) primeiraMsgConversas = dd.primeira_msg || null;
      }
    }

    // (item 9) transparencia: casou pelo lead ligado ao cadastro, ou so pelo telefone?
    const matchPor = cliente
      ? (String(cliente.kommo_lead_id || '') === String(leadId) ? 'lead' : 'telefone')
      : null;

    return resp(200, {
      ok: true,
      contato: { telefone, email: emailContato },
      tags,
      cliente,
      clienteConhecido: !!cliente,
      matchPor,
      primeiraMsgConversas,
      leadCriadoEm,
      origemSugerida: 'Trafego pago',
    });
  } catch (e) {
    await logAdvbox('kommo', 'erro', `resolve-kommo-lead [${passo}]: ${e.message}`.slice(0, 300), { passo }).catch(() => {});
    return resp(200, { ok: false, motivo: `${passo}: ${e.message}` });
  }
};
