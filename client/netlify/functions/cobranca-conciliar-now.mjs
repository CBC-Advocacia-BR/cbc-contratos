/**
 * Netlify Function (HTTP): roda a conciliação de cobrança SOB DEMANDA (botão do painel),
 * sem esperar o cron de 12h. Marca como recuperado qualquer disparo cujo CPF pagou um
 * boleto vencido depois do envio.
 * Auth: BOT_PANEL_KEY (header x-bot-key ou body.key). Retorna { recuperados }.
 *
 * (auditoria 01/08/2026 — item 99) A LÓGICA vive em `_lib/conciliarCobranca.mjs`, a mesma
 * usada pelo cron `cobranca-conciliar.mjs`. Antes as duas funções tinham cópias idênticas
 * da varredura — inclusive do mesmo `.limit(5000)`, que não levanta o teto de 1.000 linhas
 * do PostgREST e já podia estar deixando pagamentos de fora (cada pagamento perdido vira
 * um disparo marcado como "não converteu", enviesando a eficácia da régua para baixo).
 */
import { logAdvbox } from './_lib/botDb.mjs';
import { conciliarCobranca } from './_lib/conciliarCobranca.mjs';

const PANEL_KEY = process.env.BOT_PANEL_KEY || '';
const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, x-bot-key' };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  const body = await req.json().catch(() => ({}));
  const key = req.headers.get('x-bot-key') || body.key || '';
  if (!PANEL_KEY || key !== PANEL_KEY) return json({ ok: false, error: 'unauthorized' }, 401);

  try {
    const { marcados, candidatos, cpfsPendentes } = await conciliarCobranca();
    await logAdvbox('asaas', 'info',
      `cobranca conciliar-now: ${marcados} recuperados (${candidatos} candidatos / ${cpfsPendentes} CPFs pendentes)`, {});
    return json({ ok: true, recuperados: marcados });
  } catch (e) {
    await logAdvbox('asaas', 'erro', `cobranca-conciliar-now: ${e.message}`.slice(0, 200), {});
    return json({ ok: false, error: e.message }, 500);
  }
};
