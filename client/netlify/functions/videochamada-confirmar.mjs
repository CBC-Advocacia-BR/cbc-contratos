/**
 * Endereço PÚBLICO onde o cliente cai ao clicar no lembrete: "confirmo que estarei"
 * ou "preciso remarcar".
 *
 * Por que público: é um clique dentro de um e-mail. Não há sessão, não há login, e
 * pedir qualquer coisa a mais mataria a ideia, que é ser um clique só.
 *
 * O que impede abuso: o link é ASSINADO (_lib/confirmacaoToken.mjs) sobre o par
 * evento+resposta. Sem a assinatura correta não se registra nada, então ninguém
 * confirma presença em nome de outro cliente varrendo ids de agenda, que não são
 * secretos.
 *
 * O clique só vale para chamada de hoje ou de amanhã (a RPC recusa mais antigo).
 */
import { db, logAdvbox } from './_lib/botDb.mjs';
import { conferir } from './_lib/confirmacaoToken.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const WHATS = 'https://wa.me/5519988051878?text='
  + encodeURIComponent('Olá! Preciso remarcar a minha videochamada com o escritório.');

const pagina = (titulo, corpo, cor) => `<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title>
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;
            margin:12vh auto;padding:0 24px;text-align:center;color:#1f2937">
  <div style="font-size:56px;line-height:1;color:${cor}">${cor === '#15803d' ? '&#10003;' : '&#9888;'}</div>
  <h1 style="font-size:22px;font-weight:600;margin:20px 0 10px">${titulo}</h1>
  <p style="font-size:16px;line-height:1.6;color:#4b5563;margin:0">${corpo}</p>
  <p style="font-size:13px;color:#9ca3af;margin-top:36px">
    Conforto, Bergonsi &amp; Cavalari Advogados<br>OAB/SP 55.227</p>
</div>`;

const html = (corpo, status = 200) => new Response(corpo, {
  status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
});

export default async (req) => {
  const url = new URL(req.url);
  const eventId = url.searchParams.get('e') || '';
  const resposta = url.searchParams.get('r') || '';
  const token = url.searchParams.get('t') || '';

  if (!conferir(eventId, resposta, token, RPC_SECRET)) {
    return html(pagina('Link inválido ou expirado',
      'Se você quer confirmar ou remarcar a sua videochamada, fale com a gente pelo WhatsApp '
      + `<a href="${WHATS}" style="color:#1B3A5C">(19) 98805-1878</a>.`, '#b45309'), 400);
  }

  let linha = null;
  try {
    const { data, error } = await db.rpc('confirmar_presenca', {
      p_chave: RPC_SECRET, p_event_id: eventId, p_resposta: resposta,
    });
    if (error) throw new Error(error.message);
    linha = Array.isArray(data) ? data[0] : data;
  } catch (e) {
    await logAdvbox('dossie', 'erro',
      `confirmacao falhou (${eventId}/${resposta}): ${e.message}`.slice(0, 300),
      { event_id: eventId }).catch(() => {});
    // O cliente nao tem culpa de erro nosso: manda ele para o WhatsApp, que resolve.
    return html(pagina('Não consegui registrar agora',
      `Mas está tudo bem: fale com a gente pelo WhatsApp <a href="${WHATS}" `
      + 'style="color:#1B3A5C">(19) 98805-1878</a> que a gente resolve na hora.', '#b45309'), 200);
  }

  if (!linha) {
    return html(pagina('Essa videochamada já passou',
      `Se quiser marcar uma nova conversa, fale com a gente pelo WhatsApp <a href="${WHATS}" `
      + 'style="color:#1B3A5C">(19) 98805-1878</a>.', '#b45309'), 200);
  }

  await logAdvbox('dossie', 'info', `confirmacao do cliente: ${resposta} (${eventId})`,
    { event_id: eventId, resposta }).catch(() => {});

  if (resposta === 'remarcar') {
    // registra e joga direto na conversa: o objetivo aqui e a remarcacao
    // acontecer, nao o cliente ler uma pagina
    return new Response(null, { status: 302, headers: { Location: WHATS, 'Cache-Control': 'no-store' } });
  }

  return html(pagina('Presença confirmada',
    'Obrigado! Nos vemos no horário combinado. O link da videochamada está no convite '
    + 'da sua agenda e no e-mail de lembrete.', '#15803d'));
};
