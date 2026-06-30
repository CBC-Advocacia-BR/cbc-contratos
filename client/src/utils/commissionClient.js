// ═══════════════════════════════════════════════════════════════════════
// commissionClient — helpers para integrar com commission-calculator
// ═══════════════════════════════════════════════════════════════════════
// Endpoint serverless: /.netlify/functions/commission-calculator
//
// Uso:
//   import { recalcComissao, loadComissaoCalculada } from '../utils/commissionClient';
//
//   // Forcar recalculo (POST no endpoint)
//   const r = await recalcComissao();           // periodo corrente
//   const r = await recalcComissao('2026-04');  // periodo que termina em abr/26
//
//   // Consultar cache persistido
//   const data = await loadComissaoCalculada('vendedora@cbc', '2026-03-20', supabase);
// ═══════════════════════════════════════════════════════════════════════

const ENDPOINT = '/.netlify/functions/commission-calculator';

// Dispara recalculo no backend. Retorna o resumo completo (ou {success:false,error}).
// @param {string?} month - formato "YYYY-MM". Periodo que TERMINA naquele mes.
// @returns {Promise<object>}
export async function recalcComissao(month) {
  const url = month ? `${ENDPOINT}?month=${encodeURIComponent(month)}` : ENDPOINT;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await r.json().catch(() => ({ success: false, error: 'invalid json' }));
    return data;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Busca comissao calculada do cache (tabela vendas_comissoes_mensais).
// @param {string} vendedoraEmail
// @param {string} periodoInicio - formato ISO "YYYY-MM-DD" (dia 20 do mes anterior)
// @param {SupabaseClient} supabase
// @returns {Promise<object|null>}
export async function loadComissaoCalculada(vendedoraEmail, periodoInicio, supabase) {
  try {
    const { data, error } = await supabase
      .from('vendas_comissoes_mensais')
      .select('*')
      .eq('vendedora_email', vendedoraEmail)
      .eq('periodo_inicio', periodoInicio)
      .maybeSingle();
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

// Busca detalhes por contrato de uma comissao calculada.
// @param {string} comissaoId
// @param {SupabaseClient} supabase
// @returns {Promise<array>}
export async function loadComissaoDetalhes(comissaoId, supabase) {
  try {
    const { data, error } = await supabase
      .from('vendas_comissoes_detalhe')
      .select('*')
      .eq('comissao_id', comissaoId);
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// Helper: calcula periodo_inicio ISO a partir de uma data de referencia.
// Espelha a logica de currentPeriodFromDate no backend.
// @param {Date?} anchor - default: hoje
// @param {number?} diaInicio - default: 20
// @returns {string} YYYY-MM-DD do dia 20 do mes anterior (ou atual se hoje >= 20)
export function getCurrentPeriodoInicio(anchor = new Date(), diaInicio = 20) {
  const d = new Date(anchor);
  const day = d.getDate();
  let year = d.getFullYear();
  let month = d.getMonth(); // 0-11

  if (day < diaInicio) {
    // periodo comecou no dia 20 do mes anterior
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  // Se day >= diaInicio, periodo comecou no dia 20 deste mes
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(diaInicio).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}
