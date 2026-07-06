// portal-nfse.mjs — "Baixar todas as notas do ano (PDF)" do Portal do Cliente.
// GET ?t=<token do portal>&ano=<AAAA> → um único PDF com todas as notas fiscais
// das cobranças PAGAS do cliente no ano (fonte: asaas_boletos.nf_pdf_url, que o
// Asaas emite junto à Prefeitura de Americana). O botão individual por cobrança
// usa o nf_url direto (mesma classe de link público do boleto) — esta função só
// cuida do consolidado anual. Aprovado pelo Paulo em 2026-07-02 (mockup).
//
// Segurança: o token identifica o cliente; os boletos vêm da RPC portal_boletos
// (SECURITY DEFINER, filtra por CPF do token) — ninguém baixa nota de outro.
// Limites: máx. 40 notas / ~5 MB (resposta de função é limitada a 6 MB).
// Rota padrão /.netlify/functions/portal-nfse — NÃO declarar config.path.
// ⚠️ Sincronização com "set da produção": arquivo NOVO (2026-07-02) — não apagar.

import { PDFDocument } from "pdf-lib";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://vygczeepvoyaehfchxko.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const PAGOS = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH", "DUNNING_RECEIVED"]);
const MAX_NOTAS = 40, MAX_BYTES = 5 * 1024 * 1024;

const paginaErro = (titulo, msg, status = 400) => new Response(
  `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<body style="font-family:system-ui;background:#FAF6EE;color:#142A43;display:flex;min-height:90vh;align-items:center;justify-content:center;text-align:center;padding:24px">` +
  `<div><div style="font-size:34px">🧾</div><h1 style="font-size:19px;margin:10px 0 6px">${titulo}</h1>` +
  `<p style="font-size:14px;color:#3D5570;max-width:420px">${msg}</p></div></body></html>`,
  { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

async function rpcPortalBoletos(token) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/portal_boletos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ p_token: token }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`portal_boletos HTTP ${r.status}`);
  return r.json();
}

export default async (req) => {
  if (req.method !== "GET") return paginaErro("Método não permitido", "Use o botão do portal para baixar as notas.", 405);
  if (!SERVICE_KEY) return paginaErro("Indisponível no momento", "Tente novamente em alguns minutos.", 500);

  const url = new URL(req.url);
  const token = (url.searchParams.get("t") || "").trim();
  const ano = parseInt(url.searchParams.get("ano"), 10) || new Date().getFullYear();
  if (!token || token.length < 16) return paginaErro("Acesso inválido", "Abra pelo link do seu portal.", 401);

  try {
    const boletos = await rpcPortalBoletos(token);
    if (!Array.isArray(boletos)) return paginaErro("Acesso inválido", "Abra pelo link do seu portal.", 401);

    const notas = boletos
      .filter((b) => PAGOS.has(b.status) && b.nf_pdf_url &&
        String(b.payment_date || b.due_date || "").slice(0, 4) === String(ano))
      .slice(0, MAX_NOTAS);

    if (!notas.length) {
      return paginaErro(`Nenhuma nota de ${ano} ainda`,
        "As notas fiscais aparecem aqui alguns dias após cada pagamento. Se acabou de pagar, volte em breve.", 404);
    }

    // baixa os PDFs em paralelo e junta na ordem cronológica
    notas.sort((a, b) => String(a.payment_date || a.due_date || "").localeCompare(String(b.payment_date || b.due_date || "")));
    const pdfs = await Promise.all(notas.map((n) =>
      fetch(n.nf_pdf_url, { signal: AbortSignal.timeout(9000) })
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null)
    ));

    const doc = await PDFDocument.create();
    let bytes = 0, incluidas = 0;
    for (const buf of pdfs) {
      if (!buf) continue;
      bytes += buf.byteLength;
      if (bytes > MAX_BYTES) break;
      try {
        const src = await PDFDocument.load(buf, { ignoreEncryption: true });
        const pages = await doc.copyPages(src, src.getPageIndices());
        pages.forEach((p) => doc.addPage(p));
        incluidas++;
      } catch { /* nota corrompida: pula, não derruba o pacote */ }
    }
    if (!incluidas) return paginaErro("Não foi possível montar o PDF", "Baixe as notas individualmente pelos botões de cada pagamento.", 502);

    const out = await doc.save();
    return new Response(out, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="notas-fiscais-CBC-${ano}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[portal-nfse]", err?.message || err);
    return paginaErro("Não foi possível gerar agora", "Tente novamente em alguns minutos ou baixe as notas uma a uma pelos botões de cada pagamento.", 500);
  }
};
