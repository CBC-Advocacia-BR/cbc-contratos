// (auditoria 01/08/2026 — itens 9/12/15) Quem pode DISPARAR um robô agendado.
//
// 🔎 CORRECAO 02/08/2026, MEDIDA EM PRODUCAO — LEIA ANTES DE MEXER:
// A premissa do item 9 estava ERRADA. Ele dizia que bastava abrir a URL da function no
// navegador para disparar o robo (incluindo o backfill de 36 meses da Meta, que e cota
// paga). **Nao bastava**: a Netlify responde **403 a QUALQUER requisicao HTTP externa
// feita a uma function AGENDADA** — o bloqueio e na borda, antes de o codigo rodar.
// Testado nas 7: meta-ads-sync, asaas-sync-boletos, asaas-sync-customers,
// kommo-leads-sync, clientes-reconciliar, meta-trafego-sync, tokens-vigia-cron,
// backup-verificar-cron — todas 403 de fora.
//
// Ou seja, para function AGENDADA a plataforma ja garante que so a Netlify invoca, e a
// trava daqui nao protegia de nada. Pior: ela QUEBROU o botao **"Run now"** do painel,
// que e o UNICO jeito de disparar um cron a mao (o `curl` bate no 403 da borda). Medido:
// asaas-sync-customers e backup-verificar-cron voltavam em ~140ms sem gravar heartbeat,
// porque o "Run now" NAO manda `x-netlify-event: schedule` e caia no 401 daqui.
//
// REGRA ATUAL:
//   · function AGENDADA  -> passe `{ agendada: true }`. Chegou ate o codigo? A Netlify
//     invocou (scheduler ou "Run now"). Aceita, e so registra a origem.
//   · function NAO agendada (worker, webhook, endpoint) -> comportamento estrito abaixo:
//     essas SIM sao publicas e precisam do cabecalho do agendador ou da BOT_PANEL_KEY.
//
// A REGRA CERTA (duas portas, nenhuma delas aberta):
//   1) o agendador da Netlify manda o cabecalho `x-netlify-event: schedule`;
//   2) disparo manual precisa da BOT_PANEL_KEY — e no CABECALHO `x-bot-key`.
//
// Sobre a chave na URL (`?key=`): ela fica gravada no log de acesso da Netlify, no
// historico do navegador e no cabecalho Referer de qualquer link seguinte. Continua
// aceita por enquanto (varios atalhos e crons manuais do Paulo usam esse formato), mas
// o uso e REGISTRADO para dar para migrar com seguranca depois. Passe
// `aceitarChaveNaUrl: false` quando quiser fechar de vez.

const PANEL_KEY = () => process.env.BOT_PANEL_KEY || '';

/**
 * @returns {{ok: boolean, origem: 'cron'|'manual'|null, status?: number, erro?: string, avisoChaveNaUrl?: boolean}}
 */
export function verificarGatilho(req, { aceitarChaveNaUrl = true, agendada = false } = {}) {
  if (req.headers.get('x-netlify-event') === 'schedule') {
    return { ok: true, origem: 'cron' };
  }
  // (correcao 02/08) function agendada: a borda da Netlify ja barra o mundo externo com
  // 403, entao qualquer invocacao que chegue aqui veio da propria Netlify — scheduler ou
  // botao "Run now". Recusar isso so quebra o disparo manual, sem proteger nada.
  if (agendada) {
    return { ok: true, origem: req.headers.get('x-netlify-event') ? 'cron' : 'manual' };
  }

  const chave = PANEL_KEY();
  // (item 13) sem a variavel configurada, o disparo manual fica DESATIVADO — nunca
  // "qualquer um pode", que era o efeito de um default fraco.
  if (!chave) {
    return { ok: false, origem: null, status: 503, erro: 'BOT_PANEL_KEY nao configurada — disparo manual desativado.' };
  }

  const noCabecalho = req.headers.get('x-bot-key') || '';
  if (noCabecalho && noCabecalho === chave) return { ok: true, origem: 'manual' };

  if (aceitarChaveNaUrl) {
    let naUrl = '';
    try { naUrl = new URL(req.url).searchParams.get('key') || ''; } catch { /* url invalida */ }
    if (naUrl && naUrl === chave) {
      return { ok: true, origem: 'manual', avisoChaveNaUrl: true };
    }
  }

  return { ok: false, origem: null, status: 401, erro: 'nao autorizado' };
}

/** Resposta pronta para o caso negado (mesma forma em todas as functions). */
export function respostaNegada(v) {
  return new Response(JSON.stringify({ ok: false, error: v.erro }), {
    status: v.status || 401,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
