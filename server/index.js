const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const Tesseract = require('tesseract.js');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// S3 client — only initialized if AWS credentials are present
const s3 = process.env.AWS_ACCESS_KEY_ID ? new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
}) : null;
const S3_BUCKET = process.env.S3_BACKUP_BUCKET || '';

async function uploadToS3(filename, data) {
  if (!s3 || !S3_BUCKET) return null;
  try {
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `cbc-contratos/backups/${filename}`,
      Body: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      ContentType: 'application/json',
    }));
    console.log(`S3 backup uploaded: ${filename}`);
    return true;
  } catch (err) {
    console.error('S3 upload error:', err.message);
    return false;
  }
}

const SUPA_URL = 'https://vygczeepvoyaehfchxko.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5Z2N6ZWVwdm95YWVoZmNoeGtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMjgxNDYsImV4cCI6MjA4OTcwNDE0Nn0.dFk9CC48V1SlDuFNmtJOkfKf6LSz46aUg6Mpbd7xUjo';
const supabase = createClient(SUPA_URL, SUPA_KEY);

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// CBC TESES — rotas do sistema de gestão de modelos/petições
try {
  const teses = require('./teses_routes');
  teses.register(app);
  console.log('CBC TESES routes registered');
} catch (err) {
  console.error('Failed to register CBC TESES routes:', err.message);
}

