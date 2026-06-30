/**
 * NPS do portal do cliente (#11): POST { t, nota (0-10), comentario? }.
 * Valida o token e grava em portal_nps. Resposta no mesmo dia atualiza a
 * anterior (evita duplicar se o cliente reenviar).
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
  const nota = Number(body.nota);
  const comentario = String(body.comentario || '').trim().slice(0, 1000) || null;
  if (!token || token.length < 16 || !Number.isInteger(nota) || nota < 0 || nota > 10) {
    return json({ ok: false, erro: 'dados' }, 400);
  }

  try {
    const { data: tk } = await db.from('cliente_portal_tokens').select('advbox_customer_id, nome, cpf')
      .eq('token', token).eq('ativo', true).maybeSingle();
    if (!tk) return json({ ok: false, erro: 'acesso' }, 401);

    // mesma pessoa no mesmo dia -> atualiza em vez de duplicar
    const hoje = new Date().toISOString().slice(0, 10);
    const { data: existente } = await db.from('portal_nps').select('id')
      .eq('token', token).gte('criado_em', hoje).order('criado_em', { ascending: false }).limit(1);
    let novo = true;
    if (existente && existente.length) {
      await db.from('portal_nps').update({ nota, comentario }).eq('id', existente[0].id);
      novo = false;
    } else {
      await db.from('portal_nps').insert({
        token, advbox_customer_id: tk.advbox_customer_id, nome: tk.nome, nota, comentario,
      });
    }

    // detrator (nota <= 6): cria tarefa no Kommo p/ acompanhar (retenção), 1x por
    // resposta nova (não duplica em reenvio no mesmo dia). Melhor esforço.
    if (nota <= 6 && novo) {
      // (portal-13) detrator = cliente em risco: registra no advbox_api_log p/ visibilidade no Monitor
      await logAdvbox('portal', 'aviso',
        `Detrator NPS ${nota} pelo PORTAL — ${tk.nome}`,
        { nota, nome: tk.nome, cpf: digits(tk.cpf).slice(0, 3) + '***', comentario: comentario ? comentario.slice(0, 300) : null }
      ).catch(() => {});
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
            // (portal-13) detrator tem urgencia maior: prazo de 4h (vs 1 dia util), texto marcado
            // e, se configurado, direcionado ao responsavel/socio via env KOMMO_DETRATOR_RESPONSAVEL
            const responsavel = Number(process.env.KOMMO_DETRATOR_RESPONSAVEL) || null;
            await createKommoTask(leadId, 'leads',
              `🚨 [URGENTE - DETRATOR NPS] NPS ${nota} pelo PORTAL — ${tk.nome}${comentario ? `: "${comentario.slice(0, 300)}"` : ' (sem comentário)'} — acompanhar o cliente com prioridade (SLA 4 horas)`,
              4, responsavel);
          }
        }
      } catch (e) { await logAdvbox('portal', 'aviso', `nps detrator sem tarefa Kommo: ${e.message}`, {}); }
    }
    return json({ ok: true });
  } catch (err) {
    console.error('[portal-feedback]', err);
    return json({ ok: false, erro: 'indisponivel' }, 500);
  }
};

export const config = { path: '/.netlify/functions/portal-feedback' };
