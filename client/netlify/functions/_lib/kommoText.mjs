/**
 * Texto seguro p/ CAMPOS personalizados do Kommo (31/07/2026).
 *
 * O Kommo persiste campos custom em armazenamento que NAO aceita caracteres fora
 * do BMP (emoji de 4 bytes UTF-8, ex.: 😊 U+1F60A): o PATCH retorna 200, mas o
 * valor e TRUNCADO silenciosamente no primeiro emoji. Caso real (Leomara, lead
 * 12822852, 31/07): "Olá, Leomara! 😊 Seu contrato... {link}" persistiu como
 * "Olá, Leomara! " e o Salesbot enviou so a saudacao, sem o link de assinatura.
 * O log de eventos do proprio Kommo guarda a intencao completa com "?" no lugar
 * dos emojis — a limitacao e do campo, nao da API.
 *
 * Modulo PURO (sem imports/IO — testavel em vitest, padrao assinaturaWhatsapp.mjs).
 * Teste: src/utils/__tests__/kommoText.test.js
 */

// Equivalentes de 3 bytes (BMP) que o Kommo aceita — preservam o tom da mensagem.
const MAPA_BMP = {
  '😊': '☺️', '🙂': '☺️', '😀': '☺️', '😃': '☺️', '😄': '☺️', '😁': '☺️',
  '👉': '➡️', '👈': '⬅️',
  '🎉': '✨', '🎊': '✨',
  '📞': '☎️',
  '🖊️': '✍️', '🖋️': '✍️', '📝': '✍️',
};

// Astral + acessorios de sequencia (ZWJ antes, seletor de variacao depois),
// p/ nao deixar caractere invisivel orfao ao remover emoji composto.
const ASTRAL_SEQ = /\u200D?[\u{10000}-\u{10FFFF}][\uFE0E\uFE0F]?/gu;

/**
 * Sanitiza texto destinado a campo personalizado do Kommo: translitera os emojis
 * comuns p/ equivalente BMP e REMOVE o resto dos astrais. Texto sem astral volta
 * byte a byte identico (nao mexe em espacamento legitimo de links/PIX/copys).
 */
export function paraCampoKommo(texto) {
  if (texto == null) return null;
  const original = String(texto);
  let t = original;
  for (const [de, para] of Object.entries(MAPA_BMP)) t = t.replaceAll(de, para);
  t = t.replace(ASTRAL_SEQ, '');
  if (t === original) return original;
  // limpa o residuo da remocao: espaco dobrado no meio, espaco antes de \n, pontas
  return t.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
}

/**
 * Compara o valor ENVIADO ao Kommo com o valor LIDO de volta apos o PATCH
 * (verificacao anti-truncamento antes de rodar o Salesbot). Tolera apenas
 * CRLF vs LF e espacos nas pontas; campo limpo (null/'') se equivale.
 */
export function persistiuIgual(enviado, lido) {
  const n = (v) => String(v ?? '').replace(/\r\n/g, '\n').trim();
  return n(enviado) === n(lido);
}
