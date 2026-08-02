// (auditoria 01/08/2026 — itens 99 e 224) Conciliação de cobrança num lugar só.
//
// POR QUE: a MESMA rotina vivia copiada em `cobranca-conciliar.mjs` (cron das 12h) e
// `cobranca-conciliar-now.mjs` (botão do painel) — ~25 linhas idênticas, com o mesmo
// `.limit(5000)`. Duas cópias significa que uma correção feita numa não chega na outra,
// que é a origem do bug do mapa do ADVBOX (contrato do Edmar no tipo de ação errado).
//
// DE QUEBRA, o defeito de paginação: `.limit(5000)` NÃO levanta o teto de 1.000 linhas
// do PostgREST. Com ~11,7 mil boletos no espelho, a varredura já podia estar perdendo
// pagamentos — e cada pagamento perdido é um disparo de cobrança que continua marcado
// como "não converteu", enviesando a métrica de eficácia da régua para baixo.
//
// REGRA DE NEGÓCIO (decisão do Paulo): "qualquer template enviado + cliente paga um
// boleto vencido nos dias seguintes = cobrança bem-sucedida". A marcação real (1 disparo
// por CPF, last-touch, só boleto pago APÓS o vencimento) vive na RPC cobranca_marcar_pago;
// aqui só varremos os boletos pagos recentes dos CPFs com disparo pendente.
import { db } from './botDb.mjs';
import { fetchAllPaged } from './paged.mjs';

const RPC_SECRET = () => process.env.BOT_RPC_SECRET || '';
const digits = (s) => String(s || '').replace(/\D/g, '');

/** Janela de varredura: 45 dias cobre com folga o ciclo de cobrança. */
export const DIAS_JANELA = 45;

/**
 * Roda a conciliação.
 * @returns {Promise<{marcados: number, candidatos: number, cpfsPendentes: number}>}
 */
export async function conciliarCobranca() {
  const desde = new Date(Date.now() - DIAS_JANELA * 86400000).toISOString();
  const desdeData = desde.slice(0, 10);

  // CPFs com disparo ainda pendente (enfileirado, não pago) na janela
  const pend = await fetchAllPaged(() => db.from('cobranca_disparos')
    .select('customer_cpf')
    .eq('resultado', 'enfileirado').eq('pago', false)
    .gte('disparado_em', desde)
    .order('id'));
  const cpfs = new Set((pend || []).map((p) => digits(p.customer_cpf)).filter((c) => c.length === 11));
  if (!cpfs.size) return { marcados: 0, candidatos: 0, cpfsPendentes: 0 };

  // Boletos pagos recentemente (espelho Asaas). PAGINADO — ver nota do item 224 acima.
  const bs = await fetchAllPaged(() => db.from('asaas_boletos')
    .select('id, customer_cpf, due_date, payment_date')
    .not('payment_date', 'is', null)
    .gte('payment_date', desdeData)
    .order('id'));

  let marcados = 0;
  let candidatos = 0;
  for (const b of bs || []) {
    if (!cpfs.has(digits(b.customer_cpf))) continue;             // só CPFs com disparo pendente
    if (!(b.due_date && b.payment_date > b.due_date)) continue;  // só boleto VENCIDO que foi pago
    candidatos++;
    const { data: n } = await db.rpc('cobranca_marcar_pago', {
      p_chave: RPC_SECRET(), p_boleto_id: b.id, p_pago_em: b.payment_date,
    });
    marcados += Number(n) || 0;
  }
  return { marcados, candidatos, cpfsPendentes: cpfs.size };
}
