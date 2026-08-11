/**
 * Le o payload do webhook add_message do Kommo e devolve TODAS as mensagens
 * prontas para o espelho (tabela sdr_mensagens). Modulo PURO: sem rede, sem banco.
 *
 * O Kommo manda form-urlencoded com chaves aninhadas, e PODE mandar varias
 * mensagens numa unica chamada quando elas chegam em rajada:
 *   message[add][0][id] / [type] / [text] / [created_at] / [entity_id] / [contact_id]
 *   message[add][0][author][id] / [author][name] / [attachment][type]
 *   message[add][1][id] / ... (indice cresce por mensagem, sem teto fixo)
 */

const TIPO_POR_ANEXO = {
  voice: 'audio', audio: 'audio', picture: 'imagem', file: 'documento', video: 'video',
};
const ROTULO = { audio: '[Áudio]', imagem: '[Imagem]', documento: '[Documento]', video: '[Vídeo]' };

const RE_INDICE = /^message\[add\]\[(\d+)\]\[/;

/** @returns {{ok:boolean, msgs:object[], motivo?:string}} */
export function parseMensagemKommo(contentType, raw) {
  if (!raw) return { ok: false, msgs: [], motivo: 'corpo vazio' };
  if ((contentType || '').includes('json')) return { ok: false, msgs: [], motivo: 'payload json nao suportado' };

  let p;
  try { p = new URLSearchParams(raw); } catch { return { ok: false, msgs: [], motivo: 'corpo ilegivel' }; }

  // descobre quais indices de mensagem realmente vieram no corpo (sem teto arbitrario)
  const indices = new Set();
  for (const chave of p.keys()) {
    const m = chave.match(RE_INDICE);
    if (m) indices.add(Number(m[1]));
  }
  const indicesOrdenados = [...indices].sort((a, b) => a - b);
  if (indicesOrdenados.length === 0) return { ok: false, msgs: [], motivo: 'sem mensagem no payload' };

  const msgs = [];
  let algumaTinhaIdETipo = false;

  for (const i of indicesOrdenados) {
    const g = (k) => p.get(`message[add][${i}]${k}`);

    const id = g('[id]');
    const tipoKommo = g('[type]');
    if (!id || !tipoKommo) continue;
    algumaTinhaIdETipo = true;

    const leadId = g('[entity_id]');
    if (!leadId) continue;

    const anexo = g('[attachment][type]');
    const tipo = anexo ? (TIPO_POR_ANEXO[anexo] || 'outro') : 'texto';
    const texto = (g('[text]') || '').trim() || ROTULO[tipo] || '';

    const seg = Number(g('[created_at]'));
    const criadoEm = Number.isFinite(seg) && seg > 0
      ? new Date(seg * 1000).toISOString()
      : new Date().toISOString();

    // autor[id] pode ser "0" (contato) no Kommo, que e um valor real, nao ausencia
    const autorIdRaw = g('[author][id]');
    const autorIdNum = autorIdRaw !== null && autorIdRaw !== '' ? Number(autorIdRaw) : NaN;

    msgs.push({
      kommo_msg_id: id,
      lead_id: String(leadId),
      contact_id: g('[contact_id]') ? String(g('[contact_id]')) : null,
      direcao: tipoKommo === 'incoming' ? 'in' : 'out',
      autor_id: Number.isFinite(autorIdNum) ? autorIdNum : null,
      autor_nome: g('[author][name]') || null,
      tipo,
      texto,
      criado_em: criadoEm,
    });
  }

  if (msgs.length === 0) {
    return { ok: false, msgs: [], motivo: algumaTinhaIdETipo ? 'mensagem sem lead' : 'sem mensagem no payload' };
  }

  return { ok: true, msgs };
}
