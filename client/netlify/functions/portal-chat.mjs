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

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://vygczeepvoyaehfchxko.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const H = { "Content-Type": "application/json", "Cache-Control": "private, no-store" };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: H });

// rate-limit em memória por IP (mesmo padrão de portal-data.mjs)
const WINDOW_MS = 60_000, MAX_REQ = 40;
const bucket = new Map();
function rateLimited(req) {
  const ip = req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "?";
  const now = Date.now();
  const e = bucket.get(ip);
  if (!e || now - e.start > WINDOW_MS) { bucket.set(ip, { count: 1, start: now }); return false; }
  e.count++;
  return e.count > MAX_REQ;
}
setInterval(() => { const now = Date.now(); for (const [k, e] of bucket) if (now - e.start > WINDOW_MS * 2) bucket.delete(k); }, 300_000);

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
  if (rateLimited(req)) return json({ ok: false, erro: "limite", msg: "Muitas requisições — aguarde um instante." }, 429);

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
