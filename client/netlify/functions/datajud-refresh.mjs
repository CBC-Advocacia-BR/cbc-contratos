/**
 * Scheduled: popula peticao_distribuida_em consultando o DataJud (CNJ).
 * Fonte: https://api-publica.datajud.cnj.jus.br
 *
 * Fluxo:
 *  1. Busca contratos assinados sem peticao_distribuida_em
 *  2. Para cada um, obtem o advbox_process_number. Se nao houver, busca no
 *     ADVBOX via advbox_lawsuit_id e atualiza.
 *  3. Parseia o numero CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO) e deduz o alias do tribunal
 *  4. Consulta DataJud -> dataAjuizamento (formato YYYYMMDDHHMMSS)
 *  5. Fallback: se DataJud nao tiver, tenta process_date do ADVBOX
 *  6. Salva peticao_distribuida_em e advbox_process_number
 *
 * Roda 1x/dia (08 BRT). Tambem invocavel via POST manual.
 * (Reduzido de 3x para 1x/dia em 14/04/2026 para economizar bandwidth.)
 */
import { createClient } from '@supabase/supabase-js';
import { logAdvbox, heartbeat } from './_lib/botDb.mjs';

const ADVBOX_TOKEN = process.env.ADVBOX_TOKEN;
const ADVBOX_URL = 'https://app.advbox.com.br/api/v1';
const ADVBOX_HEADERS = {
  'Authorization': `Bearer ${ADVBOX_TOKEN}`,
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (CBC-Contratos)',
};

// Chave publica do DataJud (documentada pelo CNJ)
const DATAJUD_KEY = 'APIKey cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const DATAJUD_HEADERS = { 'Authorization': DATAJUD_KEY, 'Content-Type': 'application/json' };

const SUPABASE_URL = 'https://vygczeepvoyaehfchxko.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5Z2N6ZWVwdm95YWVoZmNoeGtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMjgxNDYsImV4cCI6MjA4OTcwNDE0Nn0.dFk9CC48V1SlDuFNmtJOkfKf6LSz46aUg6Mpbd7xUjo';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const SELF_URL = process.env.URL || 'https://contratos-cbc.netlify.app';

// UF por codigo TR do CNJ
const STATE = { '01':'ac','02':'al','03':'ap','04':'am','05':'ba','06':'ce','07':'df','08':'es','09':'go','10':'ma','11':'mt','12':'ms','13':'mg','14':'pa','15':'pb','16':'pr','17':'pe','18':'pi','19':'rj','20':'rn','21':'rs','22':'ro','23':'rr','24':'sc','25':'se','26':'sp','27':'to' };

// numero CNJ -> alias do DataJud (tjsp, trf3, trt2, ...)
function tribunalAlias(num) {
  if (!num) return null;
  // NNNNNNN-DD.AAAA.J.TR.OOOO
  const m = String(num).replace(/\D/g, '');
  if (m.length < 20) return null;
  const J = m.substring(13, 14);
  const TR = m.substring(14, 16);
  if (J === '8') return STATE[TR] ? `tj${STATE[TR]}` : null;
  if (J === '5') return `trt${parseInt(TR, 10)}`;
  if (J === '4') return `trf${parseInt(TR, 10)}`;
  if (J === '6') return STATE[TR] ? `tre-${STATE[TR]}` : null;
  if (J === '3') return 'stj';
  return null;
}

// 'YYYYMMDDHHMMSS' ou ISO -> 'YYYY-MM-DD'
function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw);
  if (/^\d{14}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

async function datajudLookup(processNumber) {
  const alias = tribunalAlias(processNumber);
  if (!alias) return { alias: null, date: null, source: null };
  const clean = String(processNumber).replace(/\D/g, '');
  const url = `https://api-publica.datajud.cnj.jus.br/api_publica_${alias}/_search`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: DATAJUD_HEADERS,
      body: JSON.stringify({ query: { match: { numeroProcesso: clean } } }),
    });
    if (!r.ok) return { alias, date: null, source: null };
    const j = await r.json();
    const hits = j?.hits?.hits || [];
    if (!hits.length) return { alias, date: null, source: null };
    const src = hits[0]._source || {};
    const date = parseDate(src.dataAjuizamento);
    return { alias, date, source: date ? 'datajud' : null };
  } catch {
    return { alias, date: null, source: null };
  }
}

async function advboxLawsuit(id) {
  try {
    const r = await fetch(`${ADVBOX_URL}/lawsuits/${id}`, { headers: ADVBOX_HEADERS });
    if (!r.ok) return null;
    const j = await r.json();
    return j.data || j;
  } catch { return null; }
}

