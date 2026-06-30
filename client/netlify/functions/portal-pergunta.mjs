/**
 * "Pergunte aqui" do portal: POST { t, pergunta } →
 *  1. grava em portal_perguntas (status=pendente)
 *  2. cria TAREFA no lead Kommo do cliente (se houver vínculo) com SLA de 1 dia útil
 * A resposta da equipe (aba Portal do Cliente no sistema) aparece no portal.
 */
import { db, logAdvbox } from './_lib/botDb.mjs';
import { createKommoTask } from './_lib/kommo.mjs';
import { rateLimitResponse } from './rate-limit.mjs';

const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: H });
const digits = (s) => String(s || '').replace(/\D/g, '');

// (seg-12) rate limit local p/ este endpoint que ESCREVE: limite mais apertado (10/min por IP)
// que o utilitario compartilhado (30/min). Mesmo padrao de extracao de IP do rate-limit.mjs.
// Por-instancia (em memoria) — suficiente p/ conter abuso sem KV externo.
const RL_WINDOW_MS = 60000;
const RL_MAX = 10;
const rlStore = new Map();
function checkWriteLimit(req) {
  const ip = req.headers.get('x-nf-client-connection-ip') ||
             req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
             req.headers.get('x-real-ip') || 'unknown';
  const now = Date.now();
  const e = rlStore.get(ip);
  if (!e || now - e.start > RL_WINDOW_MS) { rlStore.set(ip, { count: 1, start: now }); return true; }
  e.count++;
  return e.count <= RL_MAX;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of rlStore) if (now - e.start > RL_WINDOW_MS * 2) rlStore.delete(k);
}, 300000);

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: H });
  if (req.method !== 'POST') return json({ ok: false }, 405);

  // (seg-12) rate limit por IP ANTES de processar (funcao publica do portal que grava no banco)
  if (!checkWriteLimit(req)) return rateLimitResponse();

  let body = {};
  try { body = await req.json(); } catch { return json({ ok: false, erro: 'json' }, 400); }
  const token = String(body.t || '').trim();
  const pergunta = String(body.pergunta || '').trim().slice(0, 600);
  if (!token || token.length < 16 || pergunta.length < 5) return json({ ok: false, erro: 'dados' }, 400);

  try {
    const { data: tk } = await db.from('cliente_portal_tokens')
      .select('advbox_customer_id, nome, cpf').eq('token', token).eq('ativo', true).maybeSingle();
    if (!tk) return json({ ok: false, erro: 'acesso' }, 401);

    // anti-abuso: máx. 3 perguntas abertas por cliente
    const { count } = await db.from('portal_perguntas').select('id', { count: 'exact', head: true })
      .eq('token', token).eq('status', 'pendente');
    if ((count || 0) >= 3) {
      return json({ ok: false, erro: 'limite', msg: 'Você já tem 3 perguntas aguardando resposta — assim que respondermos, pode enviar novas.' });
    }

    await db.from('portal_perguntas').insert({
      token, advbox_customer_id: tk.advbox_customer_id, nome: tk.nome, pergunta,
    });

    // tarefa no Kommo (lead vinculado pelo CPF do contrato), melhor esforço
    try {
      const cpf = digits(tk.cpf);
      if (cpf.length === 11) {
        const { data: cts } = await db.from('contratos')
          .select('contratantes:dados->contratantes, cpf_contratante1, cpf_contratante2')
          .is('arquivado_em', null).not('dados', 'is', null);
        let leadId = null;
        for (const ct of cts || []) {
          if (digits(ct.cpf_contratante1) === cpf || digits(ct.cpf_contratante2) === cpf) {
            const link = (ct.contratantes || []).map(c => c?.linkKommo).find(Boolean);
            const m = String(link || '').match(/\/leads\/detail\/(\d+)/);
            if (m) { leadId = Number(m[1]); break; }
          }
        }
        if (leadId) {
          await createKommoTask(leadId, 'leads',
            `🌐 Pergunta pelo PORTAL — ${tk.nome}: "${pergunta.slice(0, 350)}" (responder na aba Portal do Cliente; SLA 1 dia útil)`, 24);
        }
      }
    } catch (e) { await logAdvbox('portal', 'aviso', `pergunta sem tarefa Kommo: ${e.message}`, {}); }

    return json({ ok: true });
  } catch (err) {
    console.error('[portal-pergunta]', err);
    return json({ ok: false, erro: 'indisponivel' }, 500);
  }
};

export const config = { path: '/.netlify/functions/portal-pergunta' };
