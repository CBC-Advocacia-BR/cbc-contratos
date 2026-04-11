import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase, SUPABASE_CONFIGURED } from '../lib/supabaseClient';

const AuthContext = createContext(null);

export function TesesAuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadProfile = useCallback(async (userId) => {
    if (!userId) { setProfile(null); return; }
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) setError(error.message);
    setProfile(data || null);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session || null);
      if (data.session?.user) await loadProfile(data.session.user.id);
      setLoading(false);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, sess) => {
      setSession(sess || null);
      if (sess?.user) await loadProfile(sess.user.id);
      else setProfile(null);
    });
    return () => { mounted = false; sub?.subscription?.unsubscribe?.(); };
  }, [loadProfile]);

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/teses' },
    });
    if (error) setError(error.message);
  }, []);

  const signInWithEmail = useCallback(async (email, password) => {
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    return !error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user?.id) await loadProfile(session.user.id);
  }, [session, loadProfile]);

  const role = profile?.role || null;
  const is = (...roles) => roles.includes(role);

  return (
    <AuthContext.Provider
      value={{
        session, profile, role, loading, error,
        isConfigured: SUPABASE_CONFIGURED,
        signInWithGoogle, signInWithEmail, signOut, refreshProfile, is,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTesesAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useTesesAuth deve estar dentro de TesesAuthProvider');
  return ctx;
}
