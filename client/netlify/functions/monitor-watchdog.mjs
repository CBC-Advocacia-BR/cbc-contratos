/**
 * Netlify Scheduled Function: monitor-watchdog (a cada 30 min)
 * Vigia a saude do sistema SEM depender de ninguem com o app aberto:
 *  (observ-14) chama /api/health e grava o resultado em health_history (uptime real)
 *  (resil-10)  alerta no advbox_api_log quando um servico CAI (transicao ok->erro)
 *  (observ-2)  checa cron_heartbeat: se um robo nao bate o ponto no prazo, alerta
 */
import { db, recordHealth, heartbeat, logAdvbox } from './_lib/botDb.mjs';
import { sendCriticalAlert } from './_lib/alertEmail.mjs';
// (item 145) ritmo esperado de cada robo — o MESMO mapa que o painel do Monitor usa
import { CRON_SLA } from './_lib/cronSla.mjs';

const SELF_URL = process.env.URL || 'https://contratos-cbc.netlify.app';

// prazo maximo (minutos) sem batida antes de considerar o cron "parado"
// (item 145) o mapa saiu daqui para _lib/cronSla.mjs — o painel do Monitor usa o MESMO
// ritmo, em vez do prazo fixo de 90 min que deixava todo cron diario vermelho.


export default async () => {
  const out = { health: [], caiu: [], crons_parados: [], crons_nunca_rodaram: [], pgcron_problemas: [], kommo_failed: 0, kommo_presos: 0 };

  // 1) HEALTH ---------------------------------------------------------------
  try {
    const t0 = Date.now();
    // (item 40) o detalhe por servico agora exige a chave; sem ela o vigia receberia so o
    // resumo e gravaria um historico de disponibilidade vazio
    const r = await fetch(`${SELF_URL}/api/health`, {
      headers: { 'x-bot-key': process.env.BOT_PANEL_KEY || '' },
      signal: AbortSignal.timeout(20000),
    });
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

    // (auditoria 01/08/2026 — item 143) O LAÇO ABAIXO PERCORRE QUEM BATEU PONTO, e essa
    // e justamente a cegueira que escondeu o apagao do backup: o heartbeat so ganha linha
    // quando a function EXECUTA. Um cron que nunca disparou — recem-criado, ou que a
    // Netlify parou de agendar depois de um deploy — simplesmente NAO EXISTE para o
    // watchdog. Silencio absoluto era lido como paz.
    //
    // O CRON_SLA acima ja e a lista declarativa do que deveria existir. Comparar a lista
    // contra quem bateu ponto e o que transforma ausencia em alarme. Foi assim que o
    // `db-backup-cron` passou meses reclamando sem ninguem ver, e o `backup-diario`
    // passou 16 dias sem rodar sem produzir uma unica linha.
    const bateramPonto = new Set((hbs || []).map((h) => h.job));
    for (const job of Object.keys(CRON_SLA)) {
      if (bateramPonto.has(job)) continue;
      out.crons_nunca_rodaram.push(job);
      await logAdvbox('monitor', 'erro',
        `Cron NUNCA rodou: ${job} — nao ha nenhum registro de execucao. Ou a function foi criada e nunca disparou, ou a Netlify parou de agenda-la. Conferir em Logs & metrics > Functions.`,
        { job, causa: 'sem_heartbeat' });
    }

    for (const hb of hbs || []) {
      const sla = CRON_SLA[hb.job];
      // (auditoria 01/08 — item 142) O `continue` por falta de SLA vinha ANTES da
      // checagem de falha: um cron fora da lista que roda todo dia e FALHA todo dia
      // ficava verde no e-mail. Agora a falha e reportada mesmo sem SLA definido —
      // "nao sei o ritmo dele" nunca deve significar "nao me importo se ele quebrou".
      if (hb.ok === false) {
        await logAdvbox('monitor', 'aviso', `Cron rodou com erro: ${hb.job}`, { job: hb.job });
      }
      if (!sla) continue;
      const idadeMin = hb.last_run_at ? (agora - new Date(hb.last_run_at).getTime()) / 60000 : Infinity;
      if (idadeMin > sla) {
        out.crons_parados.push(hb.job);
        await logAdvbox('monitor', 'erro', `Cron sem rodar ha ${Math.round(idadeMin)} min (limite ${sla}): ${hb.job}`, { job: hb.job });
      }
    }
  } catch { /* tabela pode estar vazia */ }

  // 2.5) CRONS DO PROPRIO BANCO (auditoria 01/08 — item 148) -----------------
  // Sao 23 jobs rodando DENTRO do Postgres (pg_cron) que nunca apareceram em painel
  // nenhum. Quando um para, o sintoma e mudo: view materializada velha, logs crescendo,
  // espelho congelado. Foi assim que o `cleanup-old-logs` passou a falhar TODO DIA desde
  // 26/07 sem ninguem notar (duas funcoes com o mesmo nome deixaram a chamada ambigua).
  // O banco e compartilhado: `do_cbc` separa os jobs deste sistema dos outros do
  // escritorio, que aparecem no painel mas nao alarmam aqui.
  try {
    const { data: pgcrons } = await db.rpc('cbc_pg_cron_status');
    for (const j of pgcrons || []) {
      if (!j.do_cbc) continue;
      if (j.nunca_rodou) {
        out.pgcron_problemas.push(j.jobname);
        await logAdvbox('monitor', 'erro', `Cron do banco NUNCA rodou: ${j.jobname} (${j.schedule})`, { job: j.jobname });
      } else if (j.ultimo_status && j.ultimo_status !== 'succeeded') {
        out.pgcron_problemas.push(j.jobname);
        await logAdvbox('monitor', 'erro',
          `Cron do banco FALHOU: ${j.jobname} — ${(j.ultimo_erro || 'sem mensagem').slice(0, 200)}`,
          { job: j.jobname, quando: j.ultima_execucao });
      } else if (j.active === false) {
        await logAdvbox('monitor', 'aviso', `Cron do banco DESATIVADO: ${j.jobname}`, { job: j.jobname });
      }
    }
  } catch { /* pg_cron pode nao estar acessivel — nao derruba o resto do vigia */ }

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

  // 3.6) CONTRATO ASSINADO SEM COBRANCA LANCADA (auditoria 01/08 — item 120) ----
  // O boleto so nasce quando alguem abre a aba Asaas e clica em "lancar". Nao havia
  // NADA vigiando isso: um contrato assinado, com honorario inicial combinado, podia
  // ficar semanas sem cobranca — dinheiro ja vendido parado, e o cliente sem receber
  // nada. Aqui o sistema passa a cobrar sozinho.
  // Regra: assinado ha mais de 3 dias, com honorario inicial > 0, sem asaas_status e
  // nao arquivado. Os 3 dias dao folga para o fluxo normal (assina sexta, lanca segunda).
  out.sem_cobranca = [];
  try {
    const corte = new Date(Date.now() - 3 * 86400000).toISOString();
    const { data: pendentes } = await db.from('contratos')
      .select('id, nome_contratante1, honorarios_total, signed_at, advbox_date, updated_at')
      .eq('status', 'assinado')
      .is('arquivado_em', null)
      .is('asaas_status', null)
      .gt('honorarios_total', 0)
      .order('signed_at', { ascending: true })
      .limit(50);
    for (const c of pendentes || []) {
      // data efetiva de assinatura (mesma cascata do app: signed_at -> advbox_date -> updated_at)
      const assinadoEm = c.signed_at || c.advbox_date || c.updated_at;
      if (!assinadoEm || assinadoEm > corte) continue;   // assinado ha menos de 3 dias
      const dias = Math.floor((Date.now() - new Date(assinadoEm).getTime()) / 86400000);
      out.sem_cobranca.push(`${c.nome_contratante1 || 'contrato'} — assinado ha ${dias} dias, sem cobranca lancada`);
    }
    if (out.sem_cobranca.length) {
      await logAdvbox('asaas', 'aviso',
        `${out.sem_cobranca.length} contrato(s) assinado(s) ha mais de 3 dias SEM cobranca lancada no Asaas`,
        { total: out.sem_cobranca.length });
    }
  } catch { /* coluna asaas_status pode nao existir em ambientes antigos */ }

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
    // (item 120) contrato assinado sem cobranca e dinheiro parado — entra no e-mail,
    // resumido, para nao transformar o alerta numa lista de 50 nomes.
    ...(out.sem_cobranca.length
      ? [`${out.sem_cobranca.length} contrato(s) assinado(s) ha mais de 3 dias SEM cobranca lancada no Asaas (ex.: ${out.sem_cobranca[0]})`]
      : []),
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
          // (02/08/2026 — decisao do Paulo: NAO quer alerta por e-mail) Antes isto pedia
          // para configurar a RESEND_API_KEY a cada rodada. Nao e mais pendencia: e uma
          // escolha. Sem chave, o alerta vive so no sino do app — que passa a ser o UNICO
          // canal, entao o aviso aqui registra o fato sem cobrar providencia.
          // Se um dia o e-mail for desejado, basta cadastrar RESEND_API_KEY: o codigo em
          // `_lib/alertEmail.mjs` ja esta pronto e volta a enviar sozinho.
          if (!res.skipped) {
            await logAdvbox('health', 'aviso', `Erro critico detectado (notificacao in-app criada), mas o e-mail falhou: ${res.error}`.slice(0, 300), { criticos });
          }
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