// ═══════════════════════════════════════════
//  AUTHENTICATION (Supabase Auth)
// ═══════════════════════════════════════════

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'E-mail e senha obrigatórios' });
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    const userName = (email.split('@')[0] || '').replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    res.json({
      user: {
        email: data.user.email,
        name: userName,
        token: data.session.access_token,
        id: data.user.id,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
});

app.get('/api/auth/session', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Sem token' });
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Sessão inválida' });
    const email = data.user.email;
    const userName = (email.split('@')[0] || '').replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    res.json({ user: { email, name: userName, token, id: data.user.id } });
  } catch (err) {
    res.status(401).json({ error: 'Sessão inválida' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    await supabase.auth.signOut();
    res.json({ ok: true });
  } catch { res.json({ ok: true }); }
});

// ═══════════════════════════════════════════
//  CONTRATOS CRUD + SEARCH
// ═══════════════════════════════════════════

// List all contracts (with optional search)
app.get('/api/contratos', async (req, res) => {
  try {
    const { q, status, resort, limit = 50, offset = 0 } = req.query;
    let query = supabase
      .from('contratos')
      .select('id, created_at, updated_at, nome_contratante1, cpf_contratante1, nome_contratante2, cpf_contratante2, resort, tipo_acao, honorarios_total, honorarios_percentual_exito, honorarios_parcelas, status, zapsign_doc_token, created_by, updated_by')
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (resort) query = query.eq('resort', resort);

    if (q) {
      const search = `%${q}%`;
      query = query.or(
        `nome_contratante1.ilike.${search},cpf_contratante1.ilike.${search},nome_contratante2.ilike.${search},cpf_contratante2.ilike.${search},resort.ilike.${search}`
      );
    }

    const { data, error, count } = await query;
    if (error) throw error;
    res.json({ contratos: data, count: data.length });
  } catch (err) {
    console.error('Erro ao listar contratos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get single contract
app.get('/api/contratos/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('contratos')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Contrato não encontrado' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save new contract
app.post('/api/contratos', async (req, res) => {
  try {
    const d = req.body;
    const c1 = d.contratantes?.[0] || {};
    const c2 = d.numContratantes >= 1 ? d.contratantes?.[1] : null;
    const hon = d.honorarios || {};

    const row = {
      nome_contratante1: c1.nome || 'Sem nome',
      cpf_contratante1: c1.cpf || '',
      email_contratante1: c1.email || '',
      nome_contratante2: c2?.nome || null,
      cpf_contratante2: c2?.cpf || null,
      email_contratante2: c2?.email || null,
      resort: d.resort === 'outro' ? d.resortCustom : d.resort || '',
      tipo_acao: d.tipoAcao === 'outro' ? d.tipoAcaoCustom : d.tipoAcao || '',
      honorarios_total: hon.total || 0,
      honorarios_parcelas: hon.parcelas || 0,
      honorarios_valor_parcela: hon.valorParcela || 0,
      honorarios_percentual_exito: hon.percentualExito || 0,
      data_primeira_parcela: hon.dataPrimeiraParcela || null,
      status: d.status || 'rascunho',
      zapsign_doc_token: d.zapsign_doc_token || null,
      zapsign_links: d.zapsign_links || null,
      dados: d,
      created_by: d.user_email || null,
      updated_by: d.user_email || null,
    };

    const { data, error } = await supabase
      .from('contratos')
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    // Audit + version
    await logAudit('contrato_criado', 'contrato', data.id, { resort: row.resort, nome: row.nome_contratante1 });
    await saveVersion(data.id, d, 'Versão inicial');
    res.json(data);
  } catch (err) {
    console.error('Erro ao salvar contrato:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Update contract
app.put('/api/contratos/:id', async (req, res) => {
  try {
    const updates = req.body;
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabase
      .from('contratos')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete contract
app.delete('/api/contratos/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('contratos')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
//  ZAPSIGN STATUS SYNC
// ═══════════════════════════════════════════

const ZAPSIGN_TOKEN = 'c88bf943-6227-4dcd-a258-8b769e65358ceb3510ae-25f3-4dc1-a4c0-09f8db97bb5e';

// Sync a single contract's ZapSign status
async function syncZapSignStatus(contrato) {
  if (!contrato.zapsign_doc_token) return null;
  try {
    const resp = await fetch(`https://api.zapsign.com.br/api/v1/docs/${contrato.zapsign_doc_token}/?api_token=${ZAPSIGN_TOKEN}`);
    if (!resp.ok) return null;
    const doc = await resp.json();

    // Preserve doc_type from existing links
    const existingLinks = contrato.zapsign_links || [];
    const existingByToken = {};
    existingLinks.forEach(l => { if (l.token) existingByToken[l.token] = l; });

    const signers = (doc.signers || []).map(s => ({
      name: s.name, email: s.email, token: s.token, status: s.status,
      sign_url: s.sign_url || s.signing_link || `https://app.zapsign.com.br/verificar/${s.token}`,
      signed_at: s.signed_at || null,
      doc_type: existingByToken[s.token]?.doc_type || (doc.name || '').replace(/^(Contrato \+ Procuracao|Contrato|Procuracao).*/, '$1') || null,
    }));

    let newStatus = contrato.status;
    if (doc.status === 'signed') newStatus = 'assinado';
    else if (doc.status === 'pending') newStatus = 'enviado_zapsign';
    else if (doc.status === 'canceled' || doc.status === 'expired') newStatus = 'cancelado';

    if (newStatus !== contrato.status || JSON.stringify(signers) !== JSON.stringify(contrato.zapsign_links)) {
      const { error } = await supabase
        .from('contratos')
        .update({ status: newStatus, zapsign_links: signers, updated_at: new Date().toISOString() })
        .eq('id', contrato.id);
      if (error) console.error('Sync update error:', error.message);
      return { id: contrato.id, oldStatus: contrato.status, newStatus, signers };
    }
    return null;
  } catch (err) {
    console.error('ZapSign sync error:', err.message);
    return null;
  }
}

// Sync all pending/sent contracts
app.post('/api/zapsign/sync', async (req, res) => {
  try {
    const { data: contratos, error } = await supabase
      .from('contratos')
      .select('id, zapsign_doc_token, zapsign_links, status')
      .eq('status', 'enviado_zapsign')
      .not('zapsign_doc_token', 'is', null);
    if (error) throw error;

    const results = [];
    for (const c of (contratos || [])) {
      const r = await syncZapSignStatus(c);
      if (r) results.push(r);
    }
    res.json({ synced: results.length, updates: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sync a single contract
app.post('/api/zapsign/sync/:id', async (req, res) => {
  try {
    const { data: contrato, error } = await supabase
      .from('contratos')
      .select('id, zapsign_doc_token, zapsign_links, status')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    const r = await syncZapSignStatus(contrato);
    res.json({ updated: !!r, result: r });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Webhook endpoint for ZapSign notifications
app.post('/api/zapsign/webhook', async (req, res) => {
  try {
    const { event, doc_token, signer_token, status } = req.body;
    console.log('ZapSign webhook:', event, doc_token, status);

    if (doc_token) {
      const { data: contratos } = await supabase
        .from('contratos')
        .select('id, zapsign_doc_token, zapsign_links, status')
        .eq('zapsign_doc_token', doc_token);

      for (const c of (contratos || [])) {
        await syncZapSignStatus(c);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.json({ ok: true }); // Always return 200 to ZapSign
  }
});

// Auto-sync every 5 minutes
setInterval(async () => {
  try {
    const { data: contratos } = await supabase
      .from('contratos')
      .select('id, zapsign_doc_token, zapsign_links, status')
      .eq('status', 'enviado_zapsign')
      .not('zapsign_doc_token', 'is', null);
    let synced = 0;
    for (const c of (contratos || [])) {
      const r = await syncZapSignStatus(c);
      if (r) synced++;
    }
    if (synced > 0) console.log(`Auto-sync: ${synced} contrato(s) atualizado(s)`);
  } catch {}
}, 5 * 60 * 1000);

// ═══════════════════════════════════════════
//  DASHBOARD METRICS
// ═══════════════════════════════════════════
app.get('/api/dashboard', async (req, res) => {
  try {
    const { mes, resort, tipo_acao, data_inicio, data_fim } = req.query;

    // Fetch all contracts (filtered at DB level where possible)
    let query = supabase
      .from('contratos')
      .select('id, created_at, resort, tipo_acao, honorarios_total, honorarios_percentual_exito, status, nome_contratante1')
      .order('created_at', { ascending: false });

    if (resort) query = query.eq('resort', resort);
    if (tipo_acao) query = query.eq('tipo_acao', tipo_acao);
    if (data_inicio) query = query.gte('created_at', `${data_inicio}T00:00:00`);
    if (data_fim) query = query.lte('created_at', `${data_fim}T23:59:59`);

    const { data: rawAll, error: e1 } = await query;
    if (e1) throw e1;

    // Filter by month client-side (YYYY-MM format)
    let all = rawAll || [];
    if (mes) {
      all = all.filter(c => {
        const d = new Date(c.created_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        return key === mes;
      });
    }

    const totalContratos = all.length;
    const valorTotal = all.reduce((sum, c) => sum + (Number(c.honorarios_total) || 0), 0);

    // By status
    const porStatus = {};
    all.forEach(c => { porStatus[c.status] = (porStatus[c.status] || 0) + 1; });

    // By honorarios type (derived from existing fields)
    const porTipoHonorario = { somente_exito: 0, somente_iniciais: 0, ambos: 0 };
    all.forEach(c => {
      const hasTotal = c.honorarios_total && Number(c.honorarios_total) > 0;
      const hasExito = c.honorarios_percentual_exito && Number(c.honorarios_percentual_exito) > 0;
      const tipo = hasTotal && hasExito ? 'ambos' : hasTotal ? 'somente_iniciais' : 'somente_exito';
      porTipoHonorario[tipo]++;
    });

    // By resort
    const resortMap = {};
    all.forEach(c => { if (c.resort) resortMap[c.resort] = (resortMap[c.resort] || 0) + 1; });
    const porResort = Object.entries(resortMap)
      .map(([resort, count]) => ({ resort, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // By tipo_acao
    const acaoMap = {};
    all.forEach(c => { if (c.tipo_acao) acaoMap[c.tipo_acao] = (acaoMap[c.tipo_acao] || 0) + 1; });
    const porTipoAcao = Object.entries(acaoMap)
      .map(([acao, count]) => ({ acao, count }))
      .sort((a, b) => b.count - a.count);

    // By month
    const mesMap = {};
    all.forEach(c => {
      const d = new Date(c.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
      if (!mesMap[key]) mesMap[key] = { mes: label, mesKey: key, count: 0 };
      mesMap[key].count++;
    });
    const porMes = Object.values(mesMap).sort((a, b) => a.mesKey.localeCompare(b.mesKey)).slice(-12);

    // All recent (frontend handles pagination)
    const recentes = all.slice(0, 50);

    // Top 5 resorts of current month (signed contracts)
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const resortMesMap = {};
    all.forEach(c => {
      if (!c.resort || c.status !== 'assinado') return;
      const d = new Date(c.created_at);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (mk === currentMonthKey) {
        resortMesMap[c.resort] = (resortMesMap[c.resort] || 0) + 1;
      }
    });
    const topResortsDoMes = Object.entries(resortMesMap)
      .map(([resort, count]) => ({ resort, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Distinct values for filter dropdowns (from unfiltered data)
    const { data: allUnfiltered } = await supabase
      .from('contratos')
      .select('resort, tipo_acao, created_at');
    const resorts = [...new Set((allUnfiltered || []).map(c => c.resort).filter(Boolean))].sort();
    const tiposAcao = [...new Set((allUnfiltered || []).map(c => c.tipo_acao).filter(Boolean))].sort();
    const mesesDisp = {};
    (allUnfiltered || []).forEach(c => {
      const d = new Date(c.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
      mesesDisp[key] = label;
    });
    const meses = Object.entries(mesesDisp).sort((a, b) => b[0].localeCompare(a[0])).map(([key, label]) => ({ key, label }));

    res.json({ totalContratos, valorTotal, porStatus, porTipoHonorario, porResort, porTipoAcao, porMes, recentes, topResortsDoMes, filtros: { resorts, tiposAcao, meses } });
  } catch (err) {
    console.error('Dashboard error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
//  ZAPSIGN WEBHOOK - auto-update status
// ═══════════════════════════════════════════
app.post('/api/webhook/zapsign', async (req, res) => {
  try {
    const event = req.body;
    console.log('ZapSign webhook received:', JSON.stringify(event).substring(0, 500));

    const docToken = event.doc_token || event.token;
    const eventType = event.event_type || event.type;

    if (!docToken) return res.json({ ok: true, msg: 'no doc_token' });

    // Map ZapSign events to our status
    let newStatus = null;
    if (eventType === 'doc_signed' || eventType === 'all_signed') {
      newStatus = 'assinado';
    } else if (eventType === 'doc_refused' || eventType === 'doc_cancelled') {
      newStatus = 'cancelado';
    }

    if (newStatus) {
      const { data: updated, error } = await supabase
        .from('contratos')
        .update({ status: newStatus })
        .eq('zapsign_doc_token', docToken)
        .select('id, nome_contratante1, resort')
        .single();
      if (error) console.error('Webhook update error:', error.message);
      else {
        console.log(`Contract ${docToken} updated to ${newStatus}`);
        await logAudit('status_atualizado_webhook', 'contrato', updated?.id, { status: newStatus, docToken });
        broadcastNotification('contract_status', {
          id: updated?.id, status: newStatus, nome: updated?.nome_contratante1, resort: updated?.resort,
          message: `Contrato de ${updated?.nome_contratante1} foi ${newStatus === 'assinado' ? 'assinado' : 'cancelado'}!`,
        });
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.json({ ok: true }); // Always return 200 to ZapSign
  }
});

// ═══════════════════════════════════════════
//  ADDRESS AUTOCOMPLETE (via ViaCEP search)
// ═══════════════════════════════════════════
app.get('/api/endereco/busca', async (req, res) => {
  const { uf, cidade, rua } = req.query;
  if (!uf || !cidade || !rua || rua.length < 3) {
    return res.status(400).json({ error: 'Informe UF, cidade e pelo menos 3 letras da rua' });
  }
  try {
    const resp = await fetch(`https://viacep.com.br/ws/${encodeURIComponent(uf)}/${encodeURIComponent(cidade)}/${encodeURIComponent(rua)}/json/`);
    const data = await resp.json();
    if (!Array.isArray(data)) return res.json([]);
    res.json(data.slice(0, 10).map(d => ({
      cep: d.cep,
      rua: d.logradouro,
      bairro: d.bairro,
      cidade: d.localidade,
      uf: d.uf,
    })));
  } catch {
    res.json([]);
  }
});

// ═══════════════════════════════════════════
//  OCR - CNH DIGITAL EXTRACTION
// ═══════════════════════════════════════════
app.post('/api/ocr/cnh', async (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'Imagem base64 obrigatória' });

  let browser;
  try {
    // Detect if it's a PDF or image
    const isPdf = imageBase64.startsWith('data:application/pdf');
    let imgBuffer;

    if (isPdf) {
      // Convert PDF first page to high-res image using Puppeteer + PDF.js
      const base64Clean = imageBase64.replace(/^data:application\/pdf;base64,/, '');

      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage();
      await page.setViewport({ width: 1400, height: 2000, deviceScaleFactor: 2 });

      // Render PDF using PDF.js in an HTML page for proper canvas rendering
      const pdfJsHtml = `<!DOCTYPE html><html><head>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
        <style>body{margin:0;padding:0;background:#fff;} canvas{display:block;}</style>
      </head><body>
        <canvas id="canvas"></canvas>
        <script>
          pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          const b64 = '${base64Clean}';
          const raw = atob(b64);
          const arr = new Uint8Array(raw.length);
          for(let i=0;i<raw.length;i++) arr[i]=raw.charCodeAt(i);
          pdfjsLib.getDocument({data:arr}).promise.then(pdf => {
            pdf.getPage(1).then(pg => {
              const scale = 3;
              const vp = pg.getViewport({scale});
              const canvas = document.getElementById('canvas');
              canvas.width = vp.width;
              canvas.height = vp.height;
              const ctx = canvas.getContext('2d');
              pg.render({canvasContext:ctx, viewport:vp}).promise.then(() => {
                document.title = 'DONE';
              });
            });
          }).catch(e => { document.title = 'ERROR:' + e.message; });
        </script>
      </body></html>`;

      await page.setContent(pdfJsHtml, { waitUntil: 'networkidle0', timeout: 30000 });
      // Wait for PDF.js to finish rendering
      await page.waitForFunction(() => document.title.startsWith('DONE') || document.title.startsWith('ERROR'), { timeout: 20000 });
      const pageTitle = await page.title();
      if (pageTitle.startsWith('ERROR')) {
        throw new Error('PDF render failed: ' + pageTitle);
      }
      imgBuffer = await page.screenshot({ type: 'png', fullPage: true });
      await browser.close();
      browser = null;
    } else {
      // Strip data URI prefix for images
      const base64Clean = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      imgBuffer = Buffer.from(base64Clean, 'base64');
    }

    console.log('OCR: processing image buffer, size:', imgBuffer.length);
    const { data: { text } } = await Tesseract.recognize(imgBuffer, 'por', {
      logger: (m) => { if (m.status === 'recognizing text') console.log('OCR progress:', Math.round((m.progress || 0) * 100) + '%'); },
    });

    console.log('OCR raw text length:', text.length);
    console.log('OCR raw text (first 500):', text.substring(0, 500));
    const result = parseCNHText(text);
    result.rawText = text.substring(0, 1000); // Send raw text for debugging
    console.log('OCR parsed result:', JSON.stringify(result));
    res.json(result);
  } catch (err) {
    console.error('OCR error:', err.message);
    res.status(500).json({ error: 'Erro ao processar CNH: ' + err.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

function parseCNHText(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const full = lines.join(' ');
  const result = { nome: '', cpf: '', rg: '', dataNascimento: '', nacionalidade: 'brasileiro(a)' };

  // ── Strategy 0: CNH Digital (has "CARTEIRA NACIONAL" or "HABILITAÇÃO" or "SENATRAN") ──
  const isCNH = /CARTEIRA\s*NACIONAL|HABILITA[ÇC][ÃA]O|SENATRAN|DRIVER\s*LICENSE/i.test(full);

  if (isCNH) {
    // CNH format: numbered fields like "1 NOME E SOBRENOME" followed by value in brackets or next line
    // The OCR text has patterns like: [ PAULO ROBERTO CONFORTO | 22/01/2013 ]

    // CNH OCR produces lines like:
    // Line: [ PAULO ROBERTO CONFORTO | 22/01/2013 |
    // Line: [ 12/09/1994, SAO PAULO, SP |
    // Line: [ 44043746 SSP SP )
    // Line: [ 409.293.808-00 | 05693495617 |
    // Line: [ BRASILEIRO |

    // Nome: line after "NOME E SOBRENOME", value in [ ... | ]
    const nomeMatch = full.match(/NOME\s+E\s+SOBRENOME[^[]*\[\s*([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ\s]+?)\s*\|/i);
    if (nomeMatch) {
      result.nome = titleCase(nomeMatch[1].trim());
    } else {
      // Broader fallback: first bracketed ALL-CAPS text that's not a header
      const excluded = /REPUBLICA|MINISTERIO|SECRETARIA|CARTEIRA|NACIONAL|HABILITAÇÃO|DRIVER|LICENSE|PERMISO|TRANSITO|SENATRAN|TRANSPORTES/i;
      for (const line of lines) {
        const m = line.match(/\[\s*([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ\s]{5,60}?)\s*\|/);
        if (m && !excluded.test(m[1])) {
          result.nome = titleCase(m[1].trim());
          break;
        }
      }
    }

    // Data Nascimento: after "NASCIMENTO" ... [ DD/MM/YYYY
    const nascMatch = full.match(/NASCIMENTO[\s\S]*?\[\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (nascMatch) {
      result.dataNascimento = nascMatch[1];
    }

    // Doc Identidade / RG: after "DOC IDENTIDADE" ... [ 44043746 SSP SP ]
    const rgMatch = full.match(/DOC\s*IDENTIDADE[\s\S]*?\[\s*(\d[\d.\-\s]{3,15}\d)/i);
    if (rgMatch) {
      result.rg = rgMatch[1].replace(/\s+/g, '').trim();
    }

    // CPF + Registro: line like [ 409.293.808-00 | 05693495617 ]
    // The first number is CPF, second is registro CNH
    // Look for the REGISTRO line which has both CPF and registro
    const regLine = full.match(/REGISTRO[\s\S]*?\[\s*(\d{3}[\.\s]*\d{3}[\.\s]*\d{3}[\-\s]*\d{2})/i);
    if (regLine) {
      const digits = regLine[1].replace(/\D/g, '');
      if (digits.length === 11) {
        result.cpf = `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9)}`;
      }
    } else {
      // Fallback: any 000.000.000-00 pattern
      const cpfAny = full.match(/(\d{3}[\.\s]*\d{3}[\.\s]*\d{3}[\-\s]*\d{2})/);
      if (cpfAny) {
        const digits = cpfAny[1].replace(/\D/g, '');
        if (digits.length === 11) {
          result.cpf = `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9)}`;
        }
      }
    }

    // Nacionalidade: line after "NACIONALIDADE", value in [ BRASILEIRO ]
    const nacMatch = full.match(/NACIONALIDADE[\s\S]*?\[\s*(BRASILEIR[OA])/i);
    if (nacMatch) {
      result.nacionalidade = nacMatch[1].toLowerCase() === 'brasileiro' ? 'brasileiro' : 'brasileira';
    }

    return result;
  }

  // ── Strategy 1: Detect if this is a contract document (has "CONTRATO" or "Pelo presente") ──
  const isContract = /contrato|pelo presente instrumento/i.test(full);

  if (isContract) {
    // For contracts: extract from the qualification block
    // Pattern: "NAME, brasileiro(a), estado_civil, profissao, RG: xxx, CPF: xxx, e-mail: xxx"
    // The name is in ALL CAPS before "brasileiro" or "brasileira"
    const qualMatch = full.match(/([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ\s]{3,50}),\s*brasileir[oa]/);
    if (qualMatch) {
      result.nome = titleCase(qualMatch[1].trim());
    }

    // CPF after "CPF:" label — allow spaces between digit groups (OCR artifacts)
    const cpfLabeled = full.match(/CPF[:\s]+(\d{3}[\.\s]*\d{3}[\.\s]*\d{3}[\-\s]*\d{2})/i);
    if (cpfLabeled) {
      const digits = cpfLabeled[1].replace(/\D/g, '');
      if (digits.length === 11) {
        result.cpf = `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9)}`;
      }
    }

    // RG after "RG:" label
    const rgLabeled = full.match(/RG[:\s]+([0-9][0-9.\-\/\s]{3,14}[0-9])/i);
    if (rgLabeled) {
      result.rg = rgLabeled[1].trim().replace(/\s+/g, '');
    }

    // Nacionalidade from text
    if (/brasileira/i.test(full.substring(0, full.indexOf('CPF') > 0 ? full.indexOf('CPF') : 500))) {
      result.nacionalidade = 'brasileira';
    } else if (/brasileiro/i.test(full.substring(0, full.indexOf('CPF') > 0 ? full.indexOf('CPF') : 500))) {
      result.nacionalidade = 'brasileiro';
    }

    // Email
    const emailMatch = full.match(/e-?mail[:\s]+([^\s,]+@[^\s,]+)/i);
    if (emailMatch) result.email = emailMatch[1].replace(/[()]/g, '');

    // Estado civil
    const ecMatch = full.match(/brasileir[oa],\s*(solteiro|casado|divorciado|viúvo|união\s*estável|solteira|casada|divorciada|viúva)/i);
    if (ecMatch) result.estadoCivil = titleCase(ecMatch[1]);

    // Profissao
    const profMatch = full.match(/(?:solteiro|casado|divorciado|viúvo|solteira|casada|divorciada|viúva|união\s*estável)\s*[,]\s*([a-záéíóúâêîôûãõç\s]{3,30})\s*[,]/i);
    if (profMatch) result.profissao = profMatch[1].trim();

    // Endereco
    const endMatch = full.match(/(?:residente|domiciliad[oa])\s+(?:e\s+domiciliad[oa]\s+)?(?:na|no|à)\s+(.+?),\s*(?:no\s+bairro|bairro)/i);
    if (endMatch) result.endereco = endMatch[1].trim();

    // Bairro
    const bairroMatch = full.match(/bairro\s+([^,]+)/i);
    if (bairroMatch) result.bairro = bairroMatch[1].trim();

    // Cidade/UF
    const cidadeMatch = full.match(/cidade\s+(?:de\s+)?([^\/]+)\/([A-Z]{2})/i);
    if (cidadeMatch) {
      result.cidade = cidadeMatch[1].trim();
      result.uf = cidadeMatch[2].toUpperCase();
    }

    // CEP
    const cepMatch = full.match(/CEP[:\s]+(\d{5}[\-\s]?\d{3})/i);
    if (cepMatch) {
      const cepDigits = cepMatch[1].replace(/\D/g, '');
      result.cep = `${cepDigits.slice(0,5)}-${cepDigits.slice(5)}`;
    }

  } else {
    // ── Strategy 2: CNH / generic document ──

    // CPF: 000.000.000-00 or with spaces
    const cpfMatch = full.match(/\d{3}[\.\s]?\d{3}[\.\s]?\d{3}[\-\s]?\d{2}/);
    if (cpfMatch) {
      const digits = cpfMatch[0].replace(/\D/g, '');
      if (digits.length === 11) {
        result.cpf = `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9)}`;
      }
    }

    // RG near label
    const rgMatch = full.match(/(?:RG|DOC\.?\s*IDENTIDADE|IDENTIDADE|Registro\s*Geral)[:\s]*([0-9][0-9.\-\/\s]{4,14}[0-9])/i);
    if (rgMatch) {
      result.rg = rgMatch[1].trim();
    }

    // Nome near label or first long ALL-CAPS
    const nomeMatch = full.match(/NOME[:\s]+([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ\s]{5,60})/i);
    if (nomeMatch) {
      result.nome = titleCase(nomeMatch[1].trim());
    } else {
      // Filter out common headers
      const excluded = /contrato|prestação|honorários|advocatícios|procuração|instrumento|serviços|rescisão|multipropriedade|resort/i;
      const nameLines = lines
        .filter(l => /^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ\s]{8,}$/.test(l) && l.split(/\s+/).length >= 2 && !excluded.test(l));
      if (nameLines.length > 0) {
        nameLines.sort((a, b) => b.length - a.length);
        result.nome = titleCase(nameLines[0]);
      }
    }

    // Data Nascimento
    const dateMatch = full.match(/(?:NASC|NASCIMENTO|DATA\s*DE\s*NASCIMENTO|D\.?\s*NASC)[:\s.]*(\d{2}[\/.]\d{2}[\/.]\d{4})/i);
    if (dateMatch) {
      result.dataNascimento = dateMatch[1].replace(/\./g, '/');
    } else {
      const dates = full.match(/\d{2}\/\d{2}\/\d{4}/g);
      if (dates) {
        const birthDate = dates.find(d => {
          const year = parseInt(d.split('/')[2]);
          return year > 1930 && year < new Date().getFullYear() - 16;
        });
        if (birthDate) result.dataNascimento = birthDate;
      }
    }

    // Gender
    const sexMatch = full.match(/SEXO[:\s]*(F|M|FEM|MASC|FEMININO|MASCULINO)/i);
    if (sexMatch) {
      const sex = sexMatch[1].toUpperCase();
      if (sex.startsWith('F')) result.nacionalidade = 'brasileira';
      else if (sex.startsWith('M')) result.nacionalidade = 'brasileiro';
    }
  }

  return result;
}

function titleCase(str) {
  const lower = ['de', 'da', 'do', 'das', 'dos', 'e'];
  return str.toLowerCase().split(/\s+/).map((w, i) => {
    if (i > 0 && lower.includes(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

// Generate PDF from HTML and send to ZapSign
app.post('/api/zapsign/create', async (req, res) => {
  const { apiToken, html, name, resort, signers, sandbox } = req.body;

  if (!apiToken) return res.status(400).json({ error: 'API Token é obrigatório' });
  if (!html) return res.status(400).json({ error: 'HTML do contrato é obrigatório' });

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();

    const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <style>
        @page { size: A4; margin: 2.5cm; }
        body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.8; text-align: justify; color: #000; margin: 0; padding: 0; }
        h2 { font-size: 14pt; }
        p { margin: 8px 0; }
        strong { font-weight: bold; }
        .page-break { page-break-before: always; }
      </style></head><body>${html}</body></html>`;

    await page.setContent(fullHtml, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: { top: '2.5cm', bottom: '2.5cm', left: '2.5cm', right: '2.5cm' },
      printBackground: true,
    });

    await browser.close();
    browser = null;

    const base64Pdf = Buffer.from(pdfBuffer).toString('base64');

    const timestamp = Date.now();
    const zapBody = {
      name: name || `Contrato CBC - ${timestamp}`,
      base64_pdf: base64Pdf,
      lang: 'pt-br',
      disable_signer_emails: false,
      brand_primary_color: '#0f1c3f',
      external_id: `cbc-${timestamp}`,
      folder_path: '/CBC Contratos/',
      signers: signers || [],
    };

    console.log('Sending to ZapSign, body size:', JSON.stringify(zapBody).length, 'pdf base64 length:', base64Pdf.length);

    const baseUrl = sandbox ? 'https://sandbox.api.zapsign.com.br' : 'https://api.zapsign.com.br';
    const zapUrl = `${baseUrl}/api/v1/docs/?api_token=${apiToken}`;
    console.log('ZapSign URL:', baseUrl, 'Sandbox:', !!sandbox);

    const zapResp = await fetch(zapUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(zapBody),
    });

    const zapText = await zapResp.text();
    console.log('ZapSign response status:', zapResp.status, 'body:', zapText.substring(0, 500));

    let zapData;
    try {
      zapData = JSON.parse(zapText);
    } catch {
      return res.status(500).json({ error: `ZapSign retornou resposta inválida (${zapResp.status}): ${zapText.substring(0, 300)}` });
    }

    if (!zapResp.ok) {
      return res.status(zapResp.status).json({
        error: zapData.detail || zapData.message || JSON.stringify(zapData),
      });
    }

    const signersResult = (zapData.signers || []).map(s => ({
      name: s.name, email: s.email, token: s.token,
      sign_url: s.sign_url || s.signing_link || `https://app.zapsign.com.br/verificar/${s.token}`,
      status: s.status,
    }));

    res.json({
      token: zapData.token, name: zapData.name, status: zapData.status,
      external_id: zapData.external_id, signers: signersResult,
    });

  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

// CEP lookup via ViaCEP
app.get('/api/cep/:cep', async (req, res) => {
  const cep = req.params.cep.replace(/\D/g, '');
  if (cep.length !== 8) return res.status(400).json({ error: 'CEP inválido' });
  try {
    const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const data = await resp.json();
    if (data.erro) return res.status(404).json({ error: 'CEP não encontrado' });
    res.json({
      rua: data.logradouro || '',
      bairro: data.bairro || '',
      cidade: data.localidade || '',
      uf: data.uf || '',
      complemento: data.complemento || '',
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao consultar CEP' });
  }
});

// CPF validation
app.get('/api/cpf/validate/:cpf', (req, res) => {
  const cpf = req.params.cpf.replace(/\D/g, '');
  if (cpf.length !== 11) return res.json({ valid: false });

  // Check for known invalid patterns
  if (/^(\d)\1{10}$/.test(cpf)) return res.json({ valid: false });

  // Validate check digits
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i]) * (10 - i);
  let d1 = 11 - (sum % 11);
  if (d1 >= 10) d1 = 0;
  if (parseInt(cpf[9]) !== d1) return res.json({ valid: false });

  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i]) * (11 - i);
  let d2 = 11 - (sum % 11);
  if (d2 >= 10) d2 = 0;
  if (parseInt(cpf[10]) !== d2) return res.json({ valid: false });

  res.json({ valid: true });
});

// CPF lookup via cpfcnpj.com.br
// Pacote 7 (CPF B): nome + nascimento — R$0.25/consulta
const CPF_API_TOKEN = process.env.CPF_API_TOKEN || '5ae973d7a997af13f0aaf2bf60e65803';
const CPF_PACOTE = '7'; // Pacote 7 = CPF B (nome + nascimento)
app.get('/api/cpf/:cpf', async (req, res) => {
  const cpf = req.params.cpf.replace(/\D/g, '');
  if (cpf.length !== 11) return res.status(400).json({ error: 'CPF inválido' });
  try {
    const url = `https://api.cpfcnpj.com.br/${CPF_API_TOKEN}/${CPF_PACOTE}/${cpf}`;
    console.log('CPF API request:', url.replace(CPF_API_TOKEN, '***'));
    const resp = await fetch(url, { timeout: 15000 });
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { return res.json({ valid: true, nome: '' }); }

    console.log('CPF API response:', JSON.stringify(data));

    // Check for errors
    if (!data || data.status === 0) {
      const errCode = data?.['cod-erro'] || data?.erro || '';
      console.log('CPF API error code:', errCode);
      return res.json({ valid: true, nome: '', error: errCode });
    }

    // Filter test token responses
    if (data.nome === 'Test Token') {
      return res.json({ valid: true, nome: 'DADOS DE TESTE - TOKEN DE TESTE', nascimento: '' });
    }

    res.json({
      valid: true,
      nome: data.nome || '',
      nascimento: data.nascimento || '',
    });
  } catch (err) {
    console.error('CPF lookup error:', err.message);
    res.json({ valid: true, nome: '' });
  }
});

// Generate PDF only (for preview/download)
app.post('/api/generate-pdf', async (req, res) => {
  const { html } = req.body;
  if (!html) return res.status(400).json({ error: 'HTML é obrigatório' });

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <style>
        @page { size: A4; margin: 2.5cm; }
        body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.8; text-align: justify; color: #000; margin: 0; padding: 0; }
        h2 { font-size: 14pt; text-align: center; }
        p { margin: 8px 0; }
        strong { font-weight: bold; }
        .page-break { page-break-before: always; }
      </style></head><body>${html}</body></html>`;

    await page.setContent(fullHtml, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: { top: '2.5cm', bottom: '2.5cm', left: '2.5cm', right: '2.5cm' },
      printBackground: true,
    });
    await browser.close();
    browser = null;

    // Count pages by parsing PDF for /Type /Page entries
    const pdfStr = pdfBuffer.toString('latin1');
    const pageMatches = pdfStr.match(/\/Type\s*\/Page[^s]/g);
    const pageCount = pageMatches ? pageMatches.length : 1;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Page-Count', String(pageCount));
    res.setHeader('Access-Control-Expose-Headers', 'X-Page-Count');
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

// ═══════════════════════════════════════════
//  AUDIT LOG
// ═══════════════════════════════════════════
async function logAudit(action, entityType, entityId, details, userEmail) {
  try {
    await supabase.from('audit_log').insert({
      action, entity_type: entityType, entity_id: entityId,
      details, user_email: userEmail || 'sistema',
    });
  } catch (err) { console.error('Audit log error:', err.message); }
}

app.get('/api/audit-log', async (req, res) => {
  try {
    const { entity_id, limit = 50 } = req.query;
    let query = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(Number(limit));
    if (entity_id) query = query.eq('entity_id', entity_id);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════
//  CONTRACT VERSIONING
// ═══════════════════════════════════════════
app.get('/api/contratos/:id/versoes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('contratos_versoes')
      .select('id, version_number, created_at, created_by, change_description')
      .eq('contrato_id', req.params.id)
      .order('version_number', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/contratos/:id/versoes/:vid', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('contratos_versoes')
      .select('*')
      .eq('id', req.params.vid)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Save version when contract is updated
async function saveVersion(contratoId, dados, description, user) {
  try {
    const { data: existing } = await supabase
      .from('contratos_versoes')
      .select('version_number')
      .eq('contrato_id', contratoId)
      .order('version_number', { ascending: false })
      .limit(1);
    const nextVersion = (existing?.[0]?.version_number || 0) + 1;
    await supabase.from('contratos_versoes').insert({
      contrato_id: contratoId,
      version_number: nextVersion,
      created_by: user || 'sistema',
      change_description: description || `Versão ${nextVersion}`,
      dados,
    });
  } catch (err) { console.error('Version save error:', err.message); }
}

// ═══════════════════════════════════════════
//  TAGS
// ═══════════════════════════════════════════
app.put('/api/contratos/:id/tags', async (req, res) => {
  try {
    const { tags } = req.body;
    const { data, error } = await supabase
      .from('contratos')
      .update({ tags: tags || [] })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    await logAudit('tags_updated', 'contrato', req.params.id, { tags });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════
//  CLAUSE LIBRARY
// ═══════════════════════════════════════════
app.get('/api/clausulas-biblioteca', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('clausulas_biblioteca')
      .select('*')
      .order('uso_count', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/clausulas-biblioteca', async (req, res) => {
  try {
    const { titulo, texto, categoria, tags } = req.body;
    if (!titulo || !texto) return res.status(400).json({ error: 'Titulo e texto obrigatórios' });
    const { data, error } = await supabase
      .from('clausulas_biblioteca')
      .insert({ titulo, texto, categoria: categoria || 'geral', tags: tags || [] })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/clausulas-biblioteca/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('clausulas_biblioteca')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════
//  EXCEL EXPORT
// ═══════════════════════════════════════════
app.get('/api/export/contratos', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('contratos')
      .select('id, created_at, nome_contratante1, cpf_contratante1, email_contratante1, nome_contratante2, cpf_contratante2, resort, tipo_acao, honorarios_total, honorarios_parcelas, honorarios_valor_parcela, honorarios_percentual_exito, data_primeira_parcela, status, zapsign_doc_token')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════
//  DAILY BACKUP (cron job)
// ═══════════════════════════════════════════
const BACKUP_DIR = path.join(__dirname, '..', 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

cron.schedule('0 3 * * *', async () => {
  console.log('Running daily backup...');
  try {
    const { data: contratos } = await supabase.from('contratos').select('*');
    const { data: clausulas } = await supabase.from('clausulas_biblioteca').select('*');
    const { data: audit } = await supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(1000);
    const backup = { timestamp: new Date().toISOString(), contratos, clausulas, audit };
    const filename = `backup_${new Date().toISOString().split('T')[0]}.json`;
    fs.writeFileSync(path.join(BACKUP_DIR, filename), JSON.stringify(backup, null, 2));
    console.log(`Backup saved: ${filename}`);
    // Upload to S3 if configured
    await uploadToS3(filename, backup);
    // Keep only last 30 backups
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('backup_')).sort();
    while (files.length > 30) { fs.unlinkSync(path.join(BACKUP_DIR, files.shift())); }
  } catch (err) { console.error('Backup error:', err.message); }
});

// Manual backup trigger
app.post('/api/backup', async (req, res) => {
  try {
    const { data: contratos } = await supabase.from('contratos').select('*');
    const backup = { timestamp: new Date().toISOString(), contratos, total: contratos?.length || 0 };
    const filename = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(path.join(BACKUP_DIR, filename), JSON.stringify(backup, null, 2));
    const s3ok = await uploadToS3(filename, backup);
    await logAudit('backup_manual', 'sistema', null, { filename, total: backup.total, s3: !!s3ok });
    res.json({ ok: true, filename, total: backup.total, s3: !!s3ok });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════
//  ASAAS BILLING INTEGRATION
// ═══════════════════════════════════════════
app.post('/api/asaas/create-billing', async (req, res) => {
  const { apiKey, customer, contrato } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'ASAAS API Key obrigatória' });
  if (!customer?.name || !customer?.cpf) return res.status(400).json({ error: 'Nome e CPF do cliente obrigatórios' });

  const hon = contrato?.honorarios || {};
  const baseUrl = req.body.sandbox ? 'https://sandbox.asaas.com/api/v3' : 'https://api.asaas.com/v3';
  const headers = { 'Content-Type': 'application/json', 'access_token': apiKey };

  try {
    // 1. Create or find customer
    const custResp = await fetch(`${baseUrl}/customers`, {
      method: 'POST', headers,
      body: JSON.stringify({
        name: customer.name,
        cpfCnpj: customer.cpf.replace(/\D/g, ''),
        email: customer.email || undefined,
      }),
    });
    const custData = await custResp.json();
    const customerId = custData.id || custData.object?.id;
    if (!customerId) return res.status(400).json({ error: 'Erro ao criar cliente no ASAAS', detail: custData });

    // 2. Create installment billing
    const parcelas = hon.parcelas || 10;
    const valor = hon.valorParcela || 300;
    const dataInicio = hon.dataPrimeiraParcela || new Date().toISOString().split('T')[0];

    const billingResp = await fetch(`${baseUrl}/payments`, {
      method: 'POST', headers,
      body: JSON.stringify({
        customer: customerId,
        billingType: 'BOLETO',
        value: valor,
        dueDate: dataInicio,
        description: `Honorários - ${contrato?.resort || 'Contrato CBC'}`,
        installmentCount: parcelas,
        installmentValue: valor,
        externalReference: contrato?.id || `cbc-${Date.now()}`,
      }),
    });
    const billingData = await billingResp.json();
    if (!billingResp.ok) return res.status(400).json({ error: 'Erro ao criar cobrança', detail: billingData });

    await logAudit('asaas_billing_created', 'contrato', contrato?.id, { customerId, parcelas, valor });
    res.json({ ok: true, customerId, billing: billingData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
//  NOTIFICATIONS (SSE for push)
// ═══════════════════════════════════════════
const sseClients = new Set();

app.get('/api/notifications/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function broadcastNotification(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => { try { client.write(msg); } catch {} });
}

// ═══════════════════════════════════════════
//  PRE-SEND CHECKLIST
// ═══════════════════════════════════════════
app.post('/api/checklist/validate', (req, res) => {
  const d = req.body;
  const issues = [];
  const c1 = d.contratantes?.[0] || {};
  const c2 = d.numContratantes >= 2 ? d.contratantes?.[1] : null;

  // Check contratante 1
  if (!c1.nome) issues.push({ field: 'nome', msg: 'Nome do Contratante 1 não preenchido' });
  if (!c1.cpf || c1.cpf.replace(/\D/g, '').length !== 11) issues.push({ field: 'cpf', msg: 'CPF do Contratante 1 inválido' });
  if (!c1.email || !c1.email.includes('@')) issues.push({ field: 'email', msg: 'E-mail do Contratante 1 inválido' });
  if (!c1.rg) issues.push({ field: 'rg', msg: 'RG do Contratante 1 não preenchido' });
  if (!c1.endereco) issues.push({ field: 'endereco', msg: 'Endereço do Contratante 1 não preenchido' });
  if (!c1.cep) issues.push({ field: 'cep', msg: 'CEP do Contratante 1 não preenchido' });
  if (!c1.estadoCivil) issues.push({ field: 'estadoCivil', msg: 'Estado civil do Contratante 1 não selecionado' });
  if (!c1.profissao) issues.push({ field: 'profissao', msg: 'Profissão do Contratante 1 não preenchida' });

  // Check contratante 2
  if (c2) {
    if (!c2.nome) issues.push({ field: 'nome2', msg: 'Nome do Contratante 2 não preenchido' });
    if (!c2.cpf || c2.cpf.replace(/\D/g, '').length !== 11) issues.push({ field: 'cpf2', msg: 'CPF do Contratante 2 inválido' });
    if (!c2.email || !c2.email.includes('@')) issues.push({ field: 'email2', msg: 'E-mail do Contratante 2 inválido' });
  }

  // Check resort
  if (!d.resort) issues.push({ field: 'resort', msg: 'Resort não selecionado' });
  if (d.resort === 'outro' && !d.resortCustom) issues.push({ field: 'resort', msg: 'Nome do resort personalizado não preenchido' });

  // Check tipo acao
  if (!d.tipoAcao) issues.push({ field: 'tipoAcao', msg: 'Tipo de ação não selecionado' });

  // Check honorarios
  const hon = d.honorarios || {};
  if (!hon.total || hon.total <= 0) issues.push({ field: 'honorarios', msg: 'Valor dos honorários não definido' });
  if (!hon.dataPrimeiraParcela) issues.push({ field: 'dataParcela', msg: 'Data da primeira parcela não definida' });
  if (!hon.percentualExito || hon.percentualExito <= 0) issues.push({ field: 'exito', msg: 'Percentual de êxito não definido' });

  res.json({ valid: issues.length === 0, issues });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
