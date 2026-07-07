/**
 * Netlify Scheduled Function: monitor-watchdog (a cada 30 min)
 * Vigia a saude do sistema SEM depender de ninguem com o app aberto:
 *  (observ-14) chama /api/health e grava o resultado em health_history (uptime real)
 *  (resil-10)  alerta no advbox_api_log quando um servico CAI (transicao ok->erro)
 *  (observ-2)  checa cron_heartbeat: se um robo nao bate o ponto no prazo, alerta
 */
import { db, recordHealth, heartbeat, logAdvbox } from './_lib/botDb.mjs';
import { sendCriticalAlert } from './_lib/alertEmail.mjs';

const SELF_URL = process.env.URL || 'https://contratos-cbc.netlify.app';

// prazo maximo (minutos) sem batida antes de considerar o cron "parado"
const CRON_SLA = {
  'datajud-refresh': 26 * 60,        // 1x/dia
  'reminder-cron': 40,               // a cada 15min
  // (20/06/2026) cobranca-regua REMOVIDA do watchdog — régua desligada (kill-switch
  // em cobranca-regua.mjs). Além disso o SLA de 30h dava falso-positivo nos fins de
  // semana (a régua só roda seg–sex; Fri→Mon ~72h > 30h gerava "Cron sem rodar").
  'asaas-sync-boletos': 14 * 60,     // 2x/dia
  'asaas-sync-customers': 26 * 60,   // 1x/dia
  'advbox-monitor': 14 * 60,         // 2x/dia (06h30/17h30)
  'advbox-snapshot': 15 * 60,        // (auditoria #86) disparado em seq ao monitor
  'advbox-sweep-cron': 60,           // (auditoria #75) a cada 20min, 24/7
  'db-backup-cron': 26 * 60,         // (auditoria #87) 1x/dia
  'commission-calculator': 33 * 24 * 60, // (auditoria #89) dia 20 do mes (~33d de folga)
  'kommo-queue-worker': 30,          // (auditoria #89) a cada 1min (drena a fila Kommo)
  'bandwidth-check-cron': 14 * 60,   // (auditoria #93) 3x/dia
};

