// (#225) Webhook ZapSign — recebe eventos em tempo real e atualiza status
// Substitui (em parte) o polling de 2min do App.jsx
//
// Configuracao no painel ZapSign:
//   Settings -> Webhooks -> URL: https://contratos-cbc.netlify.app/.netlify/functions/zapsign-webhook
//   Eventos: doc_signed, doc_complete, doc_refused, doc_deleted, doc_expired
//
// Seguranca: validamos via shared secret no header X-ZapSign-Secret (env ZAPSIGN_WEBHOOK_SECRET).
// Se o secret nao estiver configurado, o handler ainda funciona mas ignora chamadas suspeitas.

// (auditoria 01/08/2026 — item 86) ESTE WEBHOOK NUNCA FUNCIONOU.
// Ele criava o client exigindo `SUPABASE_URL` (ou `VITE_SUPABASE_URL`) **e**
// `SUPABASE_SERVICE_ROLE_KEY`. 🔎 CORRECAO 02/08/2026 (conferido no painel do Netlify):
// a SERVICE ROLE **existe**; o que NAO existe e a URL — nao ha `SUPABASE_URL` nem
// `VITE_SUPABASE_URL` cadastrada. Sem a URL o client saia null e TODO evento de
// assinatura virava 500, desde sempre: a 'atualizacao em tempo real' nunca existiu.
// Passa a usar o `db` do _lib/botDb.mjs, que tem a URL como fallback embutido.
import { db as sb, heartbeat, logAdvbox } from './_lib/botDb.mjs';
import { comCaptura } from './_lib/comCaptura.mjs';
// (item 204) fonte unica da leitura dos signatarios do ZapSign
import { lerSignatarios } from './_lib/zapsignSigners.mjs';

const ZAP_TOKEN = process.env.ZAPSIGN_TOKEN;
const WEBHOOK_SECRET = process.env.ZAPSIGN_WEBHOOK_SECRET || '';

const ZAP_API = 'https://api.zapsign.com.br/api/v1';

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

// (auditoria 01/08 — item 155) `comCaptura` leva qualquer erro NAO TRATADO desta
// function para o console do Monitor (advbox_api_log), com metodo/caminho/pilha.
// Antes, um erro que escapasse dos try/catch internos virava um console.error no
// painel da Netlify — retencao curta — e sumia. Aqui e onde mora o dinheiro.
export default comCaptura('zapsign-webhook', async (req) => {
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

  // (item 149) Registra que o webhook FOI CHAMADO. Sem isto, "o ZapSign parou de avisar"
  // (URL trocada, segredo alterado, integracao desligada no painel) e indistinguivel de
  // "ninguem assinou hoje" — os dois casos sao silencio absoluto.
  heartbeat('zapsign-webhook', true, `evento recebido`).catch(() => {});

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
    // (auditoria 01/08 — item 110) Documento APAGADO ou EXPIRADO no ZapSign nao pode
    // virar 502 eterno: o re-fetch sempre falha (o doc nao existe mais), o contrato fica
    // preso em "aguardando assinatura" para sempre e o ZapSign pode desativar o webhook
    // por excesso de erro. Nesses eventos, encerramos o contrato aqui mesmo.
    if (event === 'doc_deleted' || event === 'doc_expired') {
      await sb.from('contratos').update({
        status: 'cancelado',
        updated_at: new Date().toISOString(),
      }).eq('id', contract.id).eq('status', 'enviado_zapsign'); // so se ainda estiver pendente
      await logAdvbox('zapsign', 'aviso',
        `Documento ${event === 'doc_expired' ? 'expirou' : 'foi apagado'} no ZapSign — contrato marcado como cancelado`,
        { contrato_id: contract.id, docToken, event });
      return jsonResponse({ ok: true, event, contrato: contract.id, acao: 'cancelado' });
    }
    return jsonResponse({ error: 'failed to fetch doc from zapsign' }, 502);
  }

  // (auditoria 01/08/2026 — item 204) A leitura dos signatarios saiu daqui para
  // `_lib/zapsignSigners.mjs`: era a TERCEIRA copia da mesma conta (as outras no polling
  // do App.jsx e no botao do ContratosTab), e as tres decidem se o contrato virou
  // "assinado" e qual a data real. Com copias, correcao feita numa nunca chegava nas
  // outras — o mesmo padrao que produziu o bug do mapa do ADVBOX.
  const { links: updatedLinks, todosAssinaram: allSigned, algumRecusou: anyRefused, assinadoEm, total: signersCount } = lerSignatarios(doc.signers);

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
    update.signed_at = assinadoEm;
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
    signers_count: signersCount,
    all_signed: allSigned,
  });
}, { origem: 'zapsign' });
