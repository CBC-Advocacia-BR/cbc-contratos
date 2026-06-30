// ─────────────────────────────────────────────────────────────────────────
// useDeviceType — detecta classe de dispositivo + orientation + capabilities
// ─────────────────────────────────────────────────────────────────────────
// (iPad 2026-06) Substitui o velho `isMobile = window.innerWidth < 768`
// por uma matriz mais rica que reflete o estado real do device:
//
//   class:       'phone' | 'tablet' | 'desktop'
//   orientation: 'portrait' | 'landscape'
//   pointer:     'fine' (mouse/trackpad) | 'coarse' (touch)
//   hover:       'hover' (mouse) | 'none' (pure touch)
//   isIpadAir13: boolean (heuristica para iPad Air 13")
//
// Breakpoints (devicePixelRatio-aware via window.innerWidth):
//   <=640: phone
//   641-1366: tablet (cobre iPad Air 13" landscape)
//   >=1367: desktop
//
// Re-renderiza em resize/orientation com debounce de 100ms.
// ─────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';

function getMqState() {
  if (typeof window === 'undefined') {
    return {
      width: 1024, height: 768,
      class: 'desktop', orientation: 'landscape',
      pointer: 'fine', hover: 'hover',
      isIpadAir13: false, isPhone: false, isTablet: false, isDesktop: true,
      isLandscape: true, isPortrait: false,
    };
  }
  const w = window.innerWidth;
  const h = window.innerHeight;
  const orientation = w >= h ? 'landscape' : 'portrait';
  let cls;
  if (w <= 640) cls = 'phone';
  else if (w <= 1366) cls = 'tablet';
  else cls = 'desktop';

  const pointer = window.matchMedia?.('(pointer: coarse)').matches ? 'coarse' : 'fine';
  const hover = window.matchMedia?.('(hover: hover)').matches ? 'hover' : 'none';

  // Heuristic: iPad Air 13" reporta 1366x1024 landscape or 1024x1366 portrait,
  // pointer=coarse + Safari iOS userAgent (ou iPadOS desktop mode com touch).
  const ua = navigator.userAgent || '';
  const isApplePlatform = /iPad|iPhone|iPod|Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const matchesIpad13Dims =
    (w === 1366 && h === 1024) || (w === 1024 && h === 1366) ||
    (w === 1180 && h === 820)  || (w === 820 && h === 1180)  || // iPad Air 11"
    (Math.abs(Math.max(w, h) - 1366) < 50 && Math.abs(Math.min(w, h) - 1024) < 50);
  const isIpadAir13 = isApplePlatform && pointer === 'coarse' && matchesIpad13Dims;

  return {
    width: w, height: h,
    class: cls,
    orientation,
    pointer,
    hover,
    isIpadAir13,
    isPhone: cls === 'phone',
    isTablet: cls === 'tablet',
    isDesktop: cls === 'desktop',
    isLandscape: orientation === 'landscape',
    isPortrait: orientation === 'portrait',
    isTouchDevice: pointer === 'coarse',
  };
}

export function useDeviceType() {
  const [state, setState] = useState(getMqState);

  useEffect(() => {
    let raf = null;
    let timeout = null;
    const onChange = () => {
      // Debounce + rAF para evitar storm em rotation
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => setState(getMqState()));
      }, 100);
    };
    window.addEventListener('resize', onChange, { passive: true });
    window.addEventListener('orientationchange', onChange, { passive: true });
    return () => {
      window.removeEventListener('resize', onChange);
      window.removeEventListener('orientationchange', onChange);
      clearTimeout(timeout);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return state;
}

// Helper: classe CSS reflete device class — util para attribute selectors
export function applyDeviceClass(deviceState) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.device = deviceState.class;
  root.dataset.orientation = deviceState.orientation;
  root.dataset.pointer = deviceState.pointer;
  if (deviceState.isIpadAir13) root.dataset.ipad13 = '1';
  else delete root.dataset.ipad13;
}
