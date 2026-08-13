/**
 * Assinatura dos links de confirmação do lembrete. Módulo PURO.
 *
 * POR QUE ASSINAR: o link vai num e-mail e aponta para um endereço público. Sem
 * assinatura, `?e=<event_id>&r=sim` seria adivinhável, e qualquer pessoa poderia
 * confirmar (ou pedir remarcação) em nome de outro cliente varrendo ids. Os ids do
 * Google Calendar não são secretos: aparecem em convites e em links de agenda.
 *
 * A assinatura é um HMAC do par (event_id, resposta) com o BOT_RPC_SECRET, que já
 * existe e nunca sai do servidor. Amarrar a RESPOSTA junto é o detalhe que importa:
 * sem isso, quem recebesse o link de "confirmo" poderia trocar `r=sim` por
 * `r=remarcar` e mudar o sentido do próprio clique.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Assinatura curta (20 hex) do par evento+resposta. */
export function assinar(eventId, resposta, segredo) {
  if (!segredo) throw new Error('BOT_RPC_SECRET ausente: nao da para assinar o link');
  return createHmac('sha256', segredo)
    .update(`${eventId}|${resposta}`)
    .digest('hex')
    .slice(0, 20);
}

/**
 * Confere a assinatura em tempo constante.
 *
 * A comparação com `===` vaza, pelo tempo de resposta, quantos caracteres batem,
 * o que permite descobrir a assinatura byte a byte. É o mesmo cuidado que o
 * `_lib/apiAuth.mjs` já toma nas chaves de API deste projeto.
 */
export function conferir(eventId, resposta, token, segredo) {
  try {
    const esperado = Buffer.from(assinar(eventId, resposta, segredo));
    const recebido = Buffer.from(String(token || ''));
    if (esperado.length !== recebido.length) return false;
    return timingSafeEqual(esperado, recebido);
  } catch {
    return false;
  }
}

/** URL completa do clique, pronta para o botão do e-mail. */
export function linkConfirmacao(base, eventId, resposta, segredo) {
  const t = assinar(eventId, resposta, segredo);
  return `${base}/.netlify/functions/videochamada-confirmar`
    + `?e=${encodeURIComponent(eventId)}&r=${resposta}&t=${t}`;
}
