// Utilitarios de telefone (puros, testaveis).

/**
 * Normaliza um telefone BR para o formato aceito pelo wa.me (so digitos, com DDI 55).
 * - Remove tudo que nao for digito.
 * - Se ja vier com DDI 55 (>= 12 digitos), mantem.
 * - Caso contrario, prefixa 55 (numero local com DDD: 10 ou 11 digitos).
 * Retorna '' quando nao ha digitos suficientes.
 */
export function waNumber(tel) {
  const d = String(tel || '').replace(/\D/g, '');
  if (d.length < 10) return '';
  return d.startsWith('55') && d.length >= 12 ? d : '55' + d;
}

/** Link direto para abrir a conversa no WhatsApp (vazio se sem numero valido). */
export function waLink(tel) {
  const n = waNumber(tel);
  return n ? `https://wa.me/${n}` : '';
}
