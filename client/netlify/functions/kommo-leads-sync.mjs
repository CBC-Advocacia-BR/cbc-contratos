/**
 * Espelho Kommo -> Supabase (Fase 2). O Kommo NAO preenche CPF (campo morto), entao
 * a chave disponivel e o TELEFONE do contato. Pagina os CONTATOS (com leads vinculados)
 * e grava em kommo_leads (1 linha por lead, com telefone/email/nome do contato). O
 * casamento com o mestre `clientes` e por telefone (na reconciliacao) + pelo linkKommo
 * dos contratos (alta confianca).
 *
 * Modos:
 *  - GET / scheduled  -> varre do inicio (cap por tempo)
 *  - POST { page, maxPages } -> bloco paginado (caller faz o loop pelo `next`)
 *  - POST { listFields:true } -> diagnostico dos campos custom (contatos/leads)
 * Auth (exceto scheduled): body.key | header x-bot-key === BOT_PANEL_KEY
 */
import { db } from './_lib/botDb.mjs';
import { kommoConfigured, listCustomFields, extractPhones, kommoGet } from './_lib/kommo.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const PANEL_KEY = process.env.BOT_PANEL_KEY || 'cbc-bot-2026';
const JSONH = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-bot-key' };

function emailOf(contact) {
  for (const f of contact?.custom_fields_values || []) {
    if (f.field_code === 'EMAIL') return f.values?.[0]?.value || null;
  }
  return null;
}
// telefone normalizado: so digitos, com os ultimos 11 (DDD+9) como chave quando possivel
function telOf(contact) {
  const p = (extractPhones(contact)[0] || '').replace(/\D/g, '');
  return p || null;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: JSONH });
  const isScheduled = req.headers.get('x-netlify-event') === 'schedule' || req.method === 'GET';
  let body = {};
  if (req.method === 'POST') body = await req.json().catch(() => ({}));
  if (!isScheduled) {
    const key = body.key || req.headers.get('x-bot-key') || '';
    if (key !== PANEL_KEY) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: JSONH });
  }

  try {
    if (!kommoConfigured()) return new Response(JSON.stringify({ error: 'KOMMO_TOKEN ausente' }), { status: 500, headers: JSONH });
    if (body.listFields) {
      const [contatos, leads] = await Promise.all([listCustomFields('contacts'), listCustomFields('leads')]);
      return new Response(JSON.stringify({
        contatos: contatos.map(f => ({ id: f.id, nome: f.name, tipo: f.type })),
        leads: leads.map(f => ({ id: f.id, nome: f.name, tipo: f.type })),
      }), { headers: JSONH });
    }

    let page = Number(body.page) || 1;
    const maxPages = Number(body.maxPages) || 40;
    const start = Date.now();
    let contatos = 0, leadsGravados = 0, comTel = 0, lastPage = page, fim = false;

    for (let i = 0; i < maxPages; i++) {
      // order[updated_at]=desc: a API v4 do Kommo corta listas em ~10k linhas — com 18k+
      // contatos em ordem asc os NOVOS nunca eram alcancados (espelho congelou em 18/06/2026).
      // Em desc, a 1a pagina ja traz os recem-criados/alterados; o teto de 10k so deixa de
      // fora contatos antigos que JA estao no espelho.
      const r = await kommoGet(`/contacts?limit=250&page=${page}&with=leads&order[updated_at]=desc`);
      const lista = r?._embedded?.contacts || [];
      if (!lista.length) { fim = true; break; }

      // dedupe por lead_id (um lead pode estar ligado a varios contatos -> evita o
      // "ON CONFLICT cannot affect row a second time"). Mantem a versao com telefone.
      const porLead = new Map();
      for (const c of lista) {
        const leads = c._embedded?.leads || [];
        if (!leads.length) continue;
        const tel = telOf(c);
        const nome = c.name || null;
        const email = emailOf(c);
        const criado = c.created_at ? new Date(c.created_at * 1000).toISOString() : null;
        for (const l of leads) {
          const id = String(l.id);
          const prev = porLead.get(id);
          if (prev && prev.telefone && !tel) continue; // ja tem um com telefone
          porLead.set(id, {
            lead_id: id, contact_id: String(c.id), nome, cpf_cnpj: null,
            telefone: tel, email, pipeline_id: l.pipeline_id || null, status_id: l.status_id || null,
            responsavel: c.responsible_user_id || null, criado_em: criado, synced_at: new Date().toISOString(),
          });
        }
      }
      const rows = [...porLead.values()];
      for (const r2 of rows) if (r2.telefone) comTel++;
      for (let j = 0; j < rows.length; j += 200) {
        const { error } = await db.rpc('kommo_leads_upsert', { p_chave: RPC_SECRET, p_rows: rows.slice(j, j + 200) });
        if (error) throw new Error(`kommo_leads_upsert: ${error.message}`);
      }
      leadsGravados += rows.length;
      contatos += lista.length;
      lastPage = page;
      page++;
      if (lista.length < 250) { fim = true; break; }
      if (Date.now() - start > 7500) break;
    }

    // auto-encadeia as proximas paginas (scheduled/chain) -> cobre TODAS as ~73 paginas
    // sem estourar o timeout de uma function. Cada hop e uma invocacao nova.
    const next = fim ? null : page;
    if (next && (isScheduled || body.chain)) {
      const base = process.env.URL || 'https://contratos-cbc.netlify.app';
      fetch(`${base}/.netlify/functions/kommo-leads-sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: PANEL_KEY, page: next, chain: true }),
      }).catch(() => {});
    }
    return new Response(JSON.stringify({
      success: true, contatos_processados: contatos, com_telefone: comTel,
      leads_gravados: leadsGravados, ultima_pagina: lastPage, next, encadeado: !!(next && (isScheduled || body.chain)),
    }), { headers: JSONH });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: JSONH });
  }
};

// Varredura diaria 08h BRT (11:00 UTC), depois dos snapshots/syncs.
export const config = { schedule: '0 11 * * *' };
