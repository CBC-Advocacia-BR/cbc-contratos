// (#225) Webhook ZapSign — recebe eventos em tempo real e atualiza status
// Substitui (em parte) o polling de 2min do App.jsx
//
// Configuracao no painel ZapSign:
//   Settings -> Webhooks -> URL: https://contratos-cbc.netlify.app/.netlify/functions/zapsign-webhook
//   Eventos: doc_signed, doc_complete, doc_refused, doc_deleted, doc_expired
//
// Seguranca: validamos via shared secret no header X-ZapSign-Secret (env ZAPSIGN_WEBHOOK_SECRET).
// Se o secret nao estiver configurado, o handler ainda funciona mas ignora chamadas suspeitas.

import { createClient } from '@supabase/supabase-js';

const SUPA_URL  = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPA_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ZAP_TOKEN = process.env.ZAPSIGN_TOKEN;
const WEBHOOK_SECRET = process.env.ZAPSIGN_WEBHOOK_SECRET || '';

const ZAP_API = 'https://api.zapsign.com.br/api/v1';

// (auditoria #21) Client Supabase em ESCOPO DE MODULO — reutilizado entre invocacoes
// quentes do mesmo container (menos cold start). null-safe: se faltar env, o handler
// retorna 500 (checagem !SUPA_URL/!SUPA_KEY) antes de tocar em `sb`.
const sb = (SUPA_URL && SUPA_KEY)
  ? createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } })
  : null;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function fetchDocFromZapSign(docToken) {
  if (!ZAP_TOKEN || !docToken) return null;
  try {
    const r = await fetch(`${ZAP_API}/docs/${docToken}/`, {
      headers: { 'Authorization': `Bearer ${ZAP_TOKEN}` },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (err) {
    console.error('[zapsign-webhook] fetchDoc', err);
    return null;
  }
}

export default async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405);

  // (#L14) Validacao de secret. Quando configurado, exige o header correto (fail-closed).
  // Quando NAO configurado, o webhook fica aberto — mas o forjamento e inocuo: abaixo o
  // handler RE-BUSCA o status real na API ZapSign (ground truth) e so age em docTokens que
  // ja existem no nosso banco, entao nao da p/ forjar uma assinatura. Mesmo assim avisamos
  // p/ a equipe configurar o secret (defesa em profundidade) — sem derrubar o webhook real.
  if (WEBHOOK_SECRET) {
    const provided = req.headers.get('x-zapsign-secret') || req.headers.get('X-ZapSign-Secret');
    if (provided !== WEBHOOK_SECRET) {
      return jsonResponse({ error: 'invalid secret' }, 401);
    }
  } else {
    console.warn('[zapsign-webhook] AVISO SEGURANCA: ZAPSIGN_WEBHOOK_SECRET nao configurado — webhook sem autenticacao de header (mitigado pela re-verificacao na API ZapSign). Configure o secret no Netlify E no painel ZapSign p/ fechar.');
  }

  if (!SUPA_URL || !SUPA_KEY) {
    return jsonResponse({ error: 'missing supabase env' }, 500);
  }

  let body;
  try { body = await req.json(); }
  catch { return jsonResponse({ error: 'invalid json' }, 400); }

  const event = body.event_type || body.event || '';
  const docToken = body.token || body.doc_token || body.open_id;

  if (!docToken) {
    return jsonResponse({ error: 'missing doc token' }, 400);
  }

  // (auditoria #21) usa o client de escopo de modulo (criado no topo, reutilizado).

  // Localiza o contrato pelo doc token
  const { data: contract, error: lookupErr } = await sb
    .from('contratos')
    .select('id, status, zapsign_links, nome_contratante1, resort, tipo_acao, created_by, updated_by')
    .eq('zapsign_doc_token', docToken)
    .maybeSingle();

  if (lookupErr || !contract) {
    // Pode ser doc nao gerenciado por nos — retorna 200 para nao retentar
    console.warn('[zapsign-webhook] doc nao encontrado', docToken, lookupErr);
    return jsonResponse({ ok: true, ignored: true, reason: 'doc not in our DB' });
  }

  // Re-busca ground truth da API ZapSign (mais seguro que confiar no payload)
  const doc = await fetchDocFromZapSign(docToken);
  if (!doc) {
    return jsonResponse({ error: 'failed to fetch doc from zapsign' }, 502);
  }

  const signers = doc.signers || [];
  const updatedLinks = signers.map(s => ({
    name: s.name,
    email: s.email,
    token: s.token,
    sign_url: s.sign_url || s.signing_link,
    status: s.status,
    signed_at: s.signed_at,
    times_viewed: s.times_viewed || 0,
    first_opened_at: s.first_opened_at || null,
    last_view_at: s.last_view_at || null,
  }));

  const allSigned = signers.length > 0 && signers.every(s => s.status === 'signed');
  const anyRefused = signers.some(s => s.status === 'refused');

  let newStatus = contract.status;
  if (allSigned && contract.status === 'enviado_zapsign') {
    newStatus = 'assinado';
  } else if (anyRefused && contract.status === 'enviado_zapsign') {
    // (varredura 15/06) so cancela quem ainda estava pendente. Antes um evento
    // doc_refused tardio/fora de ordem podia reverter um contrato JA assinado
    // para 'cancelado' (sumia das estatisticas).
    newStatus = 'cancelado';
  }

  const update = {
    zapsign_links: updatedLinks,
    updated_at: new Date().toISOString(),
  };
  if (newStatus !== contract.status) update.status = newStatus;
  // (bug-4) grava a data REAL de assinatura quando o contrato vira 'assinado'.
  // Antes signed_at ficava vazio (so o import manual preenchia) e os relatorios de
  // prazo/producao/comissao usavam aproximacao. Usa o ultimo signatario que assinou.
  if (newStatus === 'assinado' && contract.status !== 'assinado') {
    const datasAssinatura = signers.map(s => s.signed_at).filter(Boolean).sort();
    update.signed_at = datasAssinatura.length ? datasAssinatura[datasAssinatura.length - 1] : new Date().toISOString();
  }

  // (varredura 15/06) lock otimista (compare-and-swap) no status — igual ao polling
  // e ao sync manual. Sem isto, um webhook tardio podia sobrescrever zapsign_links/
  // status depois que a linha ja tinha avancado (corrida com poll/sync).
  const { error: updErr } = await sb
    .from('contratos')
    .update(update)
    .eq('id', contract.id)
    .eq('status', contract.status);

  if (updErr) {
    console.error('[zapsign-webhook] update error', updErr);
    return jsonResponse({ error: updErr.message }, 500);
  }

  return jsonResponse({
    ok: true,
    event,
    contract_id: contract.id,
    status_changed: newStatus !== contract.status,
    new_status: newStatus,
    signers_count: signers.length,
    all_signed: allSigned,
  });
};
