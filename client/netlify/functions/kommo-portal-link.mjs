// kommo-portal-link.mjs — endpoint para o Salesbot do Kommo disparar o link
// do Portal do Cliente após a assinatura do contrato.
//
// Fluxo (configuração do bot no Kommo em CHAT-PORTAL.md):
//   1. Lead muda para o estágio "Contrato assinado" → Salesbot dispara.
//   2. Salesbot faz um passo "Widget/Webhook" POST para esta função com o CPF
//      do lead (campo personalizado) — e a chave secreta na query string.
//   3. A função encontra/gera o token do portal (mesma mecânica do
//      portal-admin.mjs: reusa token ativo; senão cria um novo) e responde
//      { link, primeiro_nome, instrucoes } para o bot montar a mensagem.
//
// Proteção: query ?k=<PORTAL_LINK_KEY> (env). Sem a chave → 401.
// Sem dependências (fetch direto na REST do Supabase, service key).
// Rota padrão /.netlify/functions/kommo-portal-link — NÃO declarar config.path.
// ⚠️ Se você está sincronizando esta pasta com o "set da produção": este
// arquivo é NOVO (2026-07-02, módulo chat) — não apagar. Ver CHAT-PORTAL.md.

import { randomBytes } from "node:crypto";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://vygczeepvoyaehfchxko.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const LINK_KEY = process.env.PORTAL_LINK_KEY || "";
const BASE = "https://contratos-cbc.netlify.app/portal?t=";

const H = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: H });
const digits = (s) => String(s || "").replace(/\D/g, "");

const REST = (path) => `${SUPABASE_URL}/rest/v1/${path}`;
const HDR = {
  "Content-Type": "application/json",
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

async function sb(path, opts = {}) {
  const r = await fetch(REST(path), { ...opts, headers: { ...HDR, ...(opts.headers || {}) }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`supabase ${path}: HTTP ${r.status} ${await r.text().catch(() => "")}`.slice(0, 300));
  return r.status === 204 ? null : r.json();
}

// Acha o cliente por CPF nos espelhos (bi_clientes tem advbox_customer_id).
async function acharCliente(cpf) {
  const fmt = cpf.length === 11 ? `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}` : cpf;
  const q = encodeURIComponent(`cpf_cnpj.in.("${cpf}","${fmt}")`);
  const rows = await sb(`bi_clientes?select=customer_id,nome,cpf_cnpj&or=(${q})&limit=1`);
  if (rows?.length) return { advbox_customer_id: rows[0].customer_id, nome: rows[0].nome };
  const q2 = encodeURIComponent(`cpf_contratante1.in.("${cpf}","${fmt}"),cpf_contratante2.in.("${cpf}","${fmt}")`);
  const c = await sb(`contratos?select=nome_contratante1&or=(${q2})&order=created_at.desc&limit=1`);
  if (c?.length) return { advbox_customer_id: null, nome: c[0].nome_contratante1 };
  return null;
}

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, erro: "metodo" }, 405);
  if (!SERVICE_KEY) return json({ ok: false, erro: "config" }, 500);
  const url = new URL(req.url);
  if (!LINK_KEY || url.searchParams.get("k") !== LINK_KEY) return json({ ok: false, erro: "auth" }, 401);

  let body = {};
  try {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("json")) body = await req.json();
    else { // Kommo salesbot costuma mandar form-urlencoded
      const txt = await req.text();
      body = Object.fromEntries(new URLSearchParams(txt));
    }
  } catch { return json({ ok: false, erro: "corpo" }, 400); }

  const cpf = digits(body.cpf || body.CPF || "");
  if (cpf.length !== 11 && cpf.length !== 14) return json({ ok: false, erro: "cpf", msg: "CPF ausente ou inválido no lead." }, 400);

  try {
    const cli = await acharCliente(cpf);
    const nome = String(body.nome || cli?.nome || "").trim();

    // token ativo existente? reusa (o cliente pode já ter recebido o portal)
    const tks = await sb(`cliente_portal_tokens?select=token&cpf=eq.${cpf}&ativo=eq.true&order=criado_em.desc&limit=1`)
      .catch(() => null);
    let token = tks?.[0]?.token;

    if (!token) {
      // advbox_customer_id e nome são NOT NULL na tabela (regra do portal-admin):
      // o cliente precisa existir no espelho do Advbox antes do link ser gerado.
      if (!cli?.advbox_customer_id) {
        return json({
          ok: false, erro: "cliente_nao_encontrado",
          msg: "Cliente não encontrado no Advbox (bi_clientes). Aguarde a sincronização ou crie o link manualmente na aba Portal do Cliente.",
        }, 404);
      }
      token = randomBytes(16).toString("hex");
      await sb("cliente_portal_tokens", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          token,
          cpf,
          nome: nome || "Cliente",
          advbox_customer_id: cli.advbox_customer_id,
          ativo: true,
        }),
      });
    }

    const link = BASE + token;
    const primeiro = (nome.split(/\s+/)[0] || "cliente");
    const primeiroFmt = primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
    return json({
      ok: true,
      link,
      primeiro_nome: primeiroFmt,
      // texto pronto p/ o Salesbot usar como {{json.instrucoes}}
      instrucoes:
        `${primeiroFmt}, seu contrato foi assinado com sucesso! 🎉\n\n` +
        `A partir de agora você acompanha TUDO pelo Portal do Cliente CBC — seu caso, ` +
        `pagamentos e conversas com a nossa equipe, direto do celular:\n\n${link}\n\n` +
        `📌 Dica: ao abrir, toque em "Adicionar à tela de início" para virar um aplicativo. ` +
        `Não precisa de senha — guarde este link com carinho, ele é pessoal.`,
    });
  } catch (err) {
    console.error("[kommo-portal-link]", err?.message || err);
    return json({ ok: false, erro: "interno" }, 500);
  }
};
