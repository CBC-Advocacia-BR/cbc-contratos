// Supabase client para CBC TESES.
// Requer as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env
// Em dev, se não existirem, usamos um cliente "fake" que retorna mensagens
// claras indicando que o Supabase não está configurado, para que o
// restante da UI possa ser exercitado localmente sem crash total.

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const SUPABASE_CONFIGURED = Boolean(url && anonKey);

function makeStub() {
  const msg = 'Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.';
  const chain = () => {
    const p = Promise.resolve({ data: null, error: { message: msg } });
    const api = new Proxy(p, {
      get(target, prop) {
        if (prop in target) return target[prop].bind(target);
        // encadeia qualquer método como no-op retornando o próprio chain
        return () => chain();
      },
    });
    return api;
  };
  return {
    auth: {
      async getSession() { return { data: { session: null }, error: null }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithOAuth() { return { data: null, error: { message: msg } }; },
      async signInWithPassword() { return { data: null, error: { message: msg } }; },
      async signOut() { return { error: null }; },
    },
    from() { return chain(); },
    storage: { from() { return { async upload() { return { data: null, error: { message: msg } }; }, async getPublicUrl() { return { data: { publicUrl: '' } }; } }; } },
    channel() { return { on() { return this; }, subscribe() { return this; }, unsubscribe() {} }; },
    removeChannel() {},
  };
}

export const supabase = SUPABASE_CONFIGURED
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : makeStub();

export function supabaseConfigWarning() {
  return SUPABASE_CONFIGURED
    ? null
    : 'Configuração incompleta: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env do client.';
}