// Tarefa "JUNTAR CUSTAS" e auto-criada pelo ADVBOX quando "DISTRIBUIR ACAO"
// e concluida. Usamos created_at dela como proxy da distribuicao quando
// process_date nao foi preenchido manualmente no ADVBOX.
async function advboxDistributionFromTasks(lawsuitId) {
  try {
    const r = await fetch(`${ADVBOX_URL}/posts?lawsuit_id=${lawsuitId}&limit=100`, { headers: ADVBOX_HEADERS });
    if (!r.ok) return null;
    const j = await r.json();
    const tasks = j.data || [];
    // Prioridade 1: tarefa contendo "CUSTAS" (JUNTAR CUSTAS / PAGAR CUSTAS)
    const custasTasks = tasks.filter(t => /CUSTAS/i.test(t.task || ''))
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    if (custasTasks.length) return parseDate(custasTasks[0].created_at);
    // Prioridade 2: tarefas pos-distribuicao conhecidas
    const postDist = tasks.filter(t => /ACOMPANHAR PAGAMENTO|REVISAR INICIAL|JUNTAR DOCUMENTOS|PROTOCOLAR/i.test(t.task || ''))
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    if (postDist.length) return parseDate(postDist[0].created_at);
    return null;
  } catch { return null; }
}

// Stages pos-distribuicao (quando sabemos que a distribuicao ja ocorreu)
function isPostDistributionStage(stage, step) {
  const s = `${stage || ''} ${step || ''}`.toUpperCase();
  return /CUSTAS|JUDICIAL|ANDAMENTO|PROTOCOL|ARQUIV|FINALIZ|CUMPRIMENTO|EXECUCAO|SENTENC/.test(s);
}

