/**
 * Envio de e-mail pela conta institucional@advocaciacbc.com, via API do Gmail.
 *
 * POR QUE GMAIL E NAO UM SERVICO DE DISPARO (decisao do Paulo, 12/08/2026): sai
 * do Gmail do escritorio, fica em "Enviados", e nao exige mexer no SPF do dominio,
 * que hoje sustenta o e-mail de todo mundo.
 *
 * ⚠️ RISCO CONHECIDO: o app OAuth deste projeto ja teve o refresh token morrer
 * sozinho (23/07/2026, invalid_grant) por estar em modo Testing no Google Cloud.
 * O app PRECISA estar publicado como "Interno" no Workspace. Por isso a credencial
 * entra no tokens-vigia-cron: token morto significa dossie nenhum enviado por
 * semanas, sem ninguem perceber.
 */
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ENVIO_URL = 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media';

// o client id/secret podem ser os mesmos do OAuth da agenda (mesmo app); o que
// muda e o refresh token, que precisa ser da conta institucional@
const CLIENT_ID = process.env.GMAIL_OAUTH_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_OAUTH_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GMAIL_OAUTH_REFRESH_TOKEN;

/** Renova o access token do Gmail a partir do refresh token da institucional@. */
export async function tokenGmail() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error('GMAIL_OAUTH_* nao configurado (falta o refresh token da institucional@)');
  }
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN, grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) {
    throw new Error(`falha ao renovar token do Gmail: ${JSON.stringify(j).slice(0, 200)}`);
  }
  return j.access_token;
}

/**
 * Um cabecalho MIME nao pode conter quebra de linha: o assunto vem de bot_config,
 * que e editavel, e um "\r\nBcc: ..." ali mandaria copia para terceiro.
 */
const umaLinhaSo = (s) => String(s).replace(/[\r\n]+/g, ' ').trim();

/** Assunto com acento precisa de RFC 2047, senao chega com caractere trocado. */
function assuntoCodificado(assunto) {
  const limpo = umaLinhaSo(assunto);
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(limpo)) return limpo;
  return `=?UTF-8?B?${Buffer.from(limpo, 'utf8').toString('base64')}?=`;
}

const base64Quebrado = (buf) => buf.toString('base64').replace(/(.{76})/g, '$1\r\n');

/**
 * Monta a mensagem MIME completa. PURO: sem rede, para poder ser testado.
 * Estrutura: multipart/mixed [ multipart/alternative [texto, html], pdf ]
 */
export function montarMime({ de, para, responderPara, assunto, html, texto, anexo }) {
  // fronteiras fixas, sem aleatoriedade, para o teste ser deterministico
  const fMix = 'cbc_mix_fronteira_0001';
  const fAlt = 'cbc_alt_fronteira_0001';
  const L = [];

  L.push(`From: ${umaLinhaSo(de)}`);
  L.push(`To: ${umaLinhaSo(para)}`);
  if (responderPara) L.push(`Reply-To: ${umaLinhaSo(responderPara)}`);
  L.push(`Subject: ${assuntoCodificado(assunto)}`);
  L.push('MIME-Version: 1.0');
  L.push(`Content-Type: multipart/mixed; boundary="${fMix}"`);
  L.push('');

  L.push(`--${fMix}`);
  L.push(`Content-Type: multipart/alternative; boundary="${fAlt}"`);
  L.push('');

  L.push(`--${fAlt}`);
  L.push('Content-Type: text/plain; charset="UTF-8"');
  L.push('Content-Transfer-Encoding: base64');
  L.push('');
  L.push(base64Quebrado(Buffer.from(texto, 'utf8')));

  L.push(`--${fAlt}`);
  L.push('Content-Type: text/html; charset="UTF-8"');
  L.push('Content-Transfer-Encoding: base64');
  L.push('');
  L.push(base64Quebrado(Buffer.from(html, 'utf8')));

  L.push(`--${fAlt}--`);
  L.push('');

  if (anexo) {
    L.push(`--${fMix}`);
    L.push('Content-Type: application/pdf');
    L.push('Content-Transfer-Encoding: base64');
    L.push(`Content-Disposition: attachment; filename="${umaLinhaSo(anexo.nome)}"`);
    L.push('');
    L.push(base64Quebrado(anexo.bytes));
  }

  L.push(`--${fMix}--`);
  return L.join('\r\n');
}

/**
 * Envia a mensagem. NUNCA lanca: devolve {ok:false, erro} para o chamador
 * registrar e tentar de novo na rodada seguinte, ate o teto de tentativas.
 * @returns {Promise<{ok: boolean, id?: string, erro?: string}>}
 */
export async function enviarPeloGmail({ de, para, responderPara, assunto, html, texto, anexo }) {
  try {
    const at = await tokenGmail();
    const mime = montarMime({ de, para, responderPara, assunto, html, texto, anexo });
    const r = await fetch(ENVIO_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'message/rfc822' },
      body: Buffer.from(mime, 'utf8'),
      signal: AbortSignal.timeout(30000),
    });
    const corpo = await r.text().catch(() => '');
    if (!r.ok) return { ok: false, erro: `Gmail HTTP ${r.status} ${corpo.slice(0, 200)}` };
    let id;
    try { id = JSON.parse(corpo).id; } catch { /* o id e so para o log */ }
    return { ok: true, id };
  } catch (e) {
    return { ok: false, erro: String(e?.message || e).slice(0, 200) };
  }
}
