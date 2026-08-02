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

// Mes "YYYY-MM" em HORA LOCAL — nunca toISOString() (UTC): apos as 21h BRT
// do ultimo dia do mes o UTC ja virou o mes seguinte e o "mes atual" zera.
export const ymLocal = (dt) =>
  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;

// Dia "YYYY-MM-DD" em HORA LOCAL — mesmo motivo do ymLocal: apos as 21h BRT
// o dia UTC ja e amanha e "hoje" desloca em filtros, min/max e comparacoes.
export const ymdLocal = (dt = new Date()) =>
  `${ymLocal(dt)}-${String(dt.getDate()).padStart(2, '0')}`;

// ─── (auditoria 01/08/2026 — item 227) STRING ISO do banco -> dia/mes LOCAL ───
// Os computes do funil cortavam a string crua (`String(iso).slice(0,7)`), que vem em
// UTC do PostgREST: uma videochamada das 21h BRT de 31/07 chega como "2026-08-01T00:00Z"
// e era contada em AGOSTO. Por isso o mesmo mes fechava diferente em duas telas.
//
// ⚠️ Regra de ouro (mesma do kommoResolve): data-SO ("2026-07-31", sem hora) passa
// DIRETO. Convertê-la com `new Date()` a trata como meia-noite UTC e, no Brasil (UTC-3),
// ela retrocederia um dia — o remedio viraria o mesmo bug ao contrario.
const SO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Dia "YYYY-MM-DD" local a partir de uma string ISO (ou Date). '' se invalida. */
export function ymdOf(iso) {
  if (!iso) return '';
  if (typeof iso === 'string' && SO_DATA.test(iso)) return iso;
  const d = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : ymdLocal(d);
}

/** Mes "YYYY-MM" local a partir de uma string ISO (ou Date). '' se invalida. */
export function ymOf(iso) {
  const dia = ymdOf(iso);
  return dia ? dia.slice(0, 7) : '';
}

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
