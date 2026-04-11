// CBC TESES — rotas de backend.
//
// Este módulo exporta uma função que recebe o app Express existente e
// registra:
//   - /api/teses/advbox/*    proxy para a API do Advbox (Bearer token)
//   - /api/teses/datajud     proxy para a API pública do DataJud (CNJ)
//   - /api/teses/docx-to-pdf conversão de DOCX recebido em multipart
//
// Todas as variáveis sensíveis ficam no backend:
//   ADVBOX_API_URL, ADVBOX_BEARER_TOKEN, DATAJUD_API_URL, DATAJUD_API_KEY

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ADVBOX_URL = process.env.ADVBOX_API_URL || 'https://app.advbox.com.br/api/v1';
const ADVBOX_TOKEN = process.env.ADVBOX_BEARER_TOKEN || '';
const DATAJUD_URL = process.env.DATAJUD_API_URL || 'https://api-publica.datajud.cnj.jus.br';
const DATAJUD_KEY = process.env.DATAJUD_API_KEY || '';

// Mapa simples de rate-limit (in-memory). Em produção trocar por Redis.
const rateMap = new Map();
function checkRate(key, max, windowMs) {
  const now = Date.now();
  const arr = (rateMap.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  rateMap.set(key, arr);
  return arr.length <= max;
}

async function advboxFetch(pathname, init = {}) {
  if (!ADVBOX_TOKEN) {
    const err = new Error('ADVBOX_BEARER_TOKEN não configurado no backend');
    err.status = 503;
    throw err;
  }
  const url = `${ADVBOX_URL}${pathname}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${ADVBOX_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!r.ok) {
    const err = new Error(`Advbox ${r.status}: ${text.slice(0, 400)}`);
    err.status = r.status;
    throw err;
  }
  return body;
}

function sendError(res, err) {
  const status = err?.status || 500;
  res.status(status).json({ error: err?.message || 'internal error' });
}

/**
 * Tenta converter um DOCX em PDF usando o binário `soffice` (LibreOffice)
 * em modo headless. Retorna um Buffer com o PDF, ou null em caso de falha.
 */
async function convertDocxBufferToPdf(docxBuffer) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbc-teses-'));
  const inFile = path.join(tmp, 'input.docx');
  const outFile = path.join(tmp, 'input.pdf');
  try {
    fs.writeFileSync(inFile, docxBuffer);
    await new Promise((resolve, reject) => {
      const p = spawn('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', tmp, inFile], {
        stdio: 'ignore',
      });
      p.on('error', reject);
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`soffice exit ${code}`))));
    });
    if (!fs.existsSync(outFile)) return null;
    return fs.readFileSync(outFile);
  } catch {
    return null;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

function register(app) {
  // ─── Advbox ────────────────────────────────────────
  app.get('/api/teses/advbox/settings', async (req, res) => {
    if (!checkRate('advbox-get', 30, 60_000)) return res.status(429).json({ error: 'rate limit' });
    try { res.json(await advboxFetch('/settings')); } catch (e) { sendError(res, e); }
  });

  app.get('/api/teses/advbox/lawsuits', async (req, res) => {
    if (!checkRate('advbox-get', 30, 60_000)) return res.status(429).json({ error: 'rate limit' });
    const { process_number } = req.query;
    if (!process_number) return res.status(400).json({ error: 'process_number obrigatório' });
    try {
      const body = await advboxFetch(`/lawsuits?process_number=${encodeURIComponent(process_number)}`);
      res.json(body);
    } catch (e) { sendError(res, e); }
  });

  app.get('/api/teses/advbox/lawsuits/:id', async (req, res) => {
    if (!checkRate('advbox-get', 30, 60_000)) return res.status(429).json({ error: 'rate limit' });
    try { res.json(await advboxFetch(`/lawsuits/${encodeURIComponent(req.params.id)}`)); } catch (e) { sendError(res, e); }
  });

  app.get('/api/teses/advbox/customers/:id', async (req, res) => {
    if (!checkRate('advbox-get', 30, 60_000)) return res.status(429).json({ error: 'rate limit' });
    try { res.json(await advboxFetch(`/customers/${encodeURIComponent(req.params.id)}`)); } catch (e) { sendError(res, e); }
  });

  app.get('/api/teses/advbox/movements/:lawsuitId', async (req, res) => {
    if (!checkRate('advbox-get', 30, 60_000)) return res.status(429).json({ error: 'rate limit' });
    try { res.json(await advboxFetch(`/movements/${encodeURIComponent(req.params.lawsuitId)}`)); } catch (e) { sendError(res, e); }
  });

  app.get('/api/teses/advbox/publications/:lawsuitId', async (req, res) => {
    if (!checkRate('advbox-get', 30, 60_000)) return res.status(429).json({ error: 'rate limit' });
    try { res.json(await advboxFetch(`/publications/${encodeURIComponent(req.params.lawsuitId)}`)); } catch (e) { sendError(res, e); }
  });

  app.post('/api/teses/advbox/posts', async (req, res) => {
    if (!checkRate('advbox-post-posts', 500, 86_400_000)) return res.status(429).json({ error: 'rate limit diário' });
    try {
      const body = await advboxFetch('/posts', { method: 'POST', body: JSON.stringify(req.body || {}) });
      res.json(body);
    } catch (e) { sendError(res, e); }
  });

  app.post('/api/teses/advbox/movements', async (req, res) => {
    if (!checkRate('advbox-post-movs', 500, 86_400_000)) return res.status(429).json({ error: 'rate limit diário' });
    try {
      const body = await advboxFetch('/movements', { method: 'POST', body: JSON.stringify(req.body || {}) });
      res.json(body);
    } catch (e) { sendError(res, e); }
  });

  // ─── DataJud ───────────────────────────────────────
  // Endpoint público do CNJ precisa do tribunal correto na URL.
  // Como não sabemos o tribunal a partir só do número, essa rota
  // só faz um placeholder caso a chave esteja configurada.
  app.get('/api/teses/datajud', async (req, res) => {
    const { process_number } = req.query;
    if (!process_number) return res.status(400).json({ error: 'process_number obrigatório' });
    if (!DATAJUD_KEY) return res.status(503).json({ error: 'DATAJUD_API_KEY não configurado' });
    try {
      // Tenta o índice agregado "api_publica_tjsp" como default (substituir conforme necessário)
      const r = await fetch(`${DATAJUD_URL}/api_publica_tjsp/_search`, {
        method: 'POST',
        headers: {
          Authorization: `APIKey ${DATAJUD_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: {
            match: { numeroProcesso: process_number.replace(/\D/g, '') },
          },
        }),
      });
      const text = await r.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
      if (!r.ok) return res.status(r.status).json({ error: json?.error || text });
      res.json(json);
    } catch (e) { sendError(res, e); }
  });

  // ─── DOCX → PDF ────────────────────────────────────
  // Aceita multipart/form-data (campo "file") ou application/octet-stream.
  app.post('/api/teses/docx-to-pdf', async (req, res) => {
    try {
      // Busca simples de boundary multipart (sem dep extra)
      const ct = req.headers['content-type'] || '';
      let buffer;
      if (ct.includes('multipart/form-data')) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const raw = Buffer.concat(chunks);
        const m = ct.match(/boundary=(.+)$/);
        if (!m) return res.status(400).json({ error: 'multipart boundary não encontrado' });
        const boundary = Buffer.from('--' + m[1]);
        const parts = [];
        let i = 0;
        while (i < raw.length) {
          const next = raw.indexOf(boundary, i);
          if (next < 0) break;
          parts.push(raw.slice(i, next));
          i = next + boundary.length;
        }
        const filePart = parts.find((p) => /filename=/.test(p.toString('latin1')));
        if (!filePart) return res.status(400).json({ error: 'arquivo não enviado' });
        const headerEnd = filePart.indexOf(Buffer.from('\r\n\r\n'));
        buffer = filePart.slice(headerEnd + 4, filePart.length - 2);
      } else {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        buffer = Buffer.concat(chunks);
      }
      const pdf = await convertDocxBufferToPdf(buffer);
      if (!pdf) return res.status(503).json({ error: 'LibreOffice indisponível no servidor' });
      res.setHeader('Content-Type', 'application/pdf');
      res.send(pdf);
    } catch (e) { sendError(res, e); }
  });

  app.get('/api/teses/health', (_req, res) => {
    res.json({
      ok: true,
      advbox_configured: Boolean(ADVBOX_TOKEN),
      datajud_configured: Boolean(DATAJUD_KEY),
    });
  });
}

module.exports = { register };
