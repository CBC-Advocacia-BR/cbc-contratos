// (auditoria 01/08/2026 — itens 143 e 145) Este mapa agora tem DOIS papeis criticos:
// e o ritmo esperado de cada robo (o painel e o vigia leem daqui) E a lista declarativa
// do que deveria existir — job que esta aqui e nao bateu ponto nunca rodou. Um valor
// errado aqui volta a produzir o efeito que escondeu o apagao do backup: ou o painel
// fica vermelho o tempo todo e ninguem olha, ou o silencio passa por paz.
import { describe, it, expect } from 'vitest';
import { CRON_SLA } from '../../../netlify/functions/_lib/cronSla.mjs';

describe('CRON_SLA — fonte unica do ritmo dos robos', () => {
  it('tem jobs e todos os prazos sao minutos positivos', () => {
    const jobs = Object.entries(CRON_SLA);
    expect(jobs.length).toBeGreaterThan(20);
    for (const [job, min] of jobs) {
      expect(Number.isFinite(min), `${job} sem prazo numerico`).toBe(true);
      expect(min, `${job} com prazo <= 0`).toBeGreaterThan(0);
    }
  });

  it('nenhum prazo e apertado a ponto de acusar atraso em uma rodada perdida', () => {
    // o robo mais frequente do sistema roda de minuto em minuto; abaixo de 5 minutos
    // qualquer soluco de rede viraria alarme e o painel voltaria a mentir
    for (const [job, min] of Object.entries(CRON_SLA)) {
      expect(min, `${job} com prazo apertado demais`).toBeGreaterThanOrEqual(5);
    }
  });

  it('nenhum prazo passa de 40 dias — silencio longo demais deixa de ser vigilancia', () => {
    // o maior legitimo e o calculo de comissao (dia 20 do mes, ~33 dias de folga)
    for (const [job, min] of Object.entries(CRON_SLA)) {
      expect(min, `${job} com prazo frouxo demais`).toBeLessThanOrEqual(40 * 24 * 60);
    }
  });

  it('o backup do banco esta vigiado — foi o que faltou por 16 dias', () => {
    // `backup-diario` e o backup de verdade (Google Drive). Ate 01/08 o vigia olhava
    // apenas o `db-backup-cron`, que nem rodava, e o apagao passou despercebido.
    expect(CRON_SLA['backup-diario']).toBeGreaterThan(0);
    expect(CRON_SLA['backup-diario']).toBeLessThanOrEqual(48 * 60);
    expect(CRON_SLA['backup-verificar-cron']).toBeGreaterThan(0);
  });

  it('cron diario tem prazo maior que um dia (senao o painel vive vermelho)', () => {
    // era exatamente o item 145: o painel usava 90 min para TODOS, entao um cron diario
    // aparecia "atrasado" 22 horas e meia por dia
    for (const job of ['backup-diario', 'datajud-refresh', 'meta-ads-sync', 'tokens-vigia-cron']) {
      expect(CRON_SLA[job], `${job} deveria ter folga de mais de 24h`).toBeGreaterThan(24 * 60);
    }
  });

  it('nomes de job nao tem espaco nem maiuscula (tem de casar com o heartbeat gravado)', () => {
    // o nome aqui e comparado por igualdade com cron_heartbeat.job: um espaco a mais
    // faria o vigia acusar "nunca rodou" de um cron saudavel, todo dia
    for (const job of Object.keys(CRON_SLA)) {
      expect(job).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
