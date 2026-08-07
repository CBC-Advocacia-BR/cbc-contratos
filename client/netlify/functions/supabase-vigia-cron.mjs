// ─────────────────────────────────────────────────────────────────────────
// VIGIA DO BANCO — detecta queda e reinicia sozinho (06/08/2026, a cada 3 min)
//
// O QUE ACONTECEU QUE JUSTIFICA ISTO
// 06/08/2026, 11h22 BRT: o Postgres travou por exaustao de memoria (maquina Micro, 1 GB,
// ~7 sistemas do escritorio dentro). Como o Auth depende do banco, NENHUM sistema fazia
// login. Ficou 75 minutos fora, e a volta so veio quando alguem reiniciou a mao. Foram
// 75 minutos porque: (a) ninguem foi avisado — o watchdog grava os alertas no proprio
// banco que caiu; (b) nao havia nada que agisse sozinho.
//
// POR QUE ESTA FUNCTION VIVE NA NETLIFY E NAO NO BANCO
// O pg_cron (24 rotinas) roda DENTRO do Postgres: quando ele cai, elas caem junto. Um
// vigia de banco precisa, obrigatoriamente, morar fora dele.
//
// O QUE ELE NAO FAZ, DE PROPOSITO
//  - nao reinicia com uma unica medicao ruim (faz 3, espacadas, na mesma execucao);
//  - nao reinicia se o projeto ja esta em transicao (RESTARTING/COMING_UP);
//  - nao reinicia durante incidente da plataforma Supabase (isso ATRASA a volta — regra
//    do runbook do incidente de 17/07/2026);
//  - nao reinicia em laco (intervalo minimo + teto diario).
// Toda essa decisao mora em `_lib/vigiaSupabase.mjs`, testada isoladamente.
//
// ⚠️ CREDENCIAL: reiniciar exige SUPABASE_ACCESS_TOKEN (Personal Access Token da conta
// Supabase). Esse token da poder TOTAL sobre a conta, inclusive apagar projetos, e a
// Supabase nao oferece token com escopo reduzido. Sem a variavel, o vigia continua
// funcionando em modo VIGILANCIA: detecta, avisa, mas nao reinicia. Foi feito assim para
// que ligar o reinicio automatico seja uma decisao consciente, nao um efeito colateral
// do deploy.
// ─────────────────────────────────────────────────────────────────────────

import { db, heartbeat, logAdvbox } from './_lib/botDb.mjs';
import { decidirReinicio, resumoIncidente, VIGIA_CONFIG } from './_lib/vigiaSupabase.mjs';
import { avisarIncidente, registrarIncidenteNoBanco } from './_lib/avisoResiliente.mjs';

const REF = process.env.SUPABASE_PROJECT_REF || 'vygczeepvoyaehfchxko';
const PAT = process.env.SUPABASE_ACCESS_TOKEN || '';
const API = 'https://api.supabase.com/v1';
const SELF = process.env.URL || 'https://contratos-cbc.netlify.app';

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function mgmt(caminho, init = {}) {
  const r = await fetch(`${API}${caminho}`, {
    ...init,
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`Management API ${caminho}: HTTP ${r.status}`);
  return r.status === 204 ? null : r.json();
}

/**
 * Uma medicao da saude do banco. Prefere a Management API (diz explicitamente se o
 * servico `db` esta de pe). Sem PAT, cai para o REST publico, que tambem revela a queda:
 * com o banco fora o PostgREST devolve 5xx (foi 522 no incidente de 06/08).
 */
async function medir() {
  if (PAT) {
    try {
      const saude = await mgmt(`/projects/${REF}/health?services=db`);
      const dbSvc = (Array.isArray(saude) ? saude : []).find((s) => s.name === 'db');
      if (dbSvc) return { dbSaudavel: dbSvc.healthy === true, erro: dbSvc.error || null };
    } catch (e) {
      // falha ao FALAR com a Management API nao prova que o banco caiu: pode ser a
      // propria API. Nao conta como evidencia de queda.
      return { dbSaudavel: null, erro: `management: ${e.message}` };
    }
  }
  try {
    const url = `${process.env.VITE_SUPABASE_URL || `https://${REF}.supabase.co`}/rest/v1/`;
    const r = await fetch(url, {
      headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY || '' },
      signal: AbortSignal.timeout(20000),
    });
    // 401/200 = gateway e banco respondendo. 5xx = banco fora.
    return { dbSaudavel: r.status < 500, erro: r.status >= 500 ? `REST HTTP ${r.status}` : null };
  } catch (e) {
    return { dbSaudavel: false, erro: `REST: ${e.message}` };
  }
}

