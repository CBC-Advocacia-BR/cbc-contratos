import { useState, useEffect } from 'react';

const DENSITY_KEY = 'cbc-density';
const VALID = ['compact', 'comfortable', 'spacious'];
const DEFAULT = 'comfortable';

export function useDensity() {
  const [density, setDensityState] = useState(() => {
    try {
      const saved = localStorage.getItem(DENSITY_KEY);
      if (saved && VALID.includes(saved)) return saved;
      return DEFAULT;
    } catch { return DEFAULT; }
  });

  useEffect(() => {
    // Toggle density classes on <html>
    const root = document.documentElement;
    VALID.forEach(d => root.classList.remove(`density-${d}`));
    root.classList.add(`density-${density}`);
    try { localStorage.setItem(DENSITY_KEY, density); } catch { /* ignora */ }
  }, [density]);

  const setDensity = (d) => {
    if (VALID.includes(d)) setDensityState(d);
  };

  return [density, setDensity];
}

export const DENSITY_OPTIONS = VALID;
