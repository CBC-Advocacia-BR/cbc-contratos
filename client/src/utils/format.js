// ─────────────────────────────────────────────────────────────────────────
// Formatadores compartilhados (extract 20/06/2026)
// Consolidam os ~11 formatters de moeda/data/tempo duplicados pelas telas.
// MoneyValue (components/ui) e FreshnessChip consomem daqui.
// ─────────────────────────────────────────────────────────────────────────

// Moeda BRL com centavos (R$ 1.234,56)
export const fmtBRL = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Moeda BRL sem centavos (R$ 1.235) — usado em cards/kanban compactos
export const fmtBRL0 = (v) =>
  Number(v || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

// Data "AAAA-MM-DD" -> dd/mm/aaaa (meia-dia evita drift de fuso)
export const fmtDateBR = (d) =>
  d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '—';

// ISO -> data + hora curtas (pt-BR)
export const fmtDateTimeBR = (iso) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

// Tempo relativo compacto: "agora" / "há 6 min" / "há 3h" / "há 2d".
// Datas futuras viram "em ...".
export function timeAgo(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const futuro = ms < 0;
  const abs = Math.abs(ms);
  const min = Math.floor(abs / 60000);
  let txt;
  if (min < 1) return 'agora';
  if (min < 60) txt = `${min} min`;
  else {
    const h = Math.floor(min / 60);
    if (h < 24) txt = `${h}h`;
    else txt = `${Math.floor(h / 24)}d`;
  }
  return futuro ? `em ${txt}` : `há ${txt}`;
}
