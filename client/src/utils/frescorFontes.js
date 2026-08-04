// (auditoria 01/08/2026 — item 234) "De quando sao estes numeros?"
//
// O PROBLEMA: se o sync da agenda ou da Meta parar, o funil continua exibindo numeros
// perfeitamente plausiveis — so que velhos. Nada na tela denuncia isso, e a pessoa toma
// decisao (mexer em campanha, cobrar a equipe) com base num retrato de dias atras.
// Julho de 2026 e cheio de exemplos: 4 crons ficaram mortos por meses sem ninguem notar.
//
// A FONTE: em vez de consultar `synced_at` de cada tabela (varias consultas a mais na
// abertura do Dashboard), lemos UMA vez a `cron_heartbeat`, que ja registra a ultima
// execucao de cada robo. Barato e cobre todas as fontes de uma vez.
import { supabase } from '../lib/supabase';

/** Robôs que alimentam cada etapa do funil, com o intervalo esperado (em horas). */
export const FONTES_FUNIL = [
  { job: 'meta-ads-sync', rotulo: 'Leads de campanha (Meta)', horas: 26 },
  { job: 'agenda-videochamadas-sync', rotulo: 'Videochamadas (Agenda)', horas: 3 },
  { job: 'meet-auditoria-sync', rotulo: 'Comparecimento (Meet)', horas: 26 },
  { job: 'advbox-monitor', rotulo: 'Processos (ADVBOX)', horas: 14 },
];

/**
 * Lê o frescor das fontes do funil.
 * @returns {Promise<{fontes: Array, atrasadas: Array, maisAntiga: Date|null}>}
 */
export async function buscarFrescorFunil() {
  const jobs = FONTES_FUNIL.map((f) => f.job);
  const { data, error } = await supabase
    .from('cron_heartbeat')
    .select('job, last_run_at, ok')
    .in('job', jobs);
  if (error) throw error;

  const porJob = new Map((data || []).map((r) => [r.job, r]));
  const agora = Date.now();
  const fontes = FONTES_FUNIL.map((f) => {
    const hb = porJob.get(f.job);
    const quando = hb?.last_run_at ? new Date(hb.last_run_at) : null;
    const horasAtras = quando ? (agora - quando.getTime()) / 3600000 : null;
    return {
      ...f,
      quando,
      horasAtras,
      // `nunca` = o robô jamais registrou execução: ou nunca rodou, ou o agendamento sumiu
      // num deploy. É o caso mais grave e o mais fácil de passar despercebido.
      nunca: !quando,
      atrasada: !quando || horasAtras > f.horas,
      comErro: hb?.ok === false,
    };
  });

  const atrasadas = fontes.filter((f) => f.atrasada || f.comErro);
  const datas = fontes.map((f) => f.quando).filter(Boolean);
  const maisAntiga = datas.length ? new Date(Math.min(...datas.map((d) => d.getTime()))) : null;
  return { fontes, atrasadas, maisAntiga };
}

/** Texto curto para o rodapé do funil. */
export function resumoFrescor({ fontes, atrasadas, maisAntiga }) {
  if (!fontes?.length) return '';
  if (!atrasadas.length) {
    return maisAntiga ? `Dados atualizados até ${maisAntiga.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : '';
  }
  const nomes = atrasadas.map((f) => f.rotulo).join(', ');
  return `Pode estar desatualizado: ${nomes}`;
}