export default async () => {
  const out = { health: [], caiu: [], crons_parados: [], kommo_failed: 0, kommo_presos: 0 };

  // 1) HEALTH ---------------------------------------------------------------
  try {
    const t0 = Date.now();
    const r = await fetch(`${SELF_URL}/api/health`, { signal: AbortSignal.timeout(20000) });
    const elapsed = Date.now() - t0;
    const j = await r.json().catch(() => ({}));
    const services = Array.isArray(j.services) ? j.services : [];

    // estado anterior de cada servico (ultima linha) p/ detectar transicao ok->erro
    const prev = {};
    try {
      const { data: hist } = await db.from('health_history')
        .select('service, ok, checked_at')
        .order('checked_at', { ascending: false }).limit(60);
      for (const h of hist || []) if (!(h.service in prev)) prev[h.service] = h.ok;
    } catch { /* sem historico ainda */ }

    const rows = services.map(s => ({
      service: s.name, ok: s.status === 'ok', latency_ms: s.ms, detail: s.error || null,
    }));
    if (rows.length) {
      await recordHealth(rows);
      out.health = rows.map(r2 => `${r2.service}:${r2.ok ? 'ok' : 'ERRO'}`);
      // (resil-10) alerta so na TRANSICAO ok->erro (evita spam a cada 30min)
      for (const r2 of rows) {
        if (!r2.ok && prev[r2.service] !== false) {
          out.caiu.push(r2.service);
          await logAdvbox('health', 'erro', `Integracao CAIU: ${r2.service} — ${r2.detail || 'sem detalhe'}`.slice(0, 300), { service: r2.service });
        }
      }
    }
  } catch (e) {
    await logAdvbox('health', 'aviso', `watchdog: falha ao consultar /api/health: ${e.message}`.slice(0, 300), {});
  }

  // 2) CRON HEARTBEAT -------------------------------------------------------
  try {
    const { data: hbs } = await db.from('cron_heartbeat').select('job, last_run_at, ok');
    const agora = Date.now();
    for (const hb of hbs || []) {
      const sla = CRON_SLA[hb.job];
      if (!sla) continue;
      const idadeMin = hb.last_run_at ? (agora - new Date(hb.last_run_at).getTime()) / 60000 : Infinity;
      if (idadeMin > sla) {
        out.crons_parados.push(hb.job);
        await logAdvbox('monitor', 'erro', `Cron sem rodar ha ${Math.round(idadeMin)} min (limite ${sla}): ${hb.job}`, { job: hb.job });
      } else if (hb.ok === false) {
        await logAdvbox('monitor', 'aviso', `Cron rodou com erro: ${hb.job}`, { job: hb.job });
      }
    }
  } catch { /* tabela pode estar vazia */ }

  // 3) FILA KOMMO (auditoria #76) -------------------------------------------
  // Jobs que esgotam as tentativas viram 'failed' e morriam sem ninguem saber
  // (o watchdog nao olhava a kommo_queue). Alerta os que FALHARAM na ultima janela
  // (~35min, evita spam) e os pendentes ha muito tempo (worker travado).
  try {
    const desde = new Date(Date.now() - 35 * 60000).toISOString();
    const { count: nFailed } = await db.from('kommo_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'failed').gte('updated_at', desde);
    if (nFailed && nFailed > 0) {
      out.kommo_failed = nFailed;
      await logAdvbox('kommo', 'erro', `Fila Kommo: ${nFailed} job(s) FALHOU nos ultimos 35min (esgotou as tentativas) — nota/mensagem/movimento de lead pode ter se perdido. Ver kommo_queue status=failed.`, { failed_recentes: nFailed });
    }
    const antigo = new Date(Date.now() - 60 * 60000).toISOString();
    const { count: nPresos } = await db.from('kommo_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending').lt('created_at', antigo);
    if (nPresos && nPresos > 0) {
      out.kommo_presos = nPresos;
      await logAdvbox('kommo', 'aviso', `Fila Kommo: ${nPresos} job(s) pendente(s) ha mais de 1h — o kommo-queue-worker pode estar travado.`, { pendentes_antigos: nPresos });
    }
  } catch { /* kommo_queue pode nao existir em ambientes antigos */ }

  // 3.5) FALHAS TERMINAIS DE AUTOMACAO DE CONTRATO (#6, 07/07) --------------
  // ADVBOX/Drive que falharam ao lancar/arquivar um contrato assinado. Sao raras
  // (retry ate 3x antes de logar 'error'), entao alertar as recentes nao gera spam.
  out.automacao_falhou = [];
  try {
    const desde = new Date(Date.now() - 35 * 60000).toISOString();
    const { data: falhas } = await db.from('automation_log')
      .select('action, client_name, details, created_at')
      .eq('status', 'error').in('action', ['advbox', 'drive'])
      .gte('created_at', desde).order('created_at', { ascending: false }).limit(20);
    for (const f of falhas || []) {
      const motivo = f.details?.error || f.details?.drive_failed_reason || f.details?.message || 'sem detalhe';
      out.automacao_falhou.push(`${String(f.action).toUpperCase()} falhou p/ ${f.client_name || 'contrato'}: ${String(motivo).slice(0, 90)}`);
    }
    if (out.automacao_falhou.length) {
      await logAdvbox('monitor', 'erro', `Automacao de contrato falhou (${out.automacao_falhou.length}): ${out.automacao_falhou.join(' | ')}`.slice(0, 300), {});
    }
  } catch { /* automation_log pode nao existir */ }

  // 4) E-MAIL DE ALERTA CRITICO (auditoria #88/#89) ------------------------
  // Decisao do Paulo (06/07): e-mail para paulo@advocaciacbc.com SOMENTE em erro
  // CRITICO — integracao caida, robo parado no prazo, ou jobs Kommo perdidos. Avisos
  // (bandwidth 50-80%, fila pendente) NAO geram e-mail. Throttle de 2h (o watchdog roda
  // a cada 30min) p/ nao encher a caixa. Estado do throttle em bot_config.
  const criticos = [
    ...out.caiu.map((s) => `Integracao CAIU: ${s}`),
    ...out.crons_parados.map((j) => `Robo parado (nao rodou no prazo): ${j}`),
    ...(out.kommo_failed ? [`Fila Kommo: ${out.kommo_failed} job(s) FALHARAM (nota/mensagem/lead pode ter se perdido)`] : []),
    ...out.automacao_falhou,
  ];
  out.email = 'nenhum critico';
  if (criticos.length) {
    try {
      const { data: cfg } = await db.from('bot_config').select('value').eq('key', 'alert_email_state').maybeSingle();
      const lastSent = cfg?.value?.last_sent_at ? new Date(cfg.value.last_sent_at).getTime() : 0;
      if (Date.now() - lastSent > 2 * 3600 * 1000) {
        // (#6) notificacao IN-APP p/ o Paulo — aparece no sino do app MESMO sem RESEND_API_KEY
        // (o e-mail so sai com a chave setada). Uma por rodada de alerta (throttle 2h).
        try {
          await db.from('notifications').insert({
            user_email: 'paulo@advocaciacbc.com',
            type: 'error',
            title: `⚠️ ${criticos.length} problema(s) crítico(s) no sistema`,
            body: criticos.join('\n'),
            link: null,
          });
        } catch { /* notifications pode ter RLS/coluna diferente */ }
        // marca o throttle JA (vale p/ notificacao + e-mail) — senao, sem RESEND, re-alertaria a cada 30min
        await db.from('bot_config').upsert({ key: 'alert_email_state', value: { last_sent_at: new Date().toISOString(), ultimos: criticos }, updated_at: new Date().toISOString() });
        const res = await sendCriticalAlert(`${criticos.length} problema(s) critico(s)`, criticos);
        if (res.ok) {
          out.email = 'enviado';
        } else {
          out.email = res.skipped || res.error;
          await logAdvbox('health', 'aviso', `Erro critico detectado (notificacao in-app criada), mas e-mail NAO enviado (${res.skipped || res.error}). Configure RESEND_API_KEY no Netlify.`.slice(0, 300), { criticos });
        }
      } else {
        out.email = 'throttled (2h)';
      }
    } catch (e) { out.email = `erro: ${e.message}`; }
  }

  await heartbeat('monitor-watchdog', true,
    `${out.caiu.length} caiu, ${out.crons_parados.length} cron(s) parado(s), kommo ${out.kommo_failed} falhou/${out.kommo_presos} preso(s)`);
  console.log('[monitor-watchdog]', JSON.stringify(out));
  return new Response(JSON.stringify({ ok: true, ...out }), { headers: { 'Content-Type': 'application/json' } });
};

export const config = { schedule: '*/30 * * * *' };
