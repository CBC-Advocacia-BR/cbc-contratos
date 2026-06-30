// Helper de chamada a function advbox-bot-reply (backend do Bot ADVBOX)
const BOT_KEY = import.meta.env.VITE_BOT_PANEL_KEY || 'cbc-bot-2026';

export async function botApi(action, params = {}) {
  const resp = await fetch('/.netlify/functions/advbox-bot-reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bot-key': BOT_KEY },
    body: JSON.stringify({ action, ...params }),
  });
  const data = await resp.json().catch(() => ({ ok: false, error: `HTTP ${resp.status}` }));
  if (!data.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

// Mesma normalizacao usada no engine (para testes locais de glossario/intencao)
export function normalize(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function glossaryTranslateLocal(title, glossary) {
  const norm = normalize(title);
  for (const g of glossary) {
    if (!g.active) continue;
    const term = normalize(g.term);
    if (!term) continue;
    if (g.match_type === 'exact' && norm === term) return g;
    if (g.match_type === 'regex') {
      try { if (new RegExp(g.term, 'i').test(title)) return g; } catch { /* regex invalida */ }
    }
    if ((g.match_type || 'contains') === 'contains' && norm.includes(term)) return g;
  }
  return null;
}

export function classifyIntentLocal(text, intents) {
  const norm = ' ' + normalize(text) + ' ';
  let best = null;
  for (const it of intents) {
    if (!it.active) continue;
    for (const kw of it.keywords || []) {
      const k = normalize(kw);
      if (k && norm.includes(k)) {
        if (!best || it.priority < best.priority) best = it;
        break;
      }
    }
  }
  return best;
}
