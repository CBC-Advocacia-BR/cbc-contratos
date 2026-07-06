/**
 * Logica PURA do disparo de links de assinatura via Kommo/WhatsApp (02/07/2026).
 * Sem imports/IO de proposito (testavel em vitest, padrao advboxMaps.mjs).
 * Spec: docs/superpowers/specs/2026-07-02-assinatura-whatsapp-kommo-design.md
 *
 * Regras aprovadas pelo Paulo:
 *  - contratantes no MESMO lead recebem UMA mensagem com todos os links (nunca duplicar);
 *  - janela de 24h da Meta com margem de seguranca (fora da janela => nao envia);
 *  - sem re-tentativa automatica (decisao vive no caller; aqui so a matematica da janela).
 */

const norm = (s) => String(s || '').trim().toLowerCase();

/** Extrai o id do lead de .../leads/detail/{id} (ou digitos puros). Copia pura do kommo.mjs. */
export function extrairLeadIdAssinatura(input) {
  if (!input) return null;
  const s = String(input);
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/\/leads\/detail\/(\d+)/);
  return m ? m[1] : null;
}

/** Primeiro nome capitalizado ('MARIA APARECIDA' -> 'Maria'); fallback 'Cliente'. */
export function primeiroNome(nome) {
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || '';
  if (!primeiro) return 'Cliente';
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
}

/**
 * Pareia cada signer do ZapSign com um contratante do formulario.
 * Prioridade: e-mail (PJ assina com o e-mail da EMPRESA — decisao 25/06) -> nome -> indice.
 * Retorna [{ signer, link, contratante|null, leadId|null }] na ordem dos signers.
 */
export function parearSigners(signers, contratantes) {
  const cs = Array.isArray(contratantes) ? contratantes : [];
  const usados = new Set();
  const emailDo = (c) => norm(c?.tipo === 'pj' ? (c.emailEmpresa || c.email) : c?.email);

  return (Array.isArray(signers) ? signers : []).map((s, idx) => {
    let c = cs.find((cand, i) => !usados.has(i) && emailDo(cand) && emailDo(cand) === norm(s.email) && usados.add(i));
    if (!c) c = cs.find((cand, i) => !usados.has(i) && norm(cand?.nome) && norm(cand.nome) === norm(s.name) && usados.add(i));
    if (!c && cs[idx] && !usados.has(idx)) { c = cs[idx]; usados.add(idx); }
    return {
      signer: s,
      link: s.sign_url || s.signUrl || '',
      contratante: c || null,
      leadId: extrairLeadIdAssinatura(c?.linkKommo),
    };
  });
}

/**
 * Agrupa os pares por lead do Kommo. MESMO lead => um grupo so (uma mensagem com
 * todos os links, sem duplicar). Sem leadId valido ou sem link => vai para `invalidos`.
 */
export function agruparPorLead(pares) {
  const grupos = [];
  const porLead = new Map();
  const invalidos = [];
  for (const p of (pares || [])) {
    const nome = p.contratante?.nome || p.signer?.name || 'Contratante';
    if (!p.leadId || !p.link) { invalidos.push(nome); continue; }
    let g = porLead.get(p.leadId);
    if (!g) { g = { leadId: p.leadId, itens: [] }; porLead.set(p.leadId, g); grupos.push(g); }
    if (!g.itens.some((i) => i.link === p.link)) g.itens.push({ nome, link: p.link });
  }
  return { grupos, invalidos };
}

/** Monta a mensagem do grupo: 1 item usa msg_1 ({nome}/{link}); 2+ usa msg_2 ({links}). */
export function montarMensagem(itens, cfg = {}) {
  const lista = Array.isArray(itens) ? itens : [];
  if (!lista.length) return '';
  if (lista.length === 1) {
    return String(cfg.msg_1 || '{link}')
      .replaceAll('{nome}', primeiroNome(lista[0].nome))
      .replaceAll('{link}', lista[0].link);
  }
  const linhas = lista.map((i) => `✍️ *${primeiroNome(i.nome)}*: ${i.link}`).join('\n');
  return String(cfg.msg_2 || '{links}').replaceAll('{links}', linhas);
}

/**
 * Janela de 24h da Meta com margem de seguranca (padrao 60 min => 23h uteis).
 * `lastMsg` aceita ISO string ou epoch (segundos ou ms — events do Kommo usam segundos).
 * Sem mensagem recebida do cliente => janela FECHADA (nunca envia no escuro).
 */
export function janelaAberta(lastMsg, nowIso, margemMin = 60) {
  if (lastMsg == null || lastMsg === '') return { aberta: false, horas: null };
  let ts;
  if (typeof lastMsg === 'number' && Number.isFinite(lastMsg)) {
    ts = lastMsg < 1e12 ? lastMsg * 1000 : lastMsg; // epoch s -> ms
  } else {
    ts = Date.parse(lastMsg);
  }
  if (!Number.isFinite(ts)) return { aberta: false, horas: null };
  const agora = Date.parse(nowIso);
  const decorridoMs = agora - ts;
  if (!Number.isFinite(decorridoMs) || decorridoMs < 0) return { aberta: false, horas: null };
  const limiteMs = (24 * 60 - Number(margemMin || 0)) * 60000;
  return { aberta: decorridoMs < limiteMs, horas: Math.round((decorridoMs / 3600000) * 10) / 10 };
}
