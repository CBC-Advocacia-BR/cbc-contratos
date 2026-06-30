/**
 * Beacon de métricas do portal: POST { t, eventos: [{e,a,v}] }.
 * Valida o token e grava via RPC portal_track (security definer).
 * LGPD: o front envia só o token + tipo de evento — nenhum dado pessoal trafega.
 * Best-effort: nunca devolve erro ao cliente (métrica não pode quebrar a experiência).
 */
import { db } from './_lib/botDb.mjs';

const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const resp = (status = 200) => new Response(status === 204 ? null : '{"ok":true}', { status, headers: H });

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: H });
  if (req.method !== 'POST') return resp(204);
  let body = {};
  try { body = await req.json(); } catch { return resp(204); }
  const token = String(body.t || '').trim();
  const eventos = Array.isArray(body.eventos) ? body.eventos.slice(0, 50) : [];
  if (!token || token.length < 16 || !eventos.length) return resp(204);
  try {
    await db.rpc('portal_track', { p_token: token, p_eventos: eventos });
  } catch (e) { /* best-effort */ }
  return resp();
};

export const config = { path: '/.netlify/functions/portal-track' };
