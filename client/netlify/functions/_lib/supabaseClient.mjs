// (auditoria #24) Fonte UNICA do client Supabase para as Netlify Functions.
// Antes cada function criava o seu, com 3 padroes e 4 nomes de env diferentes
// (SUPABASE_KEY / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY / SUPA_KEY) — foi
// exatamente esse tipo de divergencia que causou o bug do mapa ADVBOX (duas copias
// fora de sincronia). Aqui a resolucao de env fica num lugar so.
//
// Prioriza a SERVICE ROLE (bypass legitimo de RLS quando estiver configurada) e cai
// para a anon. HOJE a service role ainda nao esta setada, entao o comportamento e
// identico ao atual (anon); quando for configurada (pendencia de seguranca), as
// functions que adotarem este helper passam a gravar com service role sem novo deploy.
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY;

export const usingServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

// Client em ESCOPO DE MODULO — reutilizado entre invocacoes quentes (menos cold start).
// null-safe: se faltar env, quem usa deve chamar requireSupa() e tratar o erro.
export const supa = (SUPA_URL && SUPA_KEY)
  ? createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } })
  : null;

export function requireSupa() {
  if (!supa) throw new Error('Supabase env ausente (defina SUPABASE_URL e uma *_KEY no Netlify)');
  return supa;
}
