// ─────────────────────────────────────────────────────────────────────────
// Dados e decisao da RECONCILIACAO POS-QUEDA (06/08/2026) — modulo PURO.
//
// Segue o padrao registrado no guia do projeto: "para testar function que fala com rede,
// extrair a decisao para _lib/ e deixar a function so orquestrando". Sem isso, o teste
// desta logica carregava o `botDb` junto e tentava abrir conexao com o banco.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Rotinas com worker proprio (sem `schedule`), portanto chamaveis por HTTP.
 * Ordem = prioridade: dinheiro primeiro.
 */
export const RESSINCRONIZAR = [
  { nome: 'asaas-sync-boletos-background', porque: 'pagamentos e boletos: eventos perdidos na janela' },
  { nome: 'cobranca-conciliar-now', porque: 'concilia cobrancas com o que foi pago' },
  { nome: 'advbox-monitor-worker-background', porque: 'andamentos e tarefas processuais do ADVBOX' },
  { nome: 'kommo-sla-worker-background', porque: 'conversas e SLA de primeira resposta' },
];

/**
 * Rotinas AGENDADAS. A Netlify devolve 403 a qualquer chamada HTTP externa feita a uma
 * function agendada (bloqueio na borda, antes do codigo rodar), entao estas nao podem ser
 * re-disparadas por aqui: quando a janela da queda cobre o horario delas, viram pedido de
 * "Run now" no painel. Preferimos listar o que nao da para fazer a fingir cobertura.
 */
export const AGENDADAS = [
  { nome: 'backup-diario', horaUtc: 6, critico: true, obs: 'worker chamavel: backup-worker-background' },
  { nome: 'cobranca-regua', horaUtc: 13, critico: true, obs: 'so seg a sex; grava o snapshot de inadimplencia' },
  { nome: 'asaas-sync-customers', horaUtc: 9, critico: false },
  { nome: 'advbox-vendas-sync', horaUtc: 9, critico: false, obs: 'tambem 15h e 21h UTC' },
  { nome: 'datajud-refresh', horaUtc: 11, critico: false },
  { nome: 'clientes-reconciliar', horaUtc: 11, critico: false },
  { nome: 'meta-ads-sync', horaUtc: 10, critico: false },
  { nome: 'commission-calculator', horaUtc: 3, critico: true, obs: 'so no dia 20 do mes' },
];

const UM_DIA = 86400000;

/**
 * Quais rotinas agendadas tinham horario DENTRO da janela da queda.
 *
 * ⚠️ Compara instantes, nao horas. Comparar so a hora produzia falso positivo na borda:
 * numa queda das 06h05 as 06h50, a rotina das 06h00 ja tinha rodado normalmente, e ainda
 * assim aparecia como "precisa rodar a mao". Pedido falso repetido ensina a ignorar o
 * aviso, que e o oposto do objetivo. Ha teste para cada borda.
 */
export function agendadasNaJanela(inicioIso, fimIso, lista = AGENDADAS) {
  const ini = new Date(inicioIso);
  const fim = new Date(fimIso);
  if (Number.isNaN(+ini) || Number.isNaN(+fim) || fim < ini) return [];

  // Janela de 24h ou mais cobre necessariamente o horario de qualquer rotina diaria.
  // Alem de correto, evita percorrer anos de janela quando alguem informa data errada.
  if (+fim - +ini >= UM_DIA) return [...lista];

  return lista.filter((a) => {
    // candidatos: o horario da rotina no dia do inicio e no dia do fim (que pode ser o
    // dia seguinte, quando a queda atravessa a meia-noite). Numa janela < 24h nao ha
    // outro instante possivel.
    for (const base of [ini, fim]) {
      const t = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), a.horaUtc, 0, 0, 0);
      if (t >= +ini && t <= +fim) return true;
    }
    return false;
  });
}
