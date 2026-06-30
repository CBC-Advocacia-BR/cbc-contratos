/**
 * Netlify Function: portal-admin
 * Gestão dos links do PORTAL DO CLIENTE (aba "Portal do Cliente" do sistema).
 * Auth: header 'x-bot-key' == env BOT_PANEL_KEY (mesmo padrão do painel do bot).
 *
 * Body (JSON): { action, ...params }
 *   search { q }                -> clientes do ADVBOX (bi_clientes) + situação do link
 *   create { customer_id }      -> gera link (desativa tokens antigos do cliente)
 *   rotate { customer_id }      -> renova o link (idem create)
 *   toggle { token, ativo }     -> ativa/desativa um link
 */
import { randomBytes } from 'node:crypto';
import { db } from './_lib/botDb.mjs';

const KEY = process.env.BOT_PANEL_KEY;
const BASE = 'https://contratos-cbc.netlify.app/portal?t=';
const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: H });
const digits = (s) => String(s || '').replace(/\D/g, '');

// escritorio so atende pessoa FISICA — partes contrarias (empresas) ficam fora
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const PJ_RE = /(LTDA|S\/A|S\.A|EIRELI|EMPREENDIMENT|INCORPORADORA|ADMINISTRADORA|HOTELEIRA|CONSTRUTORA|\bSPE\b|COMERCIALIZA|PARTICIPACOES|MULTIPROPRIEDADE|TURISMO|VIAGENS|RESORT|IMOBILIARI|CONDOMINIO|\bCLUB\b|BANCO|SEGURADORA|COOPERATIVA|ASSOCIACAO)/i;
const isPessoaJuridica = (c) =>
  digits(c.cpf_cnpj).length === 14 ||
  semAcento(c.origem).toUpperCase().trim() === 'PARTE CONTRARIA' ||
  PJ_RE.test(semAcento(c.nome));

async function tokensDe(customerIds) {
  const { data } = await db.from('cliente_portal_tokens')
    .select('token, advbox_customer_id, ativo, acessos, ultimo_acesso, criado_em')
    .in('advbox_customer_id', customerIds)
    .order('criado_em', { ascending: false });
  const map = {};
  for (const t of data || []) {
    const k = String(t.advbox_customer_id);
    if (!map[k]) map[k] = t;            // mais recente
    else if (!map[k].ativo && t.ativo) map[k] = t; // prefere o ativo
  }
  return map;
}