async function run() {
  // Processa todos assinados com lawsuit_id (pode ja ter distribuida mas falta signed_at)
  const { data: rows, error } = await supabase
    .from('contratos')
    .select('id, advbox_lawsuit_id, advbox_process_number, peticao_distribuida_em, signed_at, advbox_fase_notificada, contratantes_j:dados->contratantes')
    .eq('status', 'assinado')
    .not('advbox_lawsuit_id', 'is', null)
    // (perf-be 1) nao reprocessa arquivados: caso encerrado nao muda mais de fase
    // nem precisa de backfill — evita o crescimento linear da rotina.
    .is('arquivado_em', null)
    .limit(500);
  if (error) throw new Error(error.message);

  const stats = { checked: 0, datajud_hit: 0, advbox_process_date_hit: 0, advbox_task_hit: 0, still_pending: 0, errors: 0 };

  for (const row of rows || []) {
    stats.checked++;
    try {
      // Sempre busca lawsuit detail para ter process_number, process_date, stage, status_closure
      const ls = row.advbox_lawsuit_id ? await advboxLawsuit(row.advbox_lawsuit_id) : null;
      let procNum = row.advbox_process_number || ls?.process_number || ls?.processNumber || null;
      const advboxProcDate = parseDate(ls?.process_date || ls?.processDate);
      // status_closure e a data de assinatura do contrato (preenchida pelo advbox-sync)
      const sigDate = parseDate(ls?.status_closure);

      // signed_at pode ser persistido sempre (independe da nota).
      if (sigDate && !row.signed_at) {
        await supabase.from('contratos').update({ signed_at: sigDate }).eq('id', row.id);
      }

      // #16: nota no Kommo quando o numero do processo aparece (fonte ADVBOX, mais rapida que DataJud).
      // (#25) so persiste advbox_process_number DEPOIS de confirmar a nota — senao uma falha
      // transitoria na nota perde o aviso p/ sempre (numero ja gravado nao re-dispara o #16).
      // kommo-note e idempotente, entao re-tentar no proximo ciclo nao duplica.
      const procNumNovo = procNum && procNum !== row.advbox_process_number;
      if (procNumNovo) {
        const linkKommo = (row.contratantes_j || []).map(c => c?.linkKommo).find(l => /\/leads\/detail\/\d+/.test(l || ''));
        let notaOk = true; // sem lead p/ notificar -> nada a perder, pode cachear o numero
        if (linkKommo) {
          const dataDist = advboxProcDate || row.peticao_distribuida_em;
          const dataBR = dataDist ? String(dataDist).slice(0, 10).split('-').reverse().join('/') : '—';
          const fase = [ls?.stage, ls?.step].filter(Boolean).join(' / ');
          const texto = ['⚖️ Processo distribuído', `• Número: ${procNum}`, `• Distribuído em: ${dataBR}`, fase ? `• Fase atual: ${fase}` : null].filter(Boolean).join('\n');
          try {
            const r = await fetch(`${SELF_URL}/.netlify/functions/kommo-note`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ linkKommo, marker: 'CBC.processo', text: texto }),
            });
            notaOk = r.ok;
          } catch { notaOk = false; }
        }
        if (notaOk) {
          await supabase.from('contratos').update({ advbox_process_number: procNum }).eq('id', row.id);
        }
      }

      // #1: nota no Kommo quando a FASE do processo muda no ADVBOX (stage/step).
      // "Seed silencioso": na 1a leitura so registra a fase (nao posta) -> evita flood retroativo.
      {
        const faseAtual = [ls?.stage, ls?.step].filter(Boolean).join(' / ');
        if (faseAtual && faseAtual !== row.advbox_fase_notificada) {
          // (varredura 15/06) so avanca advbox_fase_notificada apos o post CONFIRMAR.
          // Antes registrava a fase incondicionalmente: uma falha transitoria no Kommo
          // suprimia a nota daquela fase PARA SEMPRE (Kommo nao deixa apagar/retentar).
          let podeRegistrar = true; // seed (1a leitura) sempre registra, sem postar
          if (row.advbox_fase_notificada) {
            // Ja conheciamos uma fase anterior -> mudanca real -> posta nota
            podeRegistrar = false;
            const linkKommo = (row.contratantes_j || []).map(c => c?.linkKommo).find(l => /\/leads\/detail\/\d+/.test(l || ''));
            if (linkKommo) {
              const texto = ['📁 Andamento do processo', `• Nova fase: ${faseAtual}`, procNum ? `• Processo: ${procNum}` : null].filter(Boolean).join('\n');
              try {
                const resp = await fetch(`${SELF_URL}/.netlify/functions/kommo-note`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ linkKommo, marker: `CBC.fase:${faseAtual}`, text: texto }),
                });
                const j = await resp.json().catch(() => ({}));
                if (j.ok) podeRegistrar = true; // postou OU ja existia -> pode avancar
              } catch { /* falha transitoria -> nao avanca, retenta no proximo ciclo */ }
            } else {
              podeRegistrar = true; // sem link Kommo: nada a postar -> avanca p/ nao reprocessar
            }
          }
          // Seed (1a vez) ou mudanca confirmada: registra a fase atual para nao reprocessar
          if (podeRegistrar) {
            await supabase.from('contratos').update({ advbox_fase_notificada: faseAtual }).eq('id', row.id);
          }
        }
      }

      // Se ja tem peticao_distribuida_em, so atualizamos signed_at e pulamos busca de distribuicao
      if (row.peticao_distribuida_em) continue;

      let date = null;
      let source = null;

      // Prioridade 1: ADVBOX process_date (preenchido manualmente quando alguem atualiza a distribuicao)
      if (advboxProcDate) { date = advboxProcDate; source = 'advbox_process_date'; }

      // Prioridade 2: DataJud (oficial CNJ) — so funciona ~3 meses depois da distribuicao (lag de indexacao)
      if (!date && procNum) {
        const r = await datajudLookup(procNum);
        if (r.date) { date = r.date; source = 'datajud'; }
      }

      // Prioridade 3: ADVBOX tasks — detecta distribuicao pelo created_at da tarefa "JUNTAR CUSTAS"
      // Esta tarefa e criada automaticamente quando "DISTRIBUIR ACAO" e concluida
      if (!date && ls && isPostDistributionStage(ls.stage, ls.step)) {
        const taskDate = await advboxDistributionFromTasks(row.advbox_lawsuit_id);
        if (taskDate) { date = taskDate; source = 'advbox_task'; }
      }

      if (date) {
        await supabase.from('contratos').update({ peticao_distribuida_em: date }).eq('id', row.id);
        if (source === 'datajud') stats.datajud_hit++;
        else if (source === 'advbox_process_date') stats.advbox_process_date_hit++;
        else if (source === 'advbox_task') stats.advbox_task_hit++;
      } else {
        stats.still_pending++;
      }
    } catch (e) {
      stats.errors++;
    }
  }

  return stats;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  try {
    const stats = await run();
    // (observ-3) deixa rastro no banco (aba Monitor) — antes so ia pro console da Netlify
    try {
      await logAdvbox('datajud', stats.errors ? 'aviso' : 'info',
        `DataJud: ${stats.checked} checados, ${stats.datajud_hit + stats.advbox_process_date_hit + stats.advbox_task_hit} distribuicoes novas, ${stats.still_pending} pendentes, ${stats.errors} erros`,
        stats);
    } catch { /* best-effort */ }
    await heartbeat('datajud-refresh', !stats.errors, `${stats.checked} checados, ${stats.errors} erros`); // (observ-2)
    return new Response(JSON.stringify({ success: true, ...stats }), { headers: CORS });
  } catch (err) {
    try { await logAdvbox('datajud', 'erro', `DataJud falhou: ${err.message}`.slice(0, 300), {}); } catch { /* best-effort */ }
    await heartbeat('datajud-refresh', false, err.message); // (observ-2)
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: CORS });
  }
};

export const config = {
  schedule: '0 11 * * *', // 08 BRT (1x/dia - economiza bandwidth)
};
