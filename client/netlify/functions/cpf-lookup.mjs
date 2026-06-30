/**
 * Netlify Function: cpf-lookup
 * Consulta de CPF feita NO SERVIDOR — o token nunca vai para o navegador.
 * GET /api/cpf-lookup?cpf=00000000000  ->  { valid, nome, nascimento }
 *
 * Pré-requisito: definir a variável de ambiente CPF_API_TOKEN no painel da Netlify
 * (Site configuration -> Environment variables). Sem ela, a função responde de
 * forma segura (valid:true, nome vazio) e NÃO quebra o formulário.
 *
 * Substitui a chamada direta que existia em src/utils/apiLookup.js, onde o token
 * ficava embutido no site (visível para qualquer visitante).
 */
import { checkRateLimit, rateLimitResponse } from './rate-limit.mjs';

const CPF_API_TOKEN = process.env.CPF_API_TOKEN; // configurar na Netlify
const CPF_PACOTE = '7'; // Pacote 7 = CPF B (nome + nascimento) — R$0.25/consulta

const H = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'private, no-store',
};
// (QW#6) extraHeaders permite cachear no CDN so a resposta de sucesso (CPF e dado
// cadastral imutavel). Estados transitorios (sem credito/token/erro) seguem no-store.
const json = (obj, status = 200, extraHeaders) =>
  new Response(JSON.stringify(obj), { status, headers: { ...H, ...extraHeaders } });

export default async (req) => {
  const url = new URL(req.url);
  const cpf = String(url.searchParams.get('cpf') || '').replace(/\D/g, '');
  if (cpf.length !== 11) return json({ valid: false, nome: '' }, 400);

  // (seg-12 / portal-4) rate limit por IP ANTES da chamada externa paga (R$0,25/consulta).
  // Funcao publica e cara: limita ~30/min por IP usando o utilitario compartilhado.
  const rl = checkRateLimit(req);
  if (!rl.allowed) return rateLimitResponse();

  // Se o token ainda não foi configurado, falha de forma segura (não quebra a tela).
  if (!CPF_API_TOKEN) return json({ valid: true, nome: '', error: 'TOKEN_NAO_CONFIGURADO' });

  try {
    const resp = await fetch(`https://api.cpfcnpj.com.br/${CPF_API_TOKEN}/${CPF_PACOTE}/${cpf}`);
    const data = await resp.json().catch(() => null);

    if (data?.['cod-erro'] === 1001 || data?.erro === 1001) {
      return json({ valid: true, nome: '', error: 'SEM_CREDITOS' });
    }
    if (!data || data.status === 0 || !data.nome) {
      return json({ valid: true, nome: '' });
    }
    if (data.nome === 'Test Token') {
      return json({ valid: true, nome: 'DADOS DE TESTE', nascimento: '' });
    }
    // (QW#6) sucesso com nome -> cacheavel: 1 dia no browser, 30 dias no CDN da
    // Netlify (a chave inclui ?cpf=, entao cada CPF tem sua entrada). Repeticoes do
    // mesmo CPF deixam de pagar nova consulta (R$0,25) na cpfcnpj.com.br.
    return json(
      { valid: true, nome: data.nome || '', nascimento: data.nascimento || '' },
      200,
      { 'Cache-Control': 'public, max-age=86400, s-maxage=2592000' },
    );
  } catch {
    return json({ valid: true, nome: '' });
  }
};

export const config = { path: '/api/cpf-lookup' };
