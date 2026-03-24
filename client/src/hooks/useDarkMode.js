import { useState, useEffect } from 'react';

const DARK_KEY = 'cbc_dark_mode';

export function useDarkMode() {
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem(DARK_KEY) === 'true'; } catch { return false; }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem(DARK_KEY, String(dark)); } catch {}
  }, [dark]);

  return [dark, () => setDark(d => !d)];
}
