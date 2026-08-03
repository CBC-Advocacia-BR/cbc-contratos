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
import { classificarLink, classificarFalha } from './_lib/kommoLink.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const JSONH = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
const resp = (s, b) => new Response(JSON.stringify(b), { status: s, headers: JSONH });
const withTimeout = (p, ms, label) => Promise.race([
  Promise.resolve(p),
  new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${label} ${ms}ms`)), ms)),
]);

// (item 2) o contato do Kommo pode ter varios telefones; se o 1o vier incompleto,
// pega o MAIS completo (11 digitos nacionais = celular com o 9). Todo numero e WhatsApp.
function digitosNac(f) {
  let d = String(f || '').replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2); // dropa codigo de pais BR
  return d;
}
function melhorFone(fones) {
  const arr = (fones || []).filter(Boolean);
  if (!arr.length) return '';
  const score = (f) => { const n = digitosNac(f).length; return n === 11 ? 3 : n === 10 ? 2 : n >= 8 ? 1 : 0; };
  return arr.slice().sort((a, b) => score(b) - score(a))[0]; // 11 > 10 > qualquer; estavel se empatam
}

// (03/08/2026) MODO LEVE — so responde "esse lead existe?". Nasceu da auditoria de
// 02/08: 37 leads mortos / 42 contratos apontando para lead inexistente, com 271 notas e
// 57 cobrancas que nunca chegaram ao cliente. O resolve completo (contato + tags + RPC do
// Cadastro Unico + 1a mensagem) e caro demais p/ rodar no blur de um campo, entao aqui o
// fluxo corta logo apos o GET do lead.
//
// Devolve SEMPRE 200 com {veredito}: 'existe' | 'nao_existe' | 'desconhecido' | 'invalido'.
// 'desconhecido' e o lado seguro (Kommo fora do ar nao pode impedir uma assinatura).
async function checarExistencia(link) {
  const cls = classificarLink(link);
  if (cls.veredito !== 'checar') {
    return resp(200, { ok: true, veredito: cls.veredito, motivo: cls.motivo, leadId: cls.leadId || null });
  }
  if (!kommoConfigured()) {
    return resp(200, { ok: true, veredito: 'desconhecido', leadId: cls.leadId, motivo: 'Nao foi possivel conferir agora (Kommo nao configurado).' });
  }
  try {
    const lead = await withTimeout(kommoGet(`/leads/${cls.leadId}`), 6000, 'lead');
    if (!lead || lead.id == null) {
      return resp(200, { ok: true, veredito: 'nao_existe', leadId: cls.leadId, motivo: 'Esse lead nao existe mais no Kommo (apagado ou mesclado com outro).' });
    }
    // AUTO-CURA: o lead responde, entao esta vivo. Se estava marcado como morto (por
    // falha real na fila, ver kommoQueue), a linha sai daqui — assim corrigir o link no
    // formulario ja destrava o fluxo, sem ninguem precisar rodar DELETE na mao.
    // De proposito NAO ha atalho lendo kommo_leads_mortos antes do GET: se um lead
    // fosse marcado por engano, o atalho o rejeitaria para sempre, sem caminho de volta.
    try { await db.from('kommo_leads_mortos').delete().eq('lead_id', String(cls.leadId)); } catch { /* best-effort */ }
    return resp(200, { ok: true, veredito: 'existe', leadId: cls.leadId, nome: lead.name || null });
  } catch (e) {
    const f = classificarFalha(e);
    return resp(200, { ok: true, veredito: f.veredito, leadId: cls.leadId, motivo: f.motivo });
  }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: JSONH });
  if (req.method !== 'POST') return resp(405, { error: 'somente POST' });
  // A guarda de KOMMO_TOKEN mora depois do parse do corpo: o modo apenasExistencia
  // precisa responder 'desconhecido' (que NAO bloqueia) em vez de 500 quando falta token.

  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return resp(401, { error: 'sem credencial (Authorization: Bearer)' });

  let passo = 'auth';
  try {
    const { data: userData, error: authErr } = await withTimeout(db.auth.getUser(jwt), 6000, 'auth.getUser');
    const email = (userData?.user?.email || '').toLowerCase();
    if (authErr || !email) return resp(401, { error: 'sessao invalida — faca login de novo' });

    passo = 'body';
    const { link, apenasExistencia } = await req.json().catch(() => ({}));

    // (03/08/2026) conferencia leve do Link Kommo no formulario — nao segue para o
    // resolve completo (contato, tags, Cadastro Unico), que aqui seria desperdicio.
    if (apenasExistencia) return await checarExistencia(link);

    if (!kommoConfigured()) return resp(500, { error: 'KOMMO_TOKEN ausente' });
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
    let nomeLead = ''; // (item 1) nome do contato/lead p/ conferir o match por telefone
    const contactId = lead._embedded?.contacts?.[0]?.id;
    if (contactId) {
      const contato = await withTimeout(getContact(contactId), 6000, 'contato');
      const fones = extractPhones(contato) || [];
      telefone = melhorFone(fones); // (item 2) prefere o numero completo
      nomeLead = contato?.name || '';
      for (const f of contato?.custom_fields_values || []) {
        if (f.field_code === 'EMAIL') { emailContato = f.values?.[0]?.value || ''; break; }
      }
    }
    if (!nomeLead) nomeLead = lead.name || '';

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

    // (item 7) registra cada vinculo no Monitor (origem kommo) p/ ver adocao/depurar
    await logAdvbox('kommo', 'info',
      `vinculo: ${email} lead ${leadId} -> ${cliente ? 'conhecido' : 'novo'}${matchPor ? ` (${matchPor})` : ''}`.slice(0, 200),
      { leadId, email, conhecido: !!cliente, matchPor, nomeLead }).catch(() => {});

    return resp(200, {
      ok: true,
      contato: { telefone, email: emailContato },
      tags,
      cliente,
      clienteConhecido: !!cliente,
      matchPor,
      nomeLead,
      primeiraMsgConversas,
      leadCriadoEm,
      origemSugerida: 'Trafego pago',
    });
  } catch (e) {
    await logAdvbox('kommo', 'erro', `resolve-kommo-lead [${passo}]: ${e.message}`.slice(0, 300), { passo }).catch(() => {});
    return resp(200, { ok: false, motivo: `${passo}: ${e.message}` });
  }
};
