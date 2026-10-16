// (16/10/2026) Acesso SOMENTE LEITURA ao Google das vendedoras por conta de servico com
// delegacao em todo o dominio (domain-wide delegation), autorizada pelo Paulo no Admin
// Console. Usado para achar e ler a transcricao do Meet de cada videochamada de venda.
//
// Por que conta de servico, e nao o OAuth do Paulo (GOOGLE_OAUTH_* de googleAgenda.mjs):
// a transcricao e um Google Doc no Drive da VENDEDORA; o token do Paulo le a agenda dela,
// mas nao o Drive. A delegacao permite agir "como" a vendedora, com escopo so de leitura.
//
// Env: GOOGLE_SA_KEY_JSON = conteudo do JSON da chave (texto puro ou base64).
// Escopos que o Admin Console precisa autorizar para o ID do cliente da conta de servico:
//   https://www.googleapis.com/auth/calendar.readonly
//   https://www.googleapis.com/auth/drive.readonly
//
// ⚠️ Esta chave le o Drive de QUALQUER conta do dominio. Por isso o modulo so aceita
// impersonar e-mails da lista de vendedoras (googleAgenda.VENDEDORAS) — ver `exigirVendedora`.
import { createSign } from 'node:crypto';
import { VENDEDORAS } from './googleAgenda.mjs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CAL_URL = 'https://www.googleapis.com/calendar/v3';
const DRIVE_URL = 'https://www.googleapis.com/drive/v3';
export const ESCOPOS = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
];
const DOC_MIME = 'application/vnd.google-apps.document';

/** Le a chave da env. Aceita o JSON puro ou em base64 (mais facil de colar em painel). */
export function lerChave(bruto = process.env.GOOGLE_SA_KEY_JSON) {
  if (!bruto) return null;
  const txt = bruto.trim().startsWith('{') ? bruto : Buffer.from(bruto, 'base64').toString('utf8');
  const k = JSON.parse(txt);
  if (!k.client_email || !k.private_key) throw new Error('GOOGLE_SA_KEY_JSON sem client_email/private_key');
  return k;
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** JWT assinado (RS256) pedindo um token em nome de `sujeito`. Puro: testavel com chave gerada. */
export function montarJwt(chave, sujeito, agoraSeg = Math.floor(Date.now() / 1000)) {
  const cab = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = b64url(JSON.stringify({
    iss: chave.client_email,
    sub: sujeito,
    scope: ESCOPOS.join(' '),
    aud: chave.token_uri || TOKEN_URL,
    iat: agoraSeg,
    exp: agoraSeg + 3600,
  }));
  const assinatura = createSign('RSA-SHA256').update(`${cab}.${corpo}`).sign(chave.private_key);
  return `${cab}.${corpo}.${b64url(assinatura)}`;
}

export function exigirVendedora(email) {
  const e = String(email || '').toLowerCase();
  if (!VENDEDORAS.includes(e)) throw new Error(`impersonacao recusada: ${e || '(vazio)'} nao esta na lista de vendedoras`);
  return e;
}

const cacheTokens = new Map(); // email -> { token, expira }

/** Access token agindo como a vendedora (cache em memoria durante a execucao). */
export async function tokenComo(email, chave = lerChave()) {
  if (!chave) throw new Error('GOOGLE_SA_KEY_JSON nao configurada');
  const sujeito = exigirVendedora(email);
  const c = cacheTokens.get(sujeito);
  if (c && c.expira > Date.now() + 60e3) return c.token;
  const r = await fetch(chave.token_uri || TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: montarJwt(chave, sujeito) }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  // unauthorized_client aqui = a delegacao nao foi autorizada no Admin Console (ou faltou escopo)
  if (!j.access_token) throw new Error(`token Google como ${sujeito}: ${j.error || r.status} ${j.error_description || ''}`.trim());
  cacheTokens.set(sujeito, { token: j.access_token, expira: Date.now() + (j.expires_in || 3600) * 1000 });
  return j.access_token;
}

async function getJson(url, token) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${j.error?.message || ''}`.trim());
  return j;
}

/**
 * Entre os anexos do evento, escolhe a transcricao. Ordem: "Transcricao/Transcript";
 * depois "Anotacoes do Gemini" (resumo do Google, pior que a transcricao, mas melhor que nada).
 * Puro.
 */
export function escolherAnexo(anexos = []) {
  const docs = anexos.filter((a) => a && a.fileId && (!a.mimeType || a.mimeType === DOC_MIME));
  const transcricao = docs.find((a) => /transcri/i.test(a.title || ''));
  if (transcricao) return { fileId: transcricao.fileId, titulo: transcricao.title, tipo: 'transcricao' };
  const notas = docs.find((a) => /gemini|anota[cç][oõ]es|notes/i.test(a.title || ''));
  if (notas) return { fileId: notas.fileId, titulo: notas.title, tipo: 'anotacoes_gemini' };
  return null;
}

/** Busca no Drive da vendedora um Doc de transcricao criado logo apos o inicio da call. */
async function procurarNoDrive(token, inicioIso) {
  const ini = new Date(inicioIso);
  if (Number.isNaN(ini.getTime())) return null;
  const fim = new Date(ini.getTime() + 4 * 3600e3);
  const q = [
    `mimeType = '${DOC_MIME}'`,
    `createdTime >= '${ini.toISOString()}'`,
    `createdTime <= '${fim.toISOString()}'`,
    `(name contains 'Transcri' or name contains 'Transcript')`,
    'trashed = false',
  ].join(' and ');
  const u = new URL(`${DRIVE_URL}/files`);
  u.searchParams.set('q', q);
  u.searchParams.set('fields', 'files(id,name,createdTime)');
  u.searchParams.set('orderBy', 'createdTime');
  u.searchParams.set('pageSize', '5');
  u.searchParams.set('supportsAllDrives', 'true');
  u.searchParams.set('includeItemsFromAllDrives', 'true');
  const j = await getJson(u, token);
  const f = (j.files || [])[0];
  return f ? { fileId: f.id, titulo: f.name, tipo: 'transcricao' } : null;
}

/**
 * Acha a transcricao de um evento da agenda da vendedora.
 * 1) anexos do evento (o Meet anexa transcricao/anotacoes ao convite);
 * 2) busca no Drive pela janela de horario.
 * Retorna { fileId, titulo, tipo, origem } ou null (ainda nao gerada / transcricao desligada).
 */
export async function acharTranscricao({ vendedora, eventId, scheduledAt }) {
  const token = await tokenComo(vendedora);
  let ev = null;
  try {
    ev = await getJson(`${CAL_URL}/calendars/primary/events/${encodeURIComponent(eventId)}`, token);
  } catch (e) {
    if (!/^404/.test(e.message)) throw new Error(`agenda ${vendedora}: ${e.message}`);
  }
  const anexo = escolherAnexo(ev?.attachments);
  if (anexo) return { ...anexo, origem: 'anexo_evento' };
  const noDrive = await procurarNoDrive(token, ev?.start?.dateTime || scheduledAt);
  return noDrive ? { ...noDrive, origem: 'busca_drive' } : null;
}

/** Exporta o Google Doc como texto puro (agindo como a vendedora). */
export async function lerDocComoTexto(vendedora, fileId) {
  const token = await tokenComo(vendedora);
  const r = await fetch(`${DRIVE_URL}/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`export do doc ${fileId}: ${r.status}`);
  return r.text();
}
