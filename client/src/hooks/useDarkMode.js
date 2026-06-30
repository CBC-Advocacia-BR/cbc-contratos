import { useState, useEffect } from 'react';

const DARK_KEY = 'cbc_dark_mode';

export function useDarkMode() {
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem(DARK_KEY);
      // If user has explicit preference, honor it
      if (saved === 'true') return true;
      if (saved === 'false') return false;
      // No saved preference — respect system preference (prefers-color-scheme: dark)
      if (typeof window !== 'undefined' && window.matchMedia) {
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
      return false;
    } catch { return false; }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem(DARK_KEY, String(dark)); } catch { /* ignora */ }
  }, [dark]);

  return [dark, () => setDark(d => !d)];
}
