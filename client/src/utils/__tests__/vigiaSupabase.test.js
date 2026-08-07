// Decisao do vigia que reinicia o banco sozinho (06/08/2026).
//
// Contexto: em 06/08 o Postgres travou as 11h22 (BRT) por exaustao de memoria na maquina
// Micro (1 GB) e ficou 75 minutos fora, derrubando o LOGIN de todos os ~7 sistemas do
// escritorio. Ninguem foi avisado: o monitor-watchdog grava os alertas dentro do proprio
// banco que caiu. A volta so aconteceu quando uma pessoa reiniciou o projeto a mao.
//
// Esta lib e a DECISAO pura: "devo reiniciar agora?". Ela existe separada da function
// porque reiniciar na hora errada e PIOR que nao reiniciar:
//   - reiniciar durante a recuperacao do banco reinicia o replay do WAL e pode prolongar
//     a queda indefinidamente;
//   - reiniciar durante incidente DA PLATAFORMA joga o projeto na fila de requeue e
//     atrasa a volta (foi o que o runbook do incidente de 17/07/2026 registrou);
//   - reiniciar por falso positivo derruba um banco saudavel a toa.
// Por isso cada trava abaixo tem teste proprio.
import { describe, it, expect } from 'vitest';
import {
  decidirReinicio,
  VIGIA_CONFIG,
} from '../../../netlify/functions/_lib/vigiaSupabase.mjs';

const AGORA = '2026-08-06T15:30:00.000Z';
const FORA = { dbSaudavel: false, erro: 'Failed to connect to database' };
const OK = { dbSaudavel: true };

// cenario padrao: banco fora nas 3 checagens, nada mais atrapalhando
function cenario(extra = {}) {
  return {
    checagens: [FORA, FORA, FORA],
    statusProjeto: 'ACTIVE_HEALTHY',
    incidentePlataforma: false,
    ultimoReinicioIso: null,
    reiniciosHoje: 0,
    agoraIso: AGORA,
    ...extra,
  };
}

describe('decidirReinicio — quando AGIR', () => {
  it('reinicia quando o banco falhou em todas as checagens e nada mais impede', () => {
    const r = decidirReinicio(cenario());
    expect(r.acao).toBe('reiniciar');
  });

  it('conta como fora mesmo sem texto de erro', () => {
    const r = decidirReinicio(cenario({ checagens: [{ dbSaudavel: false }, { dbSaudavel: false }, { dbSaudavel: false }] }));
    expect(r.acao).toBe('reiniciar');
  });
});

describe('decidirReinicio — falso positivo NAO pode derrubar banco saudavel', () => {
  it('uma unica checagem boa no meio ja cancela o reinicio', () => {
    const r = decidirReinicio(cenario({ checagens: [FORA, OK, FORA] }));
    expect(r.acao).toBe('nada');
    expect(r.motivo).toMatch(/respond/i);
  });

  it('a ultima checagem boa cancela (banco voltou sozinho)', () => {
    const r = decidirReinicio(cenario({ checagens: [FORA, FORA, OK] }));
    expect(r.acao).toBe('nada');
  });

  it('evidencia insuficiente nao autoriza reinicio', () => {
    const r = decidirReinicio(cenario({ checagens: [FORA, FORA] }));
    expect(r.acao).toBe('aguardar');
    expect(r.motivo).toMatch(/checagens/i);
  });

  it('lista de checagens vazia nunca reinicia', () => {
    const r = decidirReinicio(cenario({ checagens: [] }));
    expect(r.acao).not.toBe('reiniciar');
  });
});

describe('decidirReinicio — NUNCA reiniciar durante recuperacao', () => {
  // reiniciar um banco que ja esta subindo reinicia o replay do WAL: a queda se prolonga
  it('projeto RESTARTING aguarda', () => {
    const r = decidirReinicio(cenario({ statusProjeto: 'RESTARTING' }));
    expect(r.acao).toBe('aguardar');
    expect(r.motivo).toMatch(/RESTARTING/);
  });

  it('projeto COMING_UP aguarda', () => {
    const r = decidirReinicio(cenario({ statusProjeto: 'COMING_UP' }));
    expect(r.acao).toBe('aguardar');
  });

  it('qualquer status que nao seja ACTIVE_HEALTHY aguarda', () => {
    for (const s of ['INIT_READ_REPLICA', 'PAUSING', 'RESTORING', 'UNKNOWN', 'INACTIVE']) {
      expect(decidirReinicio(cenario({ statusProjeto: s })).acao).toBe('aguardar');
    }
  });
});

