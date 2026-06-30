// Import dinâmico de canvas-confetti (lazy) — carrega só ao celebrar (#112)
let _confetti = null;
async function loadConfetti() {
  if (!_confetti) {
    const mod = await import('canvas-confetti');
    _confetti = mod.default || mod;
  }
  return _confetti;
}

// CBC celebration confetti with "PRA CIMA CBC" toast
export async function celebrateCBC() {
  const confetti = await loadConfetti();

  // Gold + navy confetti burst
  const colors = ['#C9A84C', '#1B3A5C', '#FFFFFF', '#FFD700', '#2563EB'];

  // Left burst
  confetti({
    particleCount: 80,
    angle: 60,
    spread: 70,
    origin: { x: 0, y: 0.7 },
    colors,
    startVelocity: 45,
    gravity: 0.8,
    ticks: 200,
  });

  // Right burst
  confetti({
    particleCount: 80,
    angle: 120,
    spread: 70,
    origin: { x: 1, y: 0.7 },
    colors,
    startVelocity: 45,
    gravity: 0.8,
    ticks: 200,
  });

  // Center rain
  setTimeout(() => {
    confetti({
      particleCount: 120,
      angle: 90,
      spread: 120,
      origin: { x: 0.5, y: 0.3 },
      colors,
      startVelocity: 30,
      gravity: 0.6,
      ticks: 250,
      shapes: ['circle', 'square'],
    });
  }, 300);

  // Show floating toast "PRA CIMA CBC! 🏆"
  showCBCToast();
}

function showCBCToast() {
  const existing = document.getElementById('cbc-celebration-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'cbc-celebration-toast';
  toast.innerHTML = `
    <div style="
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0);
      z-index: 99999;
      background: linear-gradient(135deg, #1B3A5C, #254D7A);
      color: white;
      padding: 24px 48px;
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      text-align: center;
      animation: cbcToastIn 0.5s ease forwards;
      border: 3px solid #C9A84C;
    ">
      <div style="font-size: 48px; margin-bottom: 8px;">🏆</div>
      <div style="font-size: 28px; font-weight: 900; letter-spacing: 4px; text-transform: uppercase; font-family: serif;">
        PRA CIMA CBC!
      </div>
      <div style="font-size: 13px; opacity: 0.8; margin-top: 8px; letter-spacing: 2px;">
        CONTRATO ASSINADO COM SUCESSO
      </div>
    </div>
    <style>
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

  document.body.appendChild(toast);

  // Fade out after 3 seconds
  setTimeout(() => {
    const inner = toast.firstElementChild;
    if (inner) inner.style.animation = 'cbcToastOut 0.5s ease forwards';
    setTimeout(() => toast.remove(), 500);
  }, 3000);
}
