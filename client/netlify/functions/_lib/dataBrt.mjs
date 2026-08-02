// ─────────────────────────────────────────────────────────────────────────
// Dia BRT para o runtime das Functions (que roda em UTC): apos as 21h BRT o
// dia UTC ja e amanha, entao toISOString() cru desloca "hoje" (REGRA #11 do
// guia: datas server-side em America/Sao_Paulo). O Brasil nao tem mais
// horario de verao (desde 2019); BRT e UTC-3 fixo e o shift aritmetico de
// -3h e exato (mesmo padrao do diaBrt de _lib/metaTrafego.mjs).
// ─────────────────────────────────────────────────────────────────────────

const TRES_HORAS_MS = 3 * 3600 * 1000;

/** Dia BRT 'YYYY-MM-DD' de um instante (Date | ISO | epoch ms). */
export function diaBrtDe(instante) {
  return new Date(new Date(instante).getTime() - TRES_HORAS_MS).toISOString().slice(0, 10);
}

/** Dia BRT 'YYYY-MM-DD' de hoje, opcionalmente deslocado `menosDias` para tras. */
export function diaBrt(menosDias = 0) {
  return diaBrtDe(Date.now() - menosDias * 86400000);
}
