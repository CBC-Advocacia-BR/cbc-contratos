// ─────────────────────────────────────────────────────────────────────────
// AVISO QUE FUNCIONA COM O BANCO FORA (06/08/2026).
//
// O PROBLEMA QUE ISTO RESOLVE
// O escritorio ficou 75 minutos fora do ar em 06/08 e NINGUEM foi avisado. Nao por falta
// de vigia: o `monitor-watchdog` roda a cada 30 min e teria detectado. O problema e que
// todos os caminhos de aviso passam pelo proprio banco que caiu:
//   - `logAdvbox()` grava em `advbox_api_log`  -> no Supabase;
//   - o sino do app le `notifications`         -> no Supabase;
//   - o painel do Monitor le tudo do banco     -> no Supabase.
// Quando o Supabase cai, o sistema de alarme cai junto e o silencio parece paz.
//
// DECISAO DO PAULO QUE ESTE MODULO RESPEITA (02/08/2026)
// Esta registrado em `_lib/alertEmail.mjs` que o Paulo NAO quer alerta por e-mail e que
// o canal do dia a dia e o sino do app. Este modulo NAO reverte isso: ele nao manda
// e-mail por conta propria. O que ele faz e garantir que exista REGISTRO do incidente
// fora do banco, e oferecer canais opcionais que so ligam se alguem os configurar.
// Alerta de rotina continua no sino; isto aqui e so para "o banco inteiro esta fora".
//
// CANAIS, em ordem de confiabilidade:
//   1. console.error   -> SEMPRE. Vai para os logs da function na Netlify, que ficam de
//                         pe quando o Supabase cai. E o registro que nunca falha.
//   2. ALERTA_WEBHOOK_URL -> opcional. Um POST com JSON. E o gancho para plugar o canal
//                         que o Paulo escolher depois (WhatsApp, Telegram, Slack) sem
//                         precisar de deploy novo: basta cadastrar a variavel.
//   3. e-mail          -> SO se RESEND_API_KEY existir E ALERTA_EMAIL_CRITICO=1. Duas
//                         travas de proposito, para nao contrariar a decisao acima por
//                         acidente.
//   4. Supabase        -> best-effort, por ultimo. Se o banco tiver voltado, o incidente
//                         tambem fica no historico de sempre.
//
// Nenhuma falha de canal derruba quem chamou: avisar e best-effort por natureza.
// ─────────────────────────────────────────────────────────────────────────

import { sendCriticalAlert } from './alertEmail.mjs';

const WEBHOOK = process.env.ALERTA_WEBHOOK_URL || '';
const EMAIL_LIBERADO = process.env.ALERTA_EMAIL_CRITICO === '1';

async function comTimeout(promessa, ms, rotulo) {
  let t;
  try {
    return await Promise.race([
      promessa,
      new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${rotulo}: timeout`)), ms); }),
    ]);
  } finally {
    clearTimeout(t);
  }
}

/**
 * Avisa sobre um incidente de infraestrutura por todos os canais que NAO dependem do
 * banco. Nunca lanca.
 *
 * @param {object} p
 * @param {string} p.titulo       uma linha, ja legivel por humano
 * @param {string} [p.detalhe]    contexto
 * @param {'critico'|'aviso'} [p.severidade]
 * @param {object} [p.dados]      payload extra para o webhook
 * @returns {Promise<{canais: object}>}  quais canais funcionaram (para o log/retorno)
 */
export async function avisarIncidente({ titulo, detalhe = '', severidade = 'critico', dados = {} } = {}) {
  const quando = new Date().toISOString();
  const canais = { console: false, webhook: null, email: null };

  // 1) console — sempre, e primeiro, para que exista registro mesmo se o resto travar
  try {
    console.error(`[INCIDENTE:${severidade}] ${titulo}${detalhe ? ` | ${detalhe}` : ''}`);
    canais.console = true;
  } catch { /* nao ha o que fazer se nem o console responde */ }

  // 2) webhook generico — o gancho para o canal que o Paulo escolher
  if (WEBHOOK) {
    try {
      const r = await comTimeout(fetch(WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origem: 'cbc-contratos', severidade, titulo, detalhe, quando, ...dados }),
      }), 8000, 'webhook');
      canais.webhook = r.ok ? 'ok' : `HTTP ${r.status}`;
    } catch (err) {
      canais.webhook = `erro: ${err.message}`;
    }
  } else {
    canais.webhook = 'nao configurado (ALERTA_WEBHOOK_URL)';
  }

  // 3) e-mail — duas travas: a chave existir E a liberacao explicita
  if (severidade === 'critico' && EMAIL_LIBERADO) {
    try {
      const r = await comTimeout(sendCriticalAlert(titulo, [detalhe].filter(Boolean)), 12000, 'email');
      canais.email = r?.ok ? 'ok' : (r?.skipped || r?.error || 'falhou');
    } catch (err) {
      canais.email = `erro: ${err.message}`;
    }
  } else {
    canais.email = EMAIL_LIBERADO ? 'nao critico' : 'desligado (decisao 02/08: canal e o sino do app)';
  }

  return { canais };
}

/**
 * Registra o incidente no banco, se ele estiver acessivel. Chamado DEPOIS do aviso e
 * separado dele de proposito: nunca deve ser condicao para avisar.
 * Nunca lanca.
 */
export async function registrarIncidenteNoBanco(logAdvbox, { titulo, detalhe, severidade }) {
  try {
    await comTimeout(
      logAdvbox('infra', severidade === 'critico' ? 'erro' : 'aviso', String(titulo).slice(0, 300), { detalhe }),
      8000, 'banco',
    );
    return 'ok';
  } catch (err) {
    return `indisponivel: ${err.message}`;
  }
}
