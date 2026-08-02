// ─────────────────────────────────────────────────────────────────────────
// (auditoria 01/08/2026 — item 145) FONTE UNICA do ritmo esperado de cada robo.
//
// Este mapa vivia so dentro do monitor-watchdog.mjs, e o painel do Monitor usava um
// prazo FIXO de 90 minutos para todo mundo. Consequencia: um cron diario aparecia
// "atrasado" 22 horas e meia por dia, o painel vivia em ATENCAO, e as pessoas pararam
// de olhar — que e exatamente o efeito que escondeu os crons mortos descobertos em
// 28/07 e o apagao do backup de 16 dias.
//
// O mapa tambem e a lista DECLARATIVA do que deveria existir (item 143): job que esta
// aqui e nao tem heartbeat nenhum nunca rodou, e silencio absoluto precisa virar alarme
// em vez de passar por paz.
//
// Valores em MINUTOS, com folga sobre o intervalo real (um atraso de uma rodada nao
// pode acordar ninguem).
// ─────────────────────────────────────────────────────────────────────────

export const CRON_SLA = {
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
  // (28/07/2026) eventos da CAPI Meta — cron pg_cron 'meta-capi-purchase' (jobid 28),
  // de hora em hora aos :20. O heartbeat e escrito por fn_capi_healthcheck() no Supabase.
  // Existe um vigia proprio no banco (jobid 30), mas ele morre junto se o pg_cron cair;
  // esta linha poe um sistema INDEPENDENTE (Netlify) olhando o silencio.
  'meta-capi-eventos': 90,           // 1x/hora
  // ─── (auditoria 01/08/2026 — item 141) 13 jobs batiam ponto NO VAZIO ───
  // Eles gravavam heartbeat e o watchdog nao os conhecia, entao o `continue` abaixo os
  // descartava: se parassem numa sexta, ninguem saberia — exatamente o que aconteceu
  // com os 4 crons mortos descobertos em 28/07. O BACKUP era o caso mais grave: o
  // watchdog vigiava o 'db-backup-cron' (que nunca roda) e ignorava o 'backup-diario'
  // (que e o backup de verdade, no Drive).
  'backup-diario': 26 * 60,              // 1x/dia 03h BRT — unico backup do banco
  'meta-ads-sync': 26 * 60,              // 1x/dia 07h
  'meta-trafego-sync': 26 * 60,          // 1x/dia 07h10
  'kommo-asaas-sync': 14 * 60,           // 2x/dia (07h/19h)
  'kommo-view-check': 90,                // a cada 30min
  'kommo-leads-sync': 90,                // a cada 30min
  'kommo-sla-sync': 90,                  // a cada 30min
  'agenda-videochamadas-sync': 90,       // a cada 45min — alimenta o funil
  'meet-auditoria-sync': 26 * 60,        // 1x/dia — comparecimento das calls
  'advbox-vendas-sync': 14 * 60,         // 3x/dia (06h/12h/18h)
  'clientes-reconciliar': 26 * 60,       // 1x/dia — cadastro unico
  'cobranca-conciliar': 26 * 60,         // 1x/dia
  'zapsign-lembrete-cron': 26 * 60,      // (item 113) 1x/dia 09h BRT — cobranca de assinatura
  // (auditoria 01/08 — item 249) `cobranca-regua` VOLTA a ser vigiada. Ela foi tirada em
  // 20/06 por dois motivos: a regua de mensagens esta desligada (kill-switch) e o SLA de
  // 30h dava falso-positivo no fim de semana. Acontece que a MESMA function grava o
  // `inadimplencia_snapshot` — FORA do if da regua, ou seja, ele roda de qualquer jeito e
  // e o UNICO gravador do historico de inadimplencia. Sem vigilancia, se ele parar, o
  // grafico e o "vs. 27 dias atras" congelam parecendo ESTABILIDADE.
  // SLA de 80h resolve o falso-positivo: ela roda seg-sex, entao de sexta 10h30 ate
  // segunda 10h30 sao ~72h de silencio legitimo.
  'cobranca-regua': 80 * 60,
  // (auditoria 01/08 — item 149) WEBHOOKS tambem entram, mas com prazo generoso: o ritmo
  // deles depende do mundo real, nao de um cron. Com ~477 parcelas vencendo por mes, o
  // Asaas manda evento quase todo dia — 3 dias de silencio absoluto significa integracao
  // quebrada (URL trocada, webhook desativado no painel), nao "mes fraco".
  // O do ZapSign fica de fora de proposito: e normal passar dias sem ninguem assinar; o
  // heartbeat dele serve para consulta no Monitor, sem virar alarme falso.
  'asaas-webhook': 72 * 60,
  // (item 128) vigia das credenciais das integracoes — 1x/dia as 08h BRT
  'tokens-vigia-cron': 26 * 60,
  // (item 162) verificacao semanal do backup — segundas 08h30 BRT (8 dias de folga)
  'backup-verificar-cron': 8 * 24 * 60,
};
