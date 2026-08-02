// (auditoria #24) Fonte UNICA do client Supabase para as Netlify Functions.
// Antes cada function criava o seu, com 3 padroes e 4 nomes de env diferentes
// (SUPABASE_KEY / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY / SUPA_KEY) — foi
// exatamente esse tipo de divergencia que causou o bug do mapa ADVBOX (duas copias
// fora de sincronia). Aqui a resolucao de env fica num lugar so.
//
// Prioriza a SERVICE ROLE (bypass legitimo de RLS) e cai para a anon.
//
// 🔎 CORRECAO 02/08/2026 (achado ao conferir o Netlify pelo navegador): a documentacao
// dizia que a SERVICE ROLE nao estava configurada. **Ela esta.** O que NAO existe no
// Netlify e a URL — nao ha `SUPABASE_URL` nem `VITE_SUPABASE_URL`. Como este modulo
// exigia a URL do ambiente e nao tinha fallback, `supa` era SEMPRE null e tudo que
// depende dele degradava em silencio:
//   · db-backup-cron        -> "supabase env ausente" todo dia desde que existe
//   · rate-limit            -> caia para o limitador EM MEMORIA (por instancia), ou seja,
//                              o limite compartilhado no banco nunca funcionou
//                              (`rate_limit_counters` esta VAZIA, conferido no banco)
//   · kommo-note            -> o cache local de notas ja postadas nunca gravou
// O `_lib/botDb.mjs` sempre teve a URL como fallback embutido — por isso a maior parte
// das functions funciona. Aqui a URL passa a ter o MESMO fallback: a URL do projeto e
// publica (ja vai no JavaScript do site), nao e segredo, e amarrar meia duzia de rotinas
// a uma variavel de ambiente que ninguem sabia que faltava nao paga o risco.
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  || 'https://vygczeepvoyaehfchxko.supabase.co';
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