async function criarLink(customerId) {
  const { data: cli } = await db.from('bi_clientes')
    .select('customer_id, nome, cpf_cnpj').eq('customer_id', customerId).maybeSingle();
  if (!cli) throw new Error('cliente não encontrado no espelho do ADVBOX');
  await db.from('cliente_portal_tokens').update({ ativo: false })
    .eq('advbox_customer_id', customerId).eq('ativo', true);
  const token = randomBytes(16).toString('hex');
  const { error } = await db.from('cliente_portal_tokens').insert({
    token, advbox_customer_id: cli.customer_id, nome: cli.nome, cpf: cli.cpf_cnpj, ativo: true,
  });
  if (error) throw new Error(error.message);
  return { token, link: BASE + token, nome: cli.nome };
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: { ...H, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, x-bot-key' } });
  }
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  const key = req.headers.get('x-bot-key') || '';
  if (key !== KEY) return json({ ok: false, error: 'unauthorized' }, 401);

  let body = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: 'JSON inválido' }, 400); }

  try {
    if (body.action === 'diagnostico') {
      // visão geral: prontos para gerar + inconsistências de vínculo
      const { data, error } = await db.rpc('portal_diagnostico', { p_chave: process.env.BOT_RPC_SECRET || '' });
      if (error) throw new Error(error.message);
      return json({ ok: true, ...data });
    }

    if (body.action === 'flag_so_exito') {
      // marca/desmarca cliente sem honorarios iniciais (contrato so de exito)
      if (!body.customer_id) return json({ ok: false, error: 'customer_id obrigatório' }, 400);
      if (body.remover) {
        const { error } = await db.from('portal_cliente_flags').delete().eq('customer_id', body.customer_id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await db.from('portal_cliente_flags').upsert({
          customer_id: body.customer_id, nome: body.nome || null,
          sem_honorarios_iniciais: true, marcado_por: body.por || 'painel', marcado_em: new Date().toISOString(),
        });
        if (error) throw new Error(error.message);
      }
      return json({ ok: true });
    }

    if (body.action === 'export') {
      // listas COMPLETAS das divergencias (para PDF/Excel no painel)
      const { data, error } = await db.rpc('portal_diagnostico_export', { p_chave: process.env.BOT_RPC_SECRET || '' });
      if (error) throw new Error(error.message);
      return json({ ok: true, ...data });
    }

    if (body.action === 'metricas') {
      // métricas de uso do portal: ranking de funções, horários, retenção, top clientes
      const { data, error } = await db.rpc('portal_metricas', { p_chave: process.env.BOT_RPC_SECRET || '' });
      if (error) throw new Error(error.message);
      return json({ ok: true, ...data });
    }

    if (body.action === 'search') {
      const q = String(body.q || '').trim().replace(/[,()]/g, ' ');
      if (q.length < 3) return json({ ok: true, clientes: [] });
      const qd = digits(q);
      let query = db.from('bi_clientes')
        .select('customer_id, nome, cpf_cnpj, celular, telefone, cidade, uf, qtd_processos, origem')
        .limit(20);
      if (qd.length >= 5) query = query.or(`nome.ilike.%${q}%,cpf_cnpj.ilike.%${qd.slice(0,3)}%`);
      else query = query.ilike('nome', `%${q}%`);
      const { data: clis, error } = await query;
      if (error) throw new Error(error.message);
      // filtro fino de CPF no servidor (formatos variados) + somente pessoa fisica
      const lista = (clis || []).filter(c => !isPessoaJuridica(c)).filter(c =>
        qd.length >= 5 ? (digits(c.cpf_cnpj).includes(qd) || (c.nome || '').toLowerCase().includes(q.toLowerCase())) : true
      ).slice(0, 15);
      const toks = lista.length ? await tokensDe(lista.map(c => c.customer_id)) : {};
      return json({
        ok: true,
        clientes: lista.map(c => ({
          customer_id: c.customer_id,
          nome: c.nome,
          cpf: c.cpf_cnpj,
          celular: c.celular || c.telefone || '',
          cidade: [c.cidade, c.uf].filter(Boolean).join(' – '),
          processos: c.qtd_processos || 0,
          link: toks[String(c.customer_id)] ? {
            token: toks[String(c.customer_id)].token,
            url: BASE + toks[String(c.customer_id)].token,
            ativo: toks[String(c.customer_id)].ativo,
            acessos: toks[String(c.customer_id)].acessos || 0,
            ultimo_acesso: toks[String(c.customer_id)].ultimo_acesso,
            criado_em: toks[String(c.customer_id)].criado_em,
          } : null,
        })),
      });
    }

    if (body.action === 'create' || body.action === 'rotate') {
      if (!body.customer_id) return json({ ok: false, error: 'customer_id obrigatório' }, 400);
      const r = await criarLink(Number(body.customer_id));
      return json({ ok: true, ...r, renovado: body.action === 'rotate' });
    }

    if (body.action === 'toggle') {
      if (!body.token) return json({ ok: false, error: 'token obrigatório' }, 400);
      const { error } = await db.from('cliente_portal_tokens')
        .update({ ativo: body.ativo !== false }).eq('token', body.token);
      if (error) throw new Error(error.message);
      return json({ ok: true });
    }

    return json({ ok: false, error: `action desconhecida: ${body.action}` }, 400);
  } catch (err) {
    console.error('[portal-admin]', err);
    return json({ ok: false, error: err.message }, 500);
  }
};

export const config = { path: '/.netlify/functions/portal-admin' };
