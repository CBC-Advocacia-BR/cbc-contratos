import { useState } from 'react';
import { API_URL } from '../config';

const CBC_LOGO = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80"><rect width="200" height="80" fill="#1B3A5C" rx="8"/><text x="100" y="35" fill="#C9A84C" font-family="serif" font-size="28" font-weight="bold" text-anchor="middle">CBC</text><text x="100" y="55" fill="#E8E0D0" font-family="sans-serif" font-size="9" text-anchor="middle" letter-spacing="2">ADVOGADOS</text></svg>`);

export default function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e?.preventDefault();
    if (!email.trim() || !password) {
      setError('Preencha e-mail e senha.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'E-mail ou senha incorretos.');
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter') handleLogin(); };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'linear-gradient(135deg, #0C1E32 0%, #1B3A5C 50%, #254D7A 100%)' }}>
      <div className="w-full max-w-[400px] mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
        {/* Header */}
        <div className="pt-8 pb-4 flex flex-col items-center">
          <img src={CBC_LOGO} alt="CBC Advogados" className="w-[140px] h-auto mb-4 rounded-lg" />
          <div className="text-[13px] font-bold tracking-[2px] uppercase" style={{ color: '#1B3A5C' }}>
            Conforto, Bergonsi & Cavalari
          </div>
          <div className="text-[10px] font-bold tracking-[3px] uppercase text-gray-400 mt-0.5">
            Advogados
          </div>
          <hr className="w-16 border-t-2 mt-4 mb-3" style={{ borderColor: '#C9A84C' }} />
          <div className="text-[11px] font-bold tracking-[1px] uppercase text-gray-500">
            Gerador de Contratos
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="px-8 pb-8">
          {error && (
            <div className="mb-4 p-3 rounded-lg text-[12px] text-red-700 font-medium"
              style={{ background: '#FEF0F0', border: '1px solid #FECACA' }}>
              {error}
            </div>
          )}

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
              className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none transition-colors"
              style={{ borderColor: '#CBD3DC', color: '#1A1A1A' }}
              onFocus={e => e.target.style.borderColor = '#1B3A5C'}
              onBlur={e => e.target.style.borderColor = '#CBD3DC'}
            />
          </div>

          <div className="mb-6">
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
                className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none transition-colors pr-10"
                style={{ borderColor: '#CBD3DC', color: '#1A1A1A' }}
                onFocus={e => e.target.style.borderColor = '#1B3A5C'}
                onBlur={e => e.target.style.borderColor = '#CBD3DC'}
              />
              <button type="button" onClick={() => setShowPwd(!showPwd)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer text-sm"
                tabIndex={-1}>
                {showPwd ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading}
            className="w-full py-3 rounded-lg text-white font-bold text-[12px] uppercase tracking-[1px] cursor-pointer transition-all hover:opacity-90 disabled:opacity-60"
            style={{ background: '#1B3A5C' }}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>

          <div className="text-center mt-4 text-[10px] text-gray-400">
            Acesso restrito — apenas usuarios autorizados
          </div>
        </form>
      </div>
    </div>
  );
}