/** Ha incidente aberto na plataforma? null quando nao deu para saber. */
async function incidenteNaPlataforma() {
  try {
    const r = await fetch('https://status.supabase.com/api/v2/incidents/unresolved.json', {
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j.incidents) && j.incidents.length > 0;
  } catch {
    return null;
  }
}

/** Estado do vigia. Mora no banco; quando ele esta fora, degradamos com honestidade. */
async function lerEstado() {
  try {
    const { data } = await db.from('bot_config').select('value').eq('key', 'vigia_supabase').maybeSingle();
    const v = data?.value || {};
    const hoje = new Date().toISOString().slice(0, 10);
    return {
      ultimoReinicioIso: v.ultimo_reinicio || null,
      reiniciosHoje: v.dia === hoje ? Number(v.reinicios_hoje) || 0 : 0,
      incidenteAberto: v.incidente_aberto || null,
      lido: true,
    };
  } catch {
    // O caso comum de nao conseguir ler e justamente o banco estar fora. Sem o teto,
    // sobra a trava de status (o projeto fica em RESTARTING/COMING_UP por minutos apos
    // um reinicio, o que ja impede o segundo seguido).
    return { ultimoReinicioIso: null, reiniciosHoje: 0, incidenteAberto: null, lido: false };
  }
}

async function gravarEstado(patch) {
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const atual = await lerEstado();
    await db.from('bot_config').upsert({
      key: 'vigia_supabase',
      value: {
        dia: hoje,
        ultimo_reinicio: patch.ultimoReinicio ?? atual.ultimoReinicioIso,
        reinicios_hoje: patch.somarReinicio ? atual.reiniciosHoje + 1 : atual.reiniciosHoje,
        incidente_aberto: patch.incidenteAberto ?? atual.incidenteAberto,
        atualizado_em: new Date().toISOString(),
      },
    }, { onConflict: 'key' });
  } catch { /* best-effort: nunca derruba o vigia */ }
}