describe('decidirReinicio — incidente DA PLATAFORMA muda a conduta', () => {
  // regra do runbook (incidente de 17/07/2026): com a Supabase em incidente, reiniciar
  // joga o projeto na fila de requeue e ATRASA a volta.
  it('incidente na plataforma escala em vez de reiniciar', () => {
    const r = decidirReinicio(cenario({ incidentePlataforma: true }));
    expect(r.acao).toBe('escalar');
    expect(r.motivo).toMatch(/plataforma/i);
  });

  it('nao saber se ha incidente (null) nao impede agir, mas fica registrado', () => {
    const r = decidirReinicio(cenario({ incidentePlataforma: null }));
    expect(r.acao).toBe('reiniciar');
    expect(r.incerteza.join(' ')).toMatch(/plataforma/i);
  });
});

describe('decidirReinicio — travas contra laco de reinicios', () => {
  it('reinicio recente demais aguarda', () => {
    const r = decidirReinicio(cenario({ ultimoReinicioIso: '2026-08-06T15:25:00.000Z' })); // 5 min atras
    expect(r.acao).toBe('aguardar');
    expect(r.motivo).toMatch(/reinici/i);
  });

  it('reinicio antigo o bastante libera', () => {
    const r = decidirReinicio(cenario({ ultimoReinicioIso: '2026-08-06T14:00:00.000Z' })); // 90 min
    expect(r.acao).toBe('reiniciar');
  });

  it('estourou o teto do dia: escala, nao insiste', () => {
    const r = decidirReinicio(cenario({ reiniciosHoje: VIGIA_CONFIG.maxReiniciosPorDia }));
    expect(r.acao).toBe('escalar');
    expect(r.motivo).toMatch(/teto|limite/i);
  });

  it('no teto menos um ainda age', () => {
    const r = decidirReinicio(cenario({ reiniciosHoje: VIGIA_CONFIG.maxReiniciosPorDia - 1 }));
    expect(r.acao).toBe('reiniciar');
  });
});

describe('decidirReinicio — ordem das travas', () => {
  // banco respondendo vence tudo: nem incidente nem teto importam se esta de pe
  it('banco de pe vence incidente e teto', () => {
    const r = decidirReinicio(cenario({
      checagens: [OK, OK, OK], incidentePlataforma: true, reiniciosHoje: 99,
    }));
    expect(r.acao).toBe('nada');
  });

  // recuperacao em curso vence o incidente da plataforma: em ambos os casos, esperar
  it('projeto em RESTARTING durante incidente ainda aguarda', () => {
    const r = decidirReinicio(cenario({ statusProjeto: 'RESTARTING', incidentePlataforma: true }));
    expect(r.acao).toBe('aguardar');
  });

  it('sempre devolve motivo legivel', () => {
    for (const c of [cenario(), cenario({ checagens: [OK] }), cenario({ statusProjeto: 'RESTARTING' }),
      cenario({ incidentePlataforma: true }), cenario({ reiniciosHoje: 9 })]) {
      const r = decidirReinicio(c);
      expect(typeof r.motivo).toBe('string');
      expect(r.motivo.length).toBeGreaterThan(5);
    }
  });
});

describe('decidirReinicio — entradas defeituosas nao podem virar reinicio acidental', () => {
  it('objeto vazio nao reinicia', () => {
    expect(decidirReinicio({}).acao).not.toBe('reiniciar');
  });

  it('sem argumento nenhum nao reinicia nem lanca', () => {
    expect(() => decidirReinicio()).not.toThrow();
    expect(decidirReinicio().acao).not.toBe('reiniciar');
  });

  it('checagens nao-array nao reinicia', () => {
    expect(decidirReinicio(cenario({ checagens: 'fora' })).acao).not.toBe('reiniciar');
  });

  it('data de reinicio invalida e tratada como "nao houve", nao como "agora"', () => {
    const r = decidirReinicio(cenario({ ultimoReinicioIso: 'nao-e-data' }));
    expect(r.acao).toBe('reiniciar');
  });
});
