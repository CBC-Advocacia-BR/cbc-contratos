// (auditoria #63) Validacao leve de shape para os pontos de entrada das functions.
//
// QUANDO usar: endpoints internos (chamados pelo front/painel) onde um body malformado
// deve ser recusado cedo com motivo claro, em vez de quebrar num ponto qualquer la na
// frente (as vezes engolido por um catch).
//
// QUANDO NAO usar: webhooks de PROVEDOR (ZapSign/Asaas/Kommo). Eles mandam pings e
// eventos parciais e devem ser TOLERANTES — responder 200 + ignorar o que nao reconhecem
// (o zapsign-webhook e o asaas-webhook ja fazem isso, validando so os campos criticos).
// Aplicar 400 estrito neles regrediria em pings legitimos do provedor.

export function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// Retorna { ok:true } ou { ok:false, missing:[...], motivo:'...' }.
// "Ausente" = undefined | null | '' (string vazia).
export function requireFields(obj, fields) {
  if (!isPlainObject(obj)) return { ok: false, missing: fields, motivo: 'body ausente ou nao e objeto' };
  const missing = fields.filter((f) => obj[f] === undefined || obj[f] === null || obj[f] === '');
  return missing.length
    ? { ok: false, missing, motivo: `campos obrigatorios ausentes: ${missing.join(', ')}` }
    : { ok: true };
}
