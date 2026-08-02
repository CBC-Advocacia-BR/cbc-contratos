/**
 * "Pergunte aqui" do portal: POST { t, pergunta } →
 *  1. grava em portal_perguntas (status=pendente)
 *  2. cria TAREFA no lead Kommo do cliente (se houver vínculo) com SLA de 1 dia útil
 * A resposta da equipe (aba Portal do Cliente no sistema) aparece no portal.
 */
import { db, logAdvbox } from './_lib/botDb.mjs';
import { createKommoTask } from './_lib/kommo.mjs';
import { rateLimitResponse, checkRateLimitShared } from './rate-limit.mjs';

const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: H });
const digits = (s) => String(s || '').replace(/\D/g, '');

// (seg-12) rate limit deste endpoint que ESCREVE: 10/min por IP, mais apertado que o
// padrao do utilitario compartilhado.
// (auditoria 01/08 — itens 103/109) O limitador daqui era EM MEMORIA: cada instancia da
// function tinha o proprio contador, entao o teto de 10/min quase nunca era atingido de
// verdade — bastava a chamada cair em outra instancia. Como esta e uma rota PUBLICA (o
// cliente escreve pelo portal), o limite precisa valer de verdade. O limitador
// compartilhado (contado no banco) ja existia no projeto e e o mesmo usado pelo
// portal-data. De quebra sai o `setInterval` no nivel do modulo, que em serverless so
// segurava o processo acordado sem necessidade.
async function checkWriteLimit(req) {
  const rl = await checkRateLimitShared(req, { bucket: 'portal-pergunta', max: 10, windowSeconds: 60 });
  return rl.allowed;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: H });
  if (req.method !== 'POST') return json({ ok: false }, 405);

  // (seg-12) rate limit por IP ANTES de processar (funcao publica do portal que grava no banco)
  if (!await checkWriteLimit(req)) return rateLimitResponse();

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
