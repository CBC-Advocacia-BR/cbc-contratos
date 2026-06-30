import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { EnvelopeIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';

export default function LoginScreen({ onLogin, onGoogleLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [visible, setVisible] = useState(false);

  // Fade-in animation
  useEffect(() => { const t = setTimeout(() => setVisible(true), 50); return () => clearTimeout(t); }, []);

  const handleLogin = async (e) => {
    e?.preventDefault();
    if (!email.trim() || !password) {
      setError('Preencha e-mail e senha.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authError) throw authError;
      const u = data.user;
      if (remember) {
        try { localStorage.setItem('cbc_remember_email', email.trim()); } catch { /* ignora */ }
      } else {
        try { localStorage.removeItem('cbc_remember_email'); } catch { /* ignora */ }
      }
      onLogin({
        id: u.id,
        email: u.email,
        name: u.user_metadata?.name || u.email?.split('@')[0] || '',
        token: data.session.access_token,
      });
    } catch (err) {
      setError(err.message === 'Invalid login credentials'
        ? 'E-mail ou senha incorretos.'
        : err.message || 'Erro ao fazer login.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e) => {
    e?.preventDefault();
    if (!email.trim()) { setError('Informe seu e-mail.'); return; }
    setLoading(true);
    setError('');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      setResetSent(true);
    } catch (err) {
      setError(err.message || 'Erro ao enviar email de recuperacao.');
    } finally {
      setLoading(false);
    }
  };

  // Load remembered email
  useEffect(() => {
    try {
      const saved = localStorage.getItem('cbc_remember_email');
      if (saved) setEmail(saved);
    } catch { /* ignora */ }
  }, []);

  const handleKeyDown = (e) => { if (e.key === 'Enter') resetMode ? handleReset() : handleLogin(); };

  return (
    /* (mobile 06/2026) overflow-y-auto + py: com o teclado iOS aberto o card
       de ~600px ficava cortado sem scroll (botão Entrar fora da tela) */
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto py-6"
      style={{ background: 'linear-gradient(135deg, #0C1E32 0%, #1B3A5C 50%, #254D7A 100%)' }}>
      {/* Animated card */}
      <div
        className="w-full max-w-[400px] mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden"
        style={{
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(20px)',
          transition: 'opacity 0.6s ease, transform 0.6s ease',
        }}>
        {/* Header with real logo */}
        <div className="pt-8 pb-4 flex flex-col items-center">
          <div
            className="w-[100px] h-[100px] mb-4 flex items-center justify-center"
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? 'scale(1)' : 'scale(0.8)',
              transition: 'opacity 0.8s ease 0.2s, transform 0.8s ease 0.2s',
            }}>
            {/* (#118) WebP com fallback PNG — reduz ~40% vs PNG */}
            <picture>
              <source srcSet="/logo-navy.webp" type="image/webp" />
              <img src="/logo-navy.png" alt="CBC Advogados" className="w-full h-full object-contain" /></picture>
          </div>
          <div
            className="text-[13px] font-bold tracking-[2px] uppercase"
            style={{
              color: '#1B3A5C',
              opacity: visible ? 1 : 0,
              transition: 'opacity 0.6s ease 0.3s',
            }}>
            Conforto, Bergonsi & Cavalari
          </div>
          <div className="text-[10px] font-bold tracking-[3px] uppercase text-gray-400 mt-0.5"
            style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.6s ease 0.4s' }}>
            Advogados
          </div>
          <hr className="w-16 border-t-2 mt-4 mb-3" style={{ borderColor: '#C9A84C' }} />
          <div className="text-[11px] font-bold tracking-[1px] uppercase text-gray-500">
            {resetMode ? 'Recuperar Senha' : 'Gerador de Contratos'}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={resetMode ? handleReset : handleLogin} className="px-8 pb-8">
          {error && (
            <div className="mb-4 p-3 rounded-lg text-[12px] text-red-700 font-medium animate-shake"
              style={{ background: '#FEF0F0', border: '1px solid #FECACA' }}>
              {error}
            </div>
          )}

          {resetSent ? (
            <div className="text-center py-4">
              <EnvelopeIcon className="w-12 h-12 mx-auto mb-3" style={{ color: '#1B3A5C' }} aria-hidden="true" />
              <div className="text-sm font-bold" style={{ color: '#1B3A5C' }}>E-mail enviado!</div>
              <div className="text-xs text-gray-500 mt-2">Verifique sua caixa de entrada para redefinir a senha.</div>
              <button type="button" onClick={() => { setResetMode(false); setResetSent(false); setError(''); }}
                className="mt-4 text-xs font-bold cursor-pointer hover:underline" style={{ color: '#1B3A5C' }}>
                Voltar ao login
              </button>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <label className="block text-[10px] font-bold uppercase tracking-[1px] mb-1.5" style={{ color: '#5A6070' }}>
                  E-mail
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="seu@advocaciacbc.com"
                  autoFocus
                  autoComplete="username"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-label="Email"
                  className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 transition-all"
                  style={{ borderColor: '#CBD3DC', color: '#1A1A1A' }}
                />
              </div>

              {!resetMode && (
                <>
                  <div className="mb-4">
                    <label className="block text-[10px] font-bold uppercase tracking-[1px] mb-1.5" style={{ color: '#5A6070' }}>
                      Senha
                    </label>
                    <div className="relative">
                      <input
                        type={showPwd ? 'text' : 'password'}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="••••••••"
                        autoComplete="current-password"
                        aria-label="Senha"
                        className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 transition-all pr-10"
                        style={{ borderColor: '#CBD3DC', color: '#1A1A1A' }}
                      />
                      <button type="button" onClick={() => setShowPwd(!showPwd)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
                        tabIndex={-1} aria-label={showPwd ? 'Ocultar senha' : 'Mostrar senha'}>
                        {showPwd ? <EyeSlashIcon className="w-4 h-4" aria-hidden="true" /> : <EyeIcon className="w-4 h-4" aria-hidden="true" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mb-6">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}
                        className="w-3.5 h-3.5 rounded cursor-pointer accent-[#1B3A5C]" />
                      <span className="text-[11px] text-gray-500">Lembrar de mim</span>
                    </label>
                    <button type="button" onClick={() => { setResetMode(true); setError(''); }}
                      className="text-[11px] font-bold cursor-pointer hover:underline" style={{ color: '#1B3A5C' }}>
                      Esqueci a senha
                    </button>
                  </div>
                </>
              )}

              <button type="submit" disabled={loading}
                className="w-full py-3 rounded-lg text-white font-bold text-[12px] uppercase tracking-[1px] cursor-pointer transition-all hover:opacity-90 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-blue-300"
                style={{ background: '#1B3A5C' }}>
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    {resetMode ? 'Enviando...' : 'Entrando...'}
                  </span>
                ) : (
                  resetMode ? 'Enviar Link de Recuperacao' : 'Entrar'
                )}
              </button>

              {resetMode && (
                <button type="button" onClick={() => { setResetMode(false); setError(''); }}
                  className="w-full mt-3 py-2.5 rounded-lg font-bold text-[12px] uppercase tracking-[1px] cursor-pointer transition-all hover:bg-gray-50 border border-gray-200"
                  style={{ color: '#1B3A5C' }}>
                  Voltar ao Login
                </button>
              )}

              {!resetMode && (
                <>
                  <div className="relative my-4">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200"></div></div>
                    <div className="relative flex justify-center text-[10px]"><span className="bg-white px-3 text-gray-400">ou</span></div>
                  </div>

                  <button type="button" onClick={onGoogleLogin}
                    className="w-full py-3 rounded-lg font-bold text-[12px] uppercase tracking-[1px] cursor-pointer transition-all hover:bg-gray-50 border border-gray-200 flex items-center justify-center gap-2"
                    style={{ color: '#333' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    Entrar com Google
                  </button>

                  <div className="text-center mt-4 text-[10px] text-gray-400">
                    Acesso restrito — apenas usuarios autorizados
                  </div>
                </>
              )}
            </>
          )}
        </form>
      </div>
    </div>
  );
}
