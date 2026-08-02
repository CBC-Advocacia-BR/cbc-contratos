// portal-chat.mjs — chat do Portal do Cliente (lado CLIENTE).
// O cliente conversa com o escritório; a equipe responde pelo CBC Conversas
// (projeto chatguru-export). Dados no schema `chat` do Supabase (RLS deny-all);
// este handler é a única porta do lado do cliente, autenticada pelo token do
// portal (cliente_portal_tokens), validado DENTRO das RPCs public.chat_*.
//
// Sem dependências: chama a REST do Supabase via fetch (evita bundle).
// MVP: polling (o portal consulta a cada ~20s com a aba aberta).
// Rota padrão /.netlify/functions/portal-chat — NÃO declarar config.path com
// esse prefixo (é reservado e a Netlify descarta a função).
// ATIVAÇÃO FUTURA (registrado em CHAT-PORTAL.md): Realtime e push.
// ⚠️ Se você está sincronizando esta pasta com o "set da produção": este
// arquivo é NOVO (2026-07-02, módulo chat) — não apagar. Ver CHAT-PORTAL.md.

import { checkRateLimitShared } from './rate-limit.mjs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://vygczeepvoyaehfchxko.supabase.co";
// (auditoria 01/08/2026 — item 87) Esta function exigia SUPABASE_SERVICE_ROLE_KEY, que
// NUNCA foi configurada no Netlify: respondia erro de "config" para todo mundo, desde
// sempre. Agora cai para a chave anonima, como as demais functions do projeto ja fazem
// (_lib/botDb.mjs). As RPCs chamadas aqui sao SECURITY DEFINER e validam o token do
// portal por dentro, entao a chave anonima basta — o segredo continua sendo o token.
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5Z2N6ZWVwdm95YWVoZmNoeGtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMjgxNDYsImV4cCI6MjA4OTcwNDE0Nn0.dFk9CC48V1SlDuFNmtJOkfKf6LSz46aUg6Mpbd7xUjo";

const H = { "Content-Type": "application/json", "Cache-Control": "private, no-store" };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: H });

// (auditoria 01/08 — itens 41/109) O limitador daqui era em MEMORIA: cada instancia da
// function tinha o proprio contador, entao o teto de 40/min quase nunca era atingido de
// verdade — bastava cair em instancias diferentes. O comentario dizia "mesmo padrao de
// portal-data.mjs", mas o portal-data ja tinha migrado para o limitador COMPARTILHADO
// (contado no banco, vale entre instancias). Aqui ficou para tras.
// De quebra sai o `setInterval` no nivel do modulo, que em serverless so segurava o
// processo acordado sem necessidade.
async function rateLimited(req) {
  const rl = await checkRateLimitShared(req, { bucket: 'portal-chat', max: 40, windowSeconds: 60 });
  return !rl.allowed;
}

async function rpc(fn, args) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`rpc ${fn}: HTTP ${r.status}`);
  return r.json();
}

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, erro: "metodo" }, 405);
  if (!SERVICE_KEY) return json({ ok: false, erro: "config" }, 500);
  if (await rateLimited(req)) return json({ ok: false, erro: "limite", msg: "Muitas requisições — aguarde um instante." }, 429);

  let body;
  try { body = await req.json(); } catch { return json({ ok: false, erro: "corpo" }, 400); }
  const token = String(body.t || "").trim();
  if (!token || token.length < 16) return json({ ok: false, erro: "token" }, 401);
  const op = String(body.op || "");

  try {
    if (op === "enviar") {
      const corpo = String(body.corpo || "").trim().slice(0, 4000);
      const r = await rpc("chat_cliente_enviar", { p_token: token, p_corpo: corpo });
      return json(r, r.ok ? 200 : r.erro === "token" ? 401 : 400);
    }
    if (op === "listar") {
      const apos = Number.isFinite(+body.apos) ? Math.max(0, Math.floor(+body.apos)) : 0;
      const r = await rpc("chat_cliente_listar", { p_token: token, p_apos: apos });
      return json(r, r.ok ? 200 : 401);
    }
    if (op === "badge") {
      const r = await rpc("chat_cliente_badge", { p_token: token });
      return json(r, r.ok ? 200 : 401);
    }
    return json({ ok: false, erro: "op" }, 400);
  } catch (err) {
    console.error("[portal-chat]", err?.message || err);
    return json({ ok: false, erro: "interno" }, 500);
  }
};
