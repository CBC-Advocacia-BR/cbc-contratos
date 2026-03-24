import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { API_URL } from './config';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Check existing session on mount
  useEffect(() => {
    const checkSession = async () => {
      try {
        const resp = await fetch(`${API_URL}/api/auth/session`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('cbc_auth_token') || ''}` },
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.user) { setUser(data.user); }
        }
      } catch {}
      setLoading(false);
    };
    checkSession();
  }, []);

  const login = useCallback((userData) => {
    setUser(userData);
    if (userData.token) localStorage.setItem('cbc_auth_token', userData.token);
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cbc_auth_token') || ''}` },
      });
    } catch {}
    localStorage.removeItem('cbc_auth_token');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be within AuthProvider');
  return ctx;
}
