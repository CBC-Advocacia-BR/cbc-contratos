/**
 * Push do PWA do portal: registra/remove a assinatura do navegador do cliente.
 * POST { t, acao: 'salvar'|'remover', sub: PushSubscription }
 * O envio acontece no monitor (advbox-monitor-worker) quando há novidade.
 *
 * (portal-19) Modo interno "enviar para um token": a equipe (painel, com x-bot-key)
 * dispara um push pontual para o cliente dono do token — reusa o mesmo web-push
 * (VAPID) do advbox-monitor-worker. POST { acao:'enviar', t, titulo?, corpo?, url? }.
 */
import { db } from './_lib/botDb.mjs';

const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, x-bot-key' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: H });

// (portal-19) envia um push para TODAS as assinaturas de um token (mesmo padrao do monitor).
// best-effort: nunca lanca; devolve quantos foram enviados. Limpa subs mortas (404/410).
async function enviarParaToken(token, { titulo, corpo, url, tag } = {}) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return { enviados: 0, motivo: 'vapid' };
  let enviados = 0;
  try {
    const { data: subs } = await db.from('portal_push_subs').select('endpoint, sub').eq('token', token);
    if (!subs?.length) return { enviados: 0, motivo: 'sem_sub' };
    const webpush = (await import('web-push')).default;
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:paulo@advocaciacbc.com',
      process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    const payload = JSON.stringify({
      titulo: titulo || 'Novidade no seu caso',
      corpo: corpo || 'Toque para ver no portal.',
      url: url || `/portal?t=${token}`,
      tag: tag || `cbc-resposta-${new Date().toISOString().slice(0, 10)}`,
    });
    for (const s of subs) {
      try { await webpush.sendNotification(s.sub, payload); enviados++; }
      catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          try { await db.from('portal_push_subs').delete().eq('endpoint', s.endpoint); } catch { /* ignora */ }
        }
      }
    }
  } catch (e) { return { enviados, erro: String(e?.message || e).slice(0, 120) }; }
  return { enviados };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: H });
  if (req.method !== 'POST') return json({ ok: false }, 405);

  let body = {};
  try { body = await req.json(); } catch { return json({ ok: false, erro: 'json' }, 400); }
  const token = String(body.t || '').trim();
  if (!token || token.length < 16) return json({ ok: false, erro: 'dados' }, 400);

  // (portal-19) modo interno: equipe avisa o cliente que respondemos a duvida dele.
  // Auth pelo x-bot-key (mesmo padrao do painel). Best-effort: nao confirma entrega.
  if (body.acao === 'enviar') {
    if (!process.env.BOT_PANEL_KEY || (req.headers.get('x-bot-key') || '') !== process.env.BOT_PANEL_KEY) {
      return json({ ok: false, erro: 'auth' }, 401);
    }
    const r = await enviarParaToken(token, { titulo: body.titulo, corpo: body.corpo, url: body.url, tag: body.tag });
    return json({ ok: true, ...r });
  }

  try {
    const { data: tk } = await db.from('cliente_portal_tokens')
      .select('advbox_customer_id').eq('token', token).eq('ativo', true).maybeSingle();
    if (!tk) return json({ ok: false, erro: 'acesso' }, 401);

    if (body.acao === 'remover') {
      const endpoint = body.sub?.endpoint || '';
      if (endpoint) await db.from('portal_push_subs').delete().eq('endpoint', endpoint);
      return json({ ok: true });
    }

    const sub = body.sub;
    if (!sub?.endpoint || !sub?.keys?.p256dh) return json({ ok: false, erro: 'sub' }, 400);
    await db.from('portal_push_subs').upsert({
      endpoint: sub.endpoint, token, advbox_customer_id: tk.advbox_customer_id, sub,
    });
    return json({ ok: true });
  } catch (err) {
    console.error('[portal-push]', err);
    return json({ ok: false, erro: 'indisponivel' }, 500);
  }
};

export const config = { path: '/.netlify/functions/portal-push' };
