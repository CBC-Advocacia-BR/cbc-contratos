/**
 * Sincroniza o link do carne (parcelamento Asaas) no campo personalizado "Asaas"
 * do Kommo, para clientes COM contrato gerado pelo sistema + link Kommo.
 *
 * Fonte: 100% Supabase (espelho asaas_boletos via RPC asaas_carnes + contratos).
 * O campo recebe SO o(s) link(s) do carne (uma URL por parcelamento em aberto,
 * uma por linha). Quando todos os parcelamentos do cliente estiverem pagos, o
 * campo recebe "Quitado" e a integracao para de acompanhar aquele lead.
 *
 * Idempotente: le o valor atual do campo e so faz PATCH se mudou (nao gera
 * reescrita nem ruido no CRM).
 *
 * Modos:
 *  - GET / scheduled         -> varredura completa, ESCRITA REAL
 *  - POST { dryRun:true }     -> NAO grava; devolve a previa por lead
 *  - POST { customerId }      -> escopa a um cliente (gatilho do asaas-webhook)
 *  - POST { leadId }          -> escopa a um lead
 * Auth (exceto scheduled): body.key | header x-bot-key === BOT_PANEL_KEY
 */
import { db, logAdvbox } from './_lib/botDb.mjs';
import {
  kommoConfigured, findCustomFieldByName, getEntity, extractFieldValue,
  mainContactOfLead, extrairLeadId, extrairHostKommo,
  getLeadsByIds, enqueueKommo, processQueue,
} from './_lib/kommo.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const PANEL_KEY = process.env.BOT_PANEL_KEY || 'cbc-bot-2026';
const KOMMO_HOST = 'advocaciacbc.kommo.com';
const KOMMO_LEAD_URL = id => `https://${KOMMO_HOST}/leads/detail/${id}`;
const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, x-bot-key' };

