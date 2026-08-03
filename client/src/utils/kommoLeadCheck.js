/**
 * Confere no Kommo se o lead do "Link Kommo" existe (03/08/2026).
 *
 * Motivo: o link e digitado a mao e CONGELA no contrato. A auditoria de 02/08 achou 37
 * leads mortos / 42 contratos (quase todos assinados) cujos clientes pararam de receber
 * nota de andamento e cobranca — alguns ha 44 dias. Conferir na hora de colar custa uma
 * chamada e resolve na origem.
 *
 * REGRA DE OURO: em qualquer duvida o veredito e 'desconhecido', que NAO bloqueia nada.
 * Kommo fora do ar, sessao expirada ou rede ruim jamais podem impedir uma assinatura.
 */
import { supabase } from '../lib/supabase';

const TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // link -> { at, res }

const DESCONHECIDO = (motivo) => ({ veredito: 'desconhecido', motivo });

/**
 * @returns {Promise<{veredito:'existe'|'nao_existe'|'invalido'|'desconhecido', motivo?:string, leadId?:string, nome?:string}>}
 */
export async function checarLinkKommo(link) {
  const key = String(link || '').trim();
  if (!key) return { veredito: 'invalido', motivo: 'Link Kommo nao preenchido' };

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.res;

  let res;
  try {
    let token = null;
    try {
      const { data: sess } = await supabase.auth.getSession();
      token = sess?.session?.access_token || null;
    } catch { /* trata abaixo */ }
    // Sem sessao nao da para conferir — mas isso e problema de sessao, nao do link:
    // nunca reprovar o link por causa disso.
    if (!token) return DESCONHECIDO('Nao foi possivel conferir agora (sessao expirada).');

    const r = await fetch('/.netlify/functions/resolve-kommo-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ link: key, apenasExistencia: true }),
      signal: AbortSignal.timeout(12000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.veredito) return DESCONHECIDO('Nao foi possivel conferir agora.');
    res = { veredito: j.veredito, motivo: j.motivo, leadId: j.leadId, nome: j.nome };
  } catch {
    res = DESCONHECIDO('Nao foi possivel conferir agora (sem conexao).');
  }

  // 'desconhecido' NAO entra no cache: e um estado passageiro e a proxima tentativa
  // (outro blur, ou a abertura do checklist) precisa poder acertar.
  if (res.veredito !== 'desconhecido') cache.set(key, { at: Date.now(), res });
  return res;
}
