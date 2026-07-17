/**
 * Worker background (ate 15 min): backup diario do banco -> Google Drive.
 *
 * Exporta as tabelas da whitelist (RPC backup_dump, paginas de 1000, padrao
 * BOT_RPC_SECRET) num JSON por dia, comprime (gzip) e sobe via Apps Script
 * (mesmo canal do save-to-drive) na pasta "Backups Sistema CBC" (dentro de
 * "Paulo 2", a arvore de contratos — o Apps Script ja tem permissao la).
 * So entram tabelas NAO re-geraveis; espelhos (asaas/bi/meta/kommo) ficam fora
 * e voltam por backfill. Divide em partes se o arquivo do dia crescer demais.
 *
 * Resultado (ok ou erro) em bot_config.backup_status + logs no console da
 * function. Retencao: sem limpeza automatica na v1 (o Apps Script nao apaga
 * arquivo) — ~1-2 MB/dia, revisar a pasta 1x/ano.
 */

import { gzipSync } from 'node:zlib';
import { db } from './_lib/botDb.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const PANEL_KEY = process.env.BOT_PANEL_KEY || 'cbc-bot-2026';
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbzEzt-t_GDTbUKrzxTLkdOMqYS0Hz_PWcYt7uBcbj7yoKqKdUr89So8gRmsVwhT0cpI5Q/exec';
const BACKUP_FOLDER_ID = process.env.BACKUP_DRIVE_FOLDER_ID || '14ChK5zjMNeG9hdFAW_rSO-yRlvBFbuk4';

const PAGINA = 1000;                            // teto do PostgREST por request
const MAX_JSON_POR_PARTE = 24 * 1024 * 1024;    // ~24 MB de JSON bruto por arquivo (gz+b64 fica << 45 MB do Apps Script)
const JSONH = { 'Content-Type': 'application/json' };

async function dumpTabela(nome) {
  const linhas = [];
  for (let offset = 0; ; offset += PAGINA) {
    const { data, error } = await db.rpc('backup_dump', {
      p_chave: RPC_SECRET, p_tabela: nome, p_offset: offset, p_limit: PAGINA,
    });
    if (error) throw new Error(`backup_dump ${nome}@${offset}: ${error.message}`);
    const pagina = Array.isArray(data) ? data : [];
    linhas.push(...pagina);
    if (pagina.length < PAGINA) break;
    if (offset >= 200000) throw new Error(`backup_dump ${nome}: passou de 200k linhas — revisar whitelist`);
  }
  return linhas;
}

/** POST -> 302 -> GET (o Apps Script sempre redireciona), com 2 retentativas p/ falha temporaria. */
async function appsScriptUpload(payload, tentativa = 0) {
  try {
    const post = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
      redirect: 'manual',
      signal: AbortSignal.timeout(120000),
    });
    let texto;
    if (post.status === 301 || post.status === 302) {
      const destino = post.headers.get('location');
      if (!destino) throw new Error('Apps Script: redirect sem URL');
      const get = await fetch(destino, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
      texto = await get.text();
    } else {
      texto = await post.text();
      if (post.status >= 500) {
        const e = new Error(`Apps Script HTTP ${post.status}: ${texto.slice(0, 200)}`);
        e.transient = true;
        throw e;
      }
    }
    const json = JSON.parse(texto);
    if (!json.success) throw new Error(`Apps Script recusou: ${json.error || texto.slice(0, 200)}`);
    return json;
  } catch (e) {
    const temporario = e?.transient === true || e?.name === 'TimeoutError' || e?.name === 'TypeError'
      || /timeout|abort|network|fetch failed|ECONN|ETIMEDOUT/i.test(e?.message || '');
    if (temporario && tentativa < 2) {
      await new Promise(r => setTimeout(r, [2000, 5000][tentativa]));
      return appsScriptUpload(payload, tentativa + 1);
    }
    throw e;
  }
}

async function gravaStatus(status) {
  try {
    await db.from('bot_config').upsert({ key: 'backup_status', value: status, updated_at: new Date().toISOString() });
  } catch (e) {
    console.error('backup: falha ao gravar backup_status:', e.message);
  }
}

export default async (req) => {
  const key = req.headers.get('x-bot-key') || '';
  if (key !== PANEL_KEY) return new Response('unauthorized', { status: 401 });
  const body = await req.json().catch(() => ({}));

  const inicio = Date.now();
  const hoje = new Date().toISOString().slice(0, 10);
  try {
    const { data: lista, error } = await db.rpc('backup_tabelas', { p_chave: RPC_SECRET });
    if (error) throw new Error(`backup_tabelas: ${error.message}`);
    if (!Array.isArray(lista) || !lista.length) throw new Error('backup_tabelas voltou vazia');

    // Dump tabela a tabela, fechando uma "parte" quando o JSON acumulado cresce demais.
    const partes = [];
    let atual = { tabelas: {}, bytes: 0 };
    const contagens = {};
    let totalLinhas = 0;
    for (const { tabela } of lista) {
      const linhas = await dumpTabela(tabela);
      contagens[tabela] = linhas.length;
      totalLinhas += linhas.length;
      const tam = JSON.stringify(linhas).length;
      if (atual.bytes > 0 && atual.bytes + tam > MAX_JSON_POR_PARTE) {
        partes.push(atual);
        atual = { tabelas: {}, bytes: 0 };
      }
      atual.tabelas[tabela] = linhas;
      atual.bytes += tam;
    }
    partes.push(atual);

    // Comprime e sobe cada parte (1 chamada Apps Script por arquivo).
    const arquivos = [];
    for (let i = 0; i < partes.length; i++) {
      const nome = partes.length === 1
        ? `cbc-backup-${hoje}.json.gz`
        : `cbc-backup-${hoje}_p${i + 1}de${partes.length}.json.gz`;
      const envelope = {
        versao: 1,
        origem: 'cbc-contratos',
        gerado_em: new Date().toISOString(),
        parte: i + 1,
        total_partes: partes.length,
        contagens,
        tabelas: partes[i].tabelas,
      };
      const gz = gzipSync(Buffer.from(JSON.stringify(envelope)), { level: 9 });
      const b64 = gz.toString('base64');
      if (b64.length > 45 * 1024 * 1024) throw new Error(`${nome}: base64 com ${b64.length} bytes — acima do teto do Apps Script`);
      const resp = await appsScriptUpload({
        folderId: BACKUP_FOLDER_ID,
        files: [{ name: nome, base64: b64, mimeType: 'application/gzip' }],
      });
      arquivos.push({ name: nome, fileId: resp.files?.[0]?.fileId || null, kb: Math.round(gz.length / 1024) });
      console.log(`backup: ${nome} ok (${Math.round(gz.length / 1024)} KB)`);
    }

    const status = {
      ok: true,
      data: hoje,
      quando: new Date().toISOString(),
      origem: body.origem || 'desconhecida',
      tabelas: lista.length,
      linhas: totalLinhas,
      arquivos,
      duracao_s: Math.round((Date.now() - inicio) / 1000),
    };
    await gravaStatus(status);
    console.log(`backup diario OK: ${lista.length} tabelas, ${totalLinhas} linhas, ${arquivos.length} arquivo(s), ${status.duracao_s}s`);
    return new Response(JSON.stringify(status), { status: 200, headers: JSONH });
  } catch (e) {
    console.error('backup diario FALHOU:', e.message);
    await gravaStatus({ ok: false, data: hoje, quando: new Date().toISOString(), erro: e.message });
    return new Response(JSON.stringify({ ok: false, erro: e.message }), { status: 500, headers: JSONH });
  }
};