// Descobre/carrega field_id + entidade do campo "Asaas", cacheando em bot_config.kommo
async function resolveAsaasField() {
  const { data } = await db.from('bot_config').select('value').eq('key', 'kommo').maybeSingle();
  const cfg = data?.value || {};
  if (cfg.field_id_asaas && cfg.asaas_entity) {
    return { fieldId: Number(cfg.field_id_asaas), entity: cfg.asaas_entity, discovered: false, fieldName: cfg.asaas_field_name || null, fieldType: cfg.asaas_field_type || null };
  }
  const found = await findCustomFieldByName('Asaas');
  if (!found) return { fieldId: null, entity: null, missing: true };
  const novo = { ...cfg, field_id_asaas: found.field_id, asaas_entity: found.entity, asaas_field_name: found.name, asaas_field_type: found.type };
  await db.from('bot_config').upsert({ key: 'kommo', value: novo, updated_at: new Date().toISOString() });
  return { fieldId: Number(found.field_id), entity: found.entity, discovered: true, fieldName: found.name, fieldType: found.type };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });

  const isScheduled = req.headers.get('x-netlify-event') === 'schedule';
  let body = {};
  if (req.method === 'POST') body = await req.json().catch(() => ({}));

  if (!isScheduled) {
    const key = body.key || req.headers.get('x-bot-key') || '';
    if (key !== PANEL_KEY) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: CORS });
  }

  const dryRun = body.dryRun === true && !isScheduled;
  const scopeCustomer = body.customerId || null;
  const scopeLead = body.leadId ? extrairLeadId(body.leadId) : null;

  try {
    if (!kommoConfigured()) return new Response(JSON.stringify({ error: 'KOMMO_TOKEN ausente' }), { status: 500, headers: CORS });

    const field = await resolveAsaasField();
    if (!field.fieldId) return new Response(JSON.stringify({ error: 'campo "Asaas" nao encontrado no Kommo (leads/contacts)' }), { status: 422, headers: CORS });

    // 1. contratos assinados com asaas_customer_id + linkKommo -> mapa por lead
    let q = db.from('contratos').select('asaas_customer_id, dados').eq('status', 'assinado').not('asaas_customer_id', 'is', null);
    if (scopeCustomer) q = q.eq('asaas_customer_id', scopeCustomer);
    const { data: contratos, error: cErr } = await q;
    if (cErr) throw new Error(`contratos: ${cErr.message}`);

    const porLead = new Map(); // leadId -> { cliente, customers:Set, host }
    for (const c of contratos || []) {
      const contr = c.dados?.contratantes?.[0] || {};
      const leadId = extrairLeadId(contr.linkKommo);
      if (!leadId || !c.asaas_customer_id) continue;
      if (scopeLead && leadId !== scopeLead) continue;
      let e = porLead.get(leadId);
      if (!e) { e = { cliente: contr.nome || null, customers: new Set(), host: extrairHostKommo(contr.linkKommo) }; porLead.set(leadId, e); }
      e.customers.add(c.asaas_customer_id);
      if (!e.cliente && contr.nome) e.cliente = contr.nome;
    }

    // 2. carnes do espelho (escopado aos customers envolvidos)
    const allCustomers = [...new Set([...porLead.values()].flatMap(e => [...e.customers]))];
    const { data: carnesJson, error: rErr } = await db.rpc('asaas_carnes', {
      p_chave: RPC_SECRET, p_customer_ids: allCustomers.length ? allCustomers : null,
    });
    if (rErr) throw new Error(`asaas_carnes: ${rErr.message}`);
    const porCustomer = new Map();
    for (const r of carnesJson || []) {
      if (!porCustomer.has(r.customer_id)) porCustomer.set(r.customer_id, []);
      porCustomer.get(r.customer_id).push(r);
    }

    // 3. monta valor por lead: SO o(s) link(s); "Quitado" quando tudo pago.
    //    Se o campo for tipo "url" (so aceita 1 URL), 1 link por lead; multiplos ->
    //    1o + nota; "Quitado" nao cabe em url -> limpa o campo + nota.
    const isUrlField = (field.fieldType || '').toLowerCase() === 'url';
    const planos = [];
    for (const [leadId, e] of porLead) {
      const insts = [...e.customers].flatMap(cid => porCustomer.get(cid) || []);
      if (!insts.length) continue; // sem parcelamento no espelho -> ignora
      const links = [...new Set(insts.filter(i => i.abertas > 0 && i.carne).map(i => i.carne))];
      let valor, nota = null;
      if (links.length) {
        if (isUrlField && links.length > 1) { valor = links[0]; nota = `campo url: 1 de ${links.length} links`; }
        else valor = links.join('\n');
      } else if (isUrlField) { valor = ''; nota = 'quitado (campo url limpo)'; }
      else valor = 'Quitado';
      planos.push({ leadId, cliente: e.cliente, host: e.host, kommoUrl: KOMMO_LEAD_URL(leadId), valor, nota, parcelamentos: insts.length, abertos: links.length });
    }

    const outraConta = planos.filter(p => p.host && p.host !== KOMMO_HOST);
    const alvos = planos.filter(p => !p.host || p.host === KOMMO_HOST);

    // 4. le valores atuais e decide o que muda. REGRA DE IDEMPOTENCIA:
    //    - parcelamento aberto e campo JA tem conteudo -> MANTEM (nao sobrescreve o link).
    //    - aberto e campo vazio -> grava o link.
    //    - quitado -> grava o "desired" (campo url: limpa; campo texto: "Quitado").
    //    Escritas vao para a FILA (enqueue) e sao drenadas com throttle (sem burst/429).
    const resultados = [];
    const aEnfileirar = [];
    const decidir = (p, atual, entityKind, entityId) => {
      const aberto = p.abertos > 0;
      // (#26) so MANTEM o valor atual se ele for um LINK (carne). Se for "Quitado" (ou
      // qualquer nao-URL) e ha parcela aberta de novo, segue para gravar o link novo —
      // antes "Quitado" bloqueava a gravacao do carne seguinte.
      const atualEhLink = /^https?:\/\//i.test(String(atual || ''));
      if (aberto && atual && atualEhLink) { resultados.push({ ...p, acao: 'mantido', atual }); return; }
      if (atual === p.valor) { resultados.push({ ...p, acao: 'inalterado', atual }); return; }
      resultados.push({ ...p, acao: dryRun ? 'gravaria' : 'enfileirado', atual });
      if (!dryRun) aEnfileirar.push({
        kind: entityKind,
        payload: entityKind === 'contact_field'
          ? { contactId: String(entityId), fieldId: field.fieldId, value: p.valor }
          : { leadId: String(entityId), fieldId: field.fieldId, value: p.valor },
        dedupeKey: `${entityKind}:${entityId}:${field.fieldId}`,
      });
    };

    if (field.entity === 'leads') {
      const leadsAtuais = await getLeadsByIds(alvos.map(p => p.leadId)); // 1-2 GETs p/ todos
      const atualById = new Map(leadsAtuais.map(l => [String(l.id), extractFieldValue(l, field.fieldId) || '']));
      for (const p of alvos) {
        if (!atualById.has(String(p.leadId))) { resultados.push({ ...p, acao: 'erro', erro: 'lead inexistente no Kommo' }); continue; }
        decidir(p, atualById.get(String(p.leadId)), 'lead_field', p.leadId);
      }
    } else {
      for (const p of alvos) {
        try {
          const entityId = await mainContactOfLead(p.leadId);
          if (!entityId) { resultados.push({ ...p, acao: 'erro', erro: 'sem contato no lead' }); continue; }
          const ent = await getEntity('contacts', entityId);
          decidir(p, extractFieldValue(ent, field.fieldId) || '', 'contact_field', entityId);
        } catch (err) { resultados.push({ ...p, acao: 'erro', erro: err.message }); }
      }
    }

    // enfileira os writes e drena com throttle (sem burst). O drain processa a fila
    // INTEIRA (compartilhada) — ajuda a escoar tambem outras integracoes pendentes.
    let drain = null;
    if (!dryRun && aEnfileirar.length) {
      for (const j of aEnfileirar) await enqueueKommo(j.kind, j.payload, { source: 'asaas-link', dedupeKey: j.dedupeKey, priority: 5 });
      drain = await processQueue({ maxMs: 8000 });
    }

    const resumo = { enfileirado: 0, gravaria: 0, inalterado: 0, mantido: 0, erro: 0 };
    for (const r of resultados) resumo[r.acao] = (resumo[r.acao] || 0) + 1;

    if (!dryRun && (resumo.enfileirado || (drain && drain.failed))) {
      await logAdvbox('kommo', 'info', `Asaas->Kommo: ${resumo.enfileirado} enfileirados, drain ${drain?.done || 0} ok/${drain?.failed || 0} falha`, { resumo, drain }).catch(() => {});
    }

    return new Response(JSON.stringify({
      success: true, dryRun, isScheduled,
      campo: { entity: field.entity, field_id: field.fieldId, name: field.fieldName, type: field.fieldType, discovered: !!field.discovered },
      escopo: scopeCustomer ? { customerId: scopeCustomer } : scopeLead ? { leadId: scopeLead } : 'todos',
      resumo, drain,
      pulados_outra_conta: outraConta.map(p => ({ cliente: p.cliente, host: p.host })),
      leads: resultados.map(r => ({ cliente: r.cliente, leadId: r.leadId, kommoUrl: r.kommoUrl, valor: r.valor, acao: r.acao, ...(r.nota ? { nota: r.nota } : {}), ...(r.erro ? { erro: r.erro } : {}) })),
    }), { headers: CORS });
  } catch (err) {
    await logAdvbox('kommo', 'erro', `kommo-asaas-sync: ${err.message}`.slice(0, 300), {}).catch(() => {});
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: CORS });
  }
};

// Varredura completa 2x/dia as 07h/19h BRT (10:00/22:00 UTC) — ESCALONADO p/ fora
// do 06h30 onde rodam advbox-monitor + asaas-sync-boletos (evita bater no Kommo/Asaas
// junto). As escritas ainda passam pela fila, entao nao ha risco de 429 mesmo assim.
export const config = { schedule: '0 10,22 * * *' };
