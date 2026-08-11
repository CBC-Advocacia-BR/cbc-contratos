/**
 * Le o payload do webhook add_message do Kommo e devolve UMA mensagem pronta
 * para o espelho (tabela sdr_mensagens). Modulo PURO: sem rede, sem banco.
 *
 * O Kommo manda form-urlencoded com chaves aninhadas:
 *   message[add][0][id] / [type] / [text] / [created_at] / [entity_id] / [contact_id]
 *   message[add][0][author][id] / [author][name] / [attachment][type]
 */

const TIPO_POR_ANEXO = {
  voice: 'audio', audio: 'audio', picture: 'imagem', file: 'documento', video: 'video',
};
const ROTULO = { audio: '[Áudio]', imagem: '[Imagem]', documento: '[Documento]', video: '[Vídeo]' };

/** @returns {{ok:boolean, msg?:object, motivo?:string}} */
export function parseMensagemKommo(contentType, raw) {
  if (!raw) return { ok: false, motivo: 'corpo vazio' };
  if ((contentType || '').includes('json')) return { ok: false, motivo: 'payload json nao suportado' };

  let p;
  try { p = new URLSearchParams(raw); } catch { return { ok: false, motivo: 'corpo ilegivel' }; }
  const g = (k) => p.get(`message[add][0]${k}`);

  const id = g('[id]');
  const tipoKommo = g('[type]');
  if (!id || !tipoKommo) return { ok: false, motivo: 'sem mensagem no payload' };

  const leadId = g('[entity_id]');
  if (!leadId) return { ok: false, motivo: 'mensagem sem lead' };

  const anexo = g('[attachment][type]');
  const tipo = anexo ? (TIPO_POR_ANEXO[anexo] || 'outro') : 'texto';
  const texto = (g('[text]') || '').trim() || ROTULO[tipo] || '';

  const seg = Number(g('[created_at]'));
  const criadoEm = Number.isFinite(seg) && seg > 0
    ? new Date(seg * 1000).toISOString()
    : new Date().toISOString();

  return {
    ok: true,
    msg: {
      kommo_msg_id: id,
      lead_id: String(leadId),
      contact_id: g('[contact_id]') ? String(g('[contact_id]')) : null,
      direcao: tipoKommo === 'incoming' ? 'in' : 'out',
      autor_id: Number(g('[author][id]')) || null,
      autor_nome: g('[author][name]') || null,
      tipo,
      texto,
      criado_em: criadoEm,
    },
  };
}
