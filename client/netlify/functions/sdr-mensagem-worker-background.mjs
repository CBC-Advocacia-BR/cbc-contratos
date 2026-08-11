/**
 * Grava no espelho (sdr_mensagens) cada mensagem que o Kommo avisa por webhook.
 * Function de FUNDO: o webhook responde ao Kommo em ~2s e este worker processa depois.
 *
 * O Kommo pode entregar VARIAS mensagens numa unica chamada (rajada) — por isso
 * parseMensagemKommo devolve `msgs` (array), nunca uma unica mensagem.
 *
 * Idempotente: sdr_mensagens.kommo_msg_id e unico, entao reentrega do mesmo evento
 * nao duplica. Nunca lanca: erro vira log no console do Monitor (origem 'sdr').
 */
import { parseMensagemKommo } from './_lib/kommoMensagem.mjs';
import { supa } from './_lib/supabaseClient.mjs';
import { logAdvbox } from './_lib/botDb.mjs';

export default async (req) => {
  let body = {};
  try { body = await req.json(); } catch { /* corpo invalido */ }

  const r = parseMensagemKommo(body.contentType, body.raw);
  if (!r.ok) {
    return new Response(JSON.stringify({ ok: true, ignorado: r.motivo }), { status: 200 });
  }

  const leads = [...new Set(r.msgs.map((m) => m.lead_id))];

  if (!supa) {
    await logAdvbox('sdr', 'erro', 'espelho sem supabase configurado', { qtd: r.msgs.length, leads });
    return new Response(JSON.stringify({ ok: false }), { status: 200 });
  }

  const { error } = await supa
    .from('sdr_mensagens')
    .upsert(r.msgs, { onConflict: 'kommo_msg_id', ignoreDuplicates: true });

  if (error) {
    await logAdvbox('sdr', 'erro', 'falha ao gravar mensagem no espelho', {
      qtd: r.msgs.length, leads, erro: error.message,
    });
    return new Response(JSON.stringify({ ok: false }), { status: 200 });
  }
  return new Response(JSON.stringify({ ok: true, qtd: r.msgs.length, leads }), { status: 200 });
};