export default async () => {
  const t0 = Date.now();
  const out = { medicoes: [], acao: null, motivo: '', reiniciado: false, canais: null, modo: PAT ? 'ativo' : 'vigilancia' };

  // ── 1) medir 3 vezes, espacado ────────────────────────────────────────
  // As 3 medicoes acontecem DENTRO desta execucao para nao depender de memoria entre
  // execucoes (que e exatamente o que falta quando o banco esta fora).
  const checagens = [];
  for (let i = 0; i < VIGIA_CONFIG.falhasParaAgir; i++) {
    if (i > 0) await dormir(15000);
    const m = await medir();
    checagens.push(m);
    out.medicoes.push(m.dbSaudavel === null ? 'indeterminado' : (m.dbSaudavel ? 'ok' : 'fora'));
    // atalho: primeira medicao boa encerra. Nao ha razao para gastar 30s confirmando
    // saude, e o caminho feliz e 99,9% das execucoes.
    if (m.dbSaudavel === true) break;
  }

  const bancoDePe = checagens.some((c) => c.dbSaudavel === true);

  // ── 2) caminho feliz ──────────────────────────────────────────────────
  if (bancoDePe) {
    const estado = await lerEstado();
    // O banco voltou depois de um incidente que este vigia registrou: e a hora de
    // reconciliar o que ficou para tras enquanto ele esteve fora.
    if (estado.incidenteAberto) {
      await gravarEstado({ incidenteAberto: null });
      await logAdvbox('infra', 'aviso',
        `Banco voltou apos incidente iniciado em ${estado.incidenteAberto}. Disparando reconciliacao.`, {});
      try {
        await fetch(`${SELF}/.netlify/functions/pos-queda-reconciliar`, {
          method: 'POST',
          headers: { 'x-bot-key': process.env.BOT_PANEL_KEY || '', 'Content-Type': 'application/json' },
          body: JSON.stringify({ foraDesde: estado.incidenteAberto }),
          signal: AbortSignal.timeout(20000),
        });
        out.reconciliacao = 'disparada';
      } catch (e) {
        out.reconciliacao = `falhou: ${e.message}`;
        await avisarIncidente({
          titulo: 'Banco voltou, mas a reconciliacao pos-queda NAO disparou',
          detalhe: `Rodar a mao: POST ${SELF}/.netlify/functions/pos-queda-reconciliar. Erro: ${e.message}`,
          severidade: 'critico',
        });
      }
    }
    await heartbeat('supabase-vigia', true, `banco ok (${out.medicoes.join(',')})`);
    out.acao = 'nada';
    out.motivo = 'banco respondendo';
    return new Response(JSON.stringify({ ok: true, ...out, ms: Date.now() - t0 }),
      { headers: { 'Content-Type': 'application/json' } });
  }

  // ── 3) o banco parece fora: reunir o resto do contexto ────────────────
  const [incidentePlataforma, estado] = await Promise.all([incidenteNaPlataforma(), lerEstado()]);

  let statusProjeto = 'desconhecido';
  if (PAT) {
    try { statusProjeto = (await mgmt(`/projects/${REF}`))?.status || 'desconhecido'; } catch { /* fica desconhecido */ }
  }

  const agoraIso = new Date().toISOString();
  const decisao = decidirReinicio({
    checagens,
    statusProjeto,
    incidentePlataforma,
    ultimoReinicioIso: estado.ultimoReinicioIso,
    reiniciosHoje: estado.reiniciosHoje,
    agoraIso,
  });
  out.acao = decisao.acao;
  out.motivo = decisao.motivo;

  // marca o inicio do incidente (para a reconciliacao saber a janela). Best-effort: se o
  // banco esta fora isto falha, e a reconciliacao usa uma janela padrao.
  if (!estado.incidenteAberto) await gravarEstado({ incidenteAberto: agoraIso });

  const titulo = resumoIncidente({ ...decisao, foraDesdeIso: estado.incidenteAberto, agoraIso });
  const detalheBase = [
    `medicoes: ${out.medicoes.join(', ')}`,
    `status do projeto: ${statusProjeto}`,
    `incidente na plataforma: ${incidentePlataforma === null ? 'nao consegui verificar' : incidentePlataforma}`,
    estado.lido ? `reinicios hoje: ${estado.reiniciosHoje}` : 'estado do vigia ilegivel (banco fora): teto diario nao pode ser aplicado',
    ...decisao.incerteza,
  ].join(' | ');

  // ── 4) agir ───────────────────────────────────────────────────────────
  if (decisao.acao === 'reiniciar') {
    if (!PAT) {
      out.acao = 'escalar';
      out.motivo = 'sem SUPABASE_ACCESS_TOKEN: vigia em modo vigilancia, reinicio precisa ser manual';
      const r = await avisarIncidente({
        titulo: 'Banco fora do ar e o reinicio automatico NAO esta ligado',
        detalhe: `${detalheBase} | Reinicie em https://supabase.com/dashboard/project/${REF} ou cadastre SUPABASE_ACCESS_TOKEN para automatizar.`,
        severidade: 'critico',
      });
      out.canais = r.canais;
    } else {
      try {
        await mgmt(`/projects/${REF}/restart`, { method: 'POST' });
        out.reiniciado = true;
        await gravarEstado({ ultimoReinicio: agoraIso, somarReinicio: true });
        const r = await avisarIncidente({
          titulo: 'Banco fora do ar: REINICIO AUTOMATICO disparado',
          detalhe: `${detalheBase} | A volta leva de 2 a 5 min. A reconciliacao pos-queda roda sozinha quando o banco responder.`,
          severidade: 'critico',
          dados: { ref: REF, acao: 'restart' },
        });
        out.canais = r.canais;
      } catch (e) {
        out.reiniciado = false;
        out.motivo = `reinicio FALHOU: ${e.message}`;
        const r = await avisarIncidente({
          titulo: 'Banco fora do ar e o reinicio automatico FALHOU',
          detalhe: `${detalheBase} | Erro: ${e.message} | Reinicie a mao em https://supabase.com/dashboard/project/${REF}`,
          severidade: 'critico',
        });
        out.canais = r.canais;
      }
    }
  } else {
    // aguardar / escalar: avisa so quando precisa de gente, para nao virar ruido
    if (decisao.acao === 'escalar') {
      const r = await avisarIncidente({ titulo, detalhe: detalheBase, severidade: 'critico' });
      out.canais = r.canais;
    }
  }

  await registrarIncidenteNoBanco(logAdvbox, { titulo, detalhe: detalheBase, severidade: 'critico' });
  await heartbeat('supabase-vigia', false, `${out.acao}: ${out.motivo}`.slice(0, 200));
  console.log('[supabase-vigia]', JSON.stringify(out));

  return new Response(JSON.stringify({ ok: false, ...out, ms: Date.now() - t0 }),
    { headers: { 'Content-Type': 'application/json' } });
};

export const config = { schedule: '*/3 * * * *' };
