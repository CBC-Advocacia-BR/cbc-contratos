import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from './lib/supabase';

const AuthContext = createContext(null);

// ─── Anomalous login detection ───
const NORMAL_HOURS = { start: 6, end: 23 }; // 6am - 11pm

async function checkLoginAnomaly(email) {
  const hour = new Date().getHours();
  const isOddHour = hour < NORMAL_HOURS.start || hour >= NORMAL_HOURS.end;

  // Check IP geolocation (lightweight)
  let ipInfo = null;
  try {
    const resp = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(3000) });
    if (resp.ok) ipInfo = await resp.json();
  } catch { /* silent */ }

  const isAbroadIP = ipInfo && ipInfo.country_code && ipInfo.country_code !== 'BR';

  const warnings = [];
  if (isOddHour) warnings.push(`Login em horario incomum (${hour}h). Se nao foi voce, altere sua senha.`);
  if (isAbroadIP) warnings.push(`Login de IP fora do Brasil (${ipInfo.country_name}, ${ipInfo.city}). Se nao foi voce, altere sua senha imediatamente.`);

  // Log to Supabase
  if (warnings.length > 0) {
    try {
      await supabase.from('activity_log').insert({
        action: 'login_anomalo',
        details: { email, hour, ip: ipInfo?.ip, country: ipInfo?.country_code, city: ipInfo?.city, warnings },
        user_email: email,
      });
    } catch { /* silent */ }
  }

  return warnings;
}


export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loginWarnings, setLoginWarnings] = useState([]);

  // Check existing Supabase session on mount
  useEffect(() => {
    const initSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          setUser({
            id: session.user.id,
            email: session.user.email,
            name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || '',
            token: session.access_token,
          });
        }
      } catch { /* ignora */ }
      setLoading(false);
    };
    initSession();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email,
          name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || '',
          token: session.access_token,
        });
      } else {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = useCallback(async (credentials) => {
    // If credentials is already a user object (from LoginScreen after signIn),
    // just set it directly
    if (credentials.id && credentials.email) {
      setUser(credentials);
      // (#27) REGRA #13 — checagem de login anomalo TAMBEM neste caminho. Este e o fluxo
      // realmente usado pelo LoginScreen (ja faz signInWithPassword e chama login com o
      // objeto do usuario); antes a checagem so existia no branch abaixo, que nunca roda.
      checkLoginAnomaly(credentials.email).then(warnings => {
        if (warnings.length > 0) setLoginWarnings(warnings);
      });
      return;
    }
    // Otherwise, sign in with email/password
    const { data, error } = await supabase.auth.signInWithPassword({
      email: credentials.email,
      password: credentials.password,
    });
    if (error) throw error;
    const u = data.user;
    const newUser = {
      id: u.id,
      email: u.email,
      name: u.user_metadata?.name || u.email?.split('@')[0] || '',
      token: data.session.access_token,
    };
    setUser(newUser);
    // Check for anomalous login (async, non-blocking)
    checkLoginAnomaly(newUser.email).then(warnings => {
      if (warnings.length > 0) setLoginWarnings(warnings);
    });
  }, []);

  const loginWithGoogle = useCallback(async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch { /* best-effort */ }
    setUser(null);
  }, []);

  const dismissWarnings = useCallback(() => setLoginWarnings([]), []);

  // (perf 31/05) value memoizado — evita recriar o objeto a cada render do provider
  // e o re-render em cascata de todos os consumidores quando nada relevante mudou.
  const value = useMemo(
    () => ({ user, loading, login, loginWithGoogle, logout, loginWarnings, dismissWarnings }),
    [user, loading, login, loginWithGoogle, logout, loginWarnings, dismissWarnings]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be within AuthProvider');
  return ctx;
}
