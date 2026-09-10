/**
 * (10/09/2026) Classifica a resposta do POST /api/v1/docs/{token}/resend-notifications-bulk/.
 *
 * PROBLEMA: o 429 `cooldown_period` era contado como FALHA. Foram 417 "falhas" entre 04/08
 * e 09/09, o heartbeat ficava vermelho quase toda rodada das 16h, e nenhuma delas era
 * lembrete perdido: e o ZapSign recusando reenviar para o mesmo documento pouco tempo
 * depois do ultimo reenvio.
 *
 * O QUE SE SABE DO COOLDOWN (medido na base, o ZapSign NAO publica a duracao; a doc so diz
 * que a mensagem "inclui tempo restante"):
 *  - documento recente aceita 11h e 16h nos primeiros ~5-6 dias (~10-12 reenvios);
 *  - depois disso o 16h (5h apos o 11h) volta 429, e o 11h do dia seguinte (19h depois)
 *    sempre passa. Ou seja, o cooldown cresce com o uso e fica entre 5h e 19h;
 *  - vale igual para documento com e sem lembrete nativo (202 x 202 nas falhas das 16h).
 *
 * ⚠️ Antes desta lib o texto do erro era cortado em 160 caracteres, que e exatamente onde
 * termina "...notificacoes em massa". O tempo restante que o ZapSign acrescenta se perdia
 * em todas as 417. Agora a `message` e guardada inteira (ate 300), para medir o cooldown.
 */

/**
 * @param {number} status  HTTP status do ZapSign
 * @param {string} texto   corpo da resposta, cru
 * @returns {{tipo:'enviado'} | {tipo:'cooldown', mensagem:string} | {tipo:'falha', erro:string}}
 */
export function classificarReenvio(status, texto = '') {
  const cru = String(texto ?? '');
  if (status >= 200 && status < 300) return { tipo: 'enviado' };

  let corpo = null;
  try { corpo = JSON.parse(cru); } catch { /* 502 do ZapSign vem em HTML */ }

  // So o cooldown POR DOCUMENTO e esperado. Um 429 sem esse codigo e limite de conta
  // (docs.zapsign.com.br/politicas-de-rate-limit) e continua sendo falha de verdade.
  if (status === 429 && corpo?.error_code === 'cooldown_period') {
    return { tipo: 'cooldown', mensagem: String(corpo.message ?? '').slice(0, 300) };
  }
  return { tipo: 'falha', erro: `ZapSign ${status}: ${cru.slice(0, 200)}` };
}
