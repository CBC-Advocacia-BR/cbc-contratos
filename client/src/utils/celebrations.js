// (#23) Celebracoes contextuais — centraliza todas as comemoracoes do sistema.
// Confetti carregado dinamicamente (lazy) conforme padrao em utils/confetti.js.

import { celebrateCBC } from './confetti';

let _confetti = null;
async function loadConfetti() {
  if (!_confetti) {
    const mod = await import('canvas-confetti');
    _confetti = mod.default || mod;
  }
  return _confetti;
}

const CBC_COLORS = ['#C9A84C', '#1B3A5C', '#FFFFFF', '#FFD700', '#2563EB'];
const FIREWORK_COLORS = ['#FFD700', '#FF6B6B', '#4ECDC4', '#C9A84C', '#A855F7', '#22C55E', '#2563EB'];

// ─────────────────────────────────────────────────────────────
// Helpers para toasts/banners
// ─────────────────────────────────────────────────────────────
function showBanner({ emoji, title, subtitle, gradient = 'linear-gradient(135deg, #1B3A5C, #254D7A)', borderColor = '#C9A84C', durationMs = 3000, position = 'top' }) {
  const id = `cbc-celebration-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
  const container = document.createElement('div');
  container.id = id;
  const posStyle = position === 'top'
    ? 'top: 24px; left: 50%; transform: translateX(-50%) translateY(-20px);'
    : 'top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0);';
  const animIn = position === 'top' ? 'cbcBannerSlideIn' : 'cbcToastIn';
  const animOut = position === 'top' ? 'cbcBannerSlideOut' : 'cbcToastOut';

  container.innerHTML = `
    <div style="
      position: fixed;
      ${posStyle}
      z-index: 99999;
      background: ${gradient};
      color: white;
      padding: ${position === 'top' ? '14px 22px' : '24px 48px'};
      border-radius: ${position === 'top' ? '14px' : '20px'};
      box-shadow: 0 12px 40px rgba(0,0,0,0.35);
      text-align: center;
      animation: ${animIn} 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
      border: 2px solid ${borderColor};
      display: flex; align-items: center; gap: 12px;
      font-family: 'Lato', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 90vw;
    ">
      <div style="font-size: ${position === 'top' ? '26px' : '48px'}; line-height:1;">${emoji}</div>
      <div style="text-align: left;">
        <div style="font-size: ${position === 'top' ? '14px' : '26px'}; font-weight: 800; letter-spacing: 1px; text-transform: uppercase;">${title}</div>
        ${subtitle ? `<div style="font-size: ${position === 'top' ? '11px' : '13px'}; opacity: 0.85; margin-top: 2px; letter-spacing: 1px;">${subtitle}</div>` : ''}
      </div>
    </div>
    <style>
      @keyframes cbcBannerSlideIn {
        from { transform: translateX(-50%) translateY(-30px); opacity: 0; }
        to   { transform: translateX(-50%) translateY(0); opacity: 1; }
      }
      @keyframes cbcBannerSlideOut {
        from { transform: translateX(-50%) translateY(0); opacity: 1; }
        to   { transform: translateX(-50%) translateY(-30px); opacity: 0; }
      }
      @keyframes cbcToastIn {
        0% { transform: translate(-50%, -50%) scale(0) rotate(-10deg); }
        60% { transform: translate(-50%, -50%) scale(1.1) rotate(2deg); }
        100% { transform: translate(-50%, -50%) scale(1) rotate(0deg); }
      }
      @keyframes cbcToastOut {
        0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        100% { opacity: 0; transform: translate(-50%, -50%) scale(0.8) translateY(-30px); }
      }
    </style>
  `;
  document.body.appendChild(container);
  setTimeout(() => {
    const inner = container.firstElementChild;
    if (inner) inner.style.animation = `${animOut} 0.4s ease forwards`;
    setTimeout(() => container.remove(), 450);
  }, durationMs);
}

// ─────────────────────────────────────────────────────────────
// Fogos de artificio (multiplos bursts ao longo de 3s)
// ─────────────────────────────────────────────────────────────
async function fireworksBurst(durationMs = 3000) {
  const confetti = await loadConfetti();
  const end = Date.now() + durationMs;

  function frame() {
    if (Date.now() > end) return;
    const angle = 60 + Math.random() * 60;
    confetti({
      particleCount: 40 + Math.floor(Math.random() * 30),
      angle,
      spread: 50 + Math.random() * 40,
      origin: { x: 0.1 + Math.random() * 0.8, y: 0.4 + Math.random() * 0.3 },
      colors: FIREWORK_COLORS,
      startVelocity: 35 + Math.random() * 25,
      gravity: 0.9,
      ticks: 220,
      shapes: ['circle', 'square'],
      scalar: 0.8 + Math.random() * 0.4,
    });
    setTimeout(frame, 220 + Math.random() * 180);
  }
  frame();
}

// ─────────────────────────────────────────────────────────────
// Utilitarios de data / flags localStorage
// ─────────────────────────────────────────────────────────────
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function monthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function flagFired(key) {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function markFired(key) {
  try { localStorage.setItem(key, '1'); } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────
// Meta mensal (configuravel)
// ─────────────────────────────────────────────────────────────
const DEFAULT_MONTHLY_GOAL = 15;
export function getMonthlyGoal() {
  try {
    const v = localStorage.getItem('cbc-goal-monthly');
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  } catch { /* ignora */ }
  return DEFAULT_MONTHLY_GOAL;
}
export function setMonthlyGoal(goal) {
  try { localStorage.setItem('cbc-goal-monthly', String(goal)); } catch { /* ignora */ }
}

// ─────────────────────────────────────────────────────────────
// Celebracoes publicas
// ─────────────────────────────────────────────────────────────

// Contrato assinado (existente)
function signed(name) {
  return celebrateCBC(name);
}

// Meta mensal batida (dispara 1 vez por mes)
function monthlyGoal(count, goal = getMonthlyGoal()) {
  const key = `cbc-celebrated-goal-${monthKey()}`;
  if (flagFired(key)) return false;
  markFired(key);
  fireworksBurst(3000);
  showBanner({
    emoji: '\uD83C\uDF89', // 🎉
    title: `META BATIDA! ${count}/${goal} contratos`,
    subtitle: 'Mes recorde — parabens equipe CBC!',
    gradient: 'linear-gradient(135deg, #16A34A, #22C55E)',
    borderColor: '#FFD700',
    durationMs: 4500,
    position: 'center',
  });
  return true;
}

// Primeiro contrato do dia (banner discreto no topo)
function firstOfDay() {
  const key = `cbc-first-contract-${todayKey()}`;
  if (flagFired(key)) return false;
  markFired(key);
  showBanner({
    emoji: '\u2615', // ☕
    title: 'Primeiro contrato do dia!',
    subtitle: 'Bora pra mais uma rodada de vitorias',
    gradient: 'linear-gradient(135deg, #1B3A5C, #264A72)',
    borderColor: '#C9A84C',
    durationMs: 3500,
    position: 'top',
  });
  return true;
}

// Milestone 100 contratos
function milestone100() {
  const key = 'cbc-milestone-100';
  if (flagFired(key)) return false;
  markFired(key);
  fireworksBurst(2500);
  showBanner({
    emoji: '\uD83C\uDFC6', // 🏆
    title: '100 contratos assinados!',
    subtitle: 'Marco historico do escritorio',
    gradient: 'linear-gradient(135deg, #C9A84C, #B8860B)',
    borderColor: '#FFD700',
    durationMs: 5000,
    position: 'center',
  });
  return true;
}

// Milestone 500 (super celebracao)
function milestone500() {
  const key = 'cbc-milestone-500';
  if (flagFired(key)) return false;
  markFired(key);
  fireworksBurst(5000);
  showBanner({
    emoji: '\uD83D\uDC51', // 👑
    title: '500 CONTRATOS!',
    subtitle: 'Lendario — a CBC conquistou o mundo',
    gradient: 'linear-gradient(135deg, #A855F7, #6D28D9)',
    borderColor: '#FFD700',
    durationMs: 6000,
    position: 'center',
  });
  return true;
}

// Milestone generico (marcos intermediarios: 50, 200, 300, etc.)
function milestone(n) {
  const key = `cbc-milestone-${n}`;
  if (flagFired(key)) return false;
  markFired(key);
  fireworksBurst(2000);
  showBanner({
    emoji: '\uD83C\uDFAF', // 🎯
    title: `${n} contratos assinados!`,
    subtitle: 'Continue assim',
    gradient: 'linear-gradient(135deg, #2563EB, #1E40AF)',
    borderColor: '#FFD700',
    durationMs: 4000,
    position: 'center',
  });
  return true;
}

// Assinatura rapida (< 1h apos envio)
function fastSignature(minutes) {
  fireworksBurst(1500);
  showBanner({
    emoji: '\u26A1', // ⚡
    title: 'Rapidez de raio!',
    subtitle: `Assinado em ${Math.max(1, Math.round(minutes))} min`,
    gradient: 'linear-gradient(135deg, #F59E0B, #D97706)',
    borderColor: '#FFD700',
    durationMs: 3500,
    position: 'top',
  });
  return true;
}

// Primeiro contrato de um novo resort
function newResort(resort) {
  showBanner({
    emoji: '\uD83C\uDFAF', // 🎯
    title: `Primeiro contrato no ${resort}!`,
    subtitle: 'Novo resort conquistado',
    gradient: 'linear-gradient(135deg, #1B3A5C, #264A72)',
    borderColor: '#C9A84C',
    durationMs: 3500,
    position: 'top',
  });
  return true;
}

export const celebrations = {
  signed,
  monthlyGoal,
  firstOfDay,
  milestone100,
  milestone500,
  milestone,
  fastSignature,
  newResort,
};

// Re-export helpers para outros modulos
export { fireworksBurst };
