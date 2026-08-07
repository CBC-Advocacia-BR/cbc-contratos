// ─────────────────────────────────────────────────────────────────────────
// DECISAO do vigia que reinicia o banco sozinho (06/08/2026).
//
// POR QUE ISTO EXISTE
// Em 06/08/2026 o Postgres travou as 11h22 BRT por exaustao de memoria (maquina Micro,
// 1 GB, com ~7 sistemas do escritorio dentro) e ficou 75 minutos fora. Como o Auth
// depende do banco, NENHUM sistema do escritorio fazia login. A volta so veio quando
// uma pessoa reiniciou o projeto a mao — ninguem tinha sido avisado, porque o
// monitor-watchdog grava os alertas dentro do proprio banco que caiu.
//
// POR QUE A DECISAO MORA SEPARADA DA FUNCTION
// Reiniciar na hora errada e PIOR do que nao reiniciar:
//   1. durante a recuperacao do banco, um novo reinicio recomeca o replay do WAL e pode
//      prolongar a queda indefinidamente;
//   2. durante incidente DA PLATAFORMA, reiniciar joga o projeto na fila de requeue e
//      ATRASA a volta — foi o que ficou registrado no incidente de 17/07/2026, e e por
//      isso que o runbook do escritorio diz "nao reiniciar durante incidente";
//   3. um falso positivo (rede, DNS, timeout do proprio vigia) derrubaria um banco
//      saudavel a toa, causando a pane que deveria evitar.
// Cada uma dessas travas tem teste proprio em src/utils/__tests__/vigiaSupabase.test.js.
//
// PRINCIPIO DE PROJETO: a funcao e FECHADA POR PADRAO. Qualquer entrada que ela nao
// entenda resulta em NAO reiniciar. So se reinicia quando todas as condicoes sao
// afirmativamente satisfeitas.
// ─────────────────────────────────────────────────────────────────────────

export const VIGIA_CONFIG = {
  // checagens consecutivas com o banco fora antes de agir. Sao feitas dentro da MESMA
  // execucao, espacadas, para nao depender de memoria entre execucoes.
  falhasParaAgir: 3,
  // nunca dois reinicios em janela curta: se o banco cai de novo logo apos um reinicio,
  // a causa nao e transitoria e insistir so prolonga a indisponibilidade.
  minutosEntreReinicios: 20,
  // teto diario. Estourou, e problema estrutural: escala para humano em vez de insistir.
  maxReiniciosPorDia: 3,
};

// Unico status em que o projeto esta parado o bastante para um reinicio ser seguro.
// Qualquer outro (RESTARTING, COMING_UP, RESTORING, PAUSING...) significa que ja ha uma
// transicao em curso, e intervir por cima dela e o modo mais facil de piorar a queda.
const STATUS_SEGURO_PARA_REINICIAR = 'ACTIVE_HEALTHY';

function minutosDesde(iso, agoraMs) {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  // data invalida NAO pode virar "agora" (isso travaria o vigia para sempre); tratamos
  // como "nao houve reinicio conhecido".
  if (Number.isNaN(t)) return Infinity;
  return (agoraMs - t) / 60000;
}

/**
 * Decide se o banco deve ser reiniciado agora.
 *
 * @param {object} e
 * @param {Array<{dbSaudavel:boolean, erro?:string}>} e.checagens  medicoes em ordem
 * @param {string}  e.statusProjeto        status do projeto na Management API
 * @param {boolean|null} e.incidentePlataforma  true/false, ou null quando nao deu p/ saber
 * @param {string|null}  e.ultimoReinicioIso    quando o vigia reiniciou pela ultima vez
 * @param {number}  e.reiniciosHoje        quantos ja houve hoje
 * @param {string}  e.agoraIso
 * @param {object}  [e.config]             sobrescreve VIGIA_CONFIG (para testes)
 * @returns {{acao:'nada'|'aguardar'|'reiniciar'|'escalar', motivo:string, incerteza:string[]}}
 */
export function decidirReinicio(e = {}) {
  const cfg = { ...VIGIA_CONFIG, ...(e.config || {}) };
  const incerteza = [];

  const checagens = Array.isArray(e.checagens) ? e.checagens : null;
  if (!checagens) {
    return { acao: 'aguardar', motivo: 'sem checagens validas para decidir', incerteza };
  }

  // ── 1) Banco respondendo vence tudo ────────────────────────────────────
  // Basta UMA checagem boa. O custo de nao reiniciar um banco que estava ruim e baixo
  // (a proxima execucao reavalia); o custo de reiniciar um banco de pe e uma pane.
  if (checagens.some((c) => c && c.dbSaudavel === true)) {
    return { acao: 'nada', motivo: 'o banco respondeu em ao menos uma checagem', incerteza };
  }

  // ── 2) Evidencia suficiente? ───────────────────────────────────────────
  const foraDeVerdade = checagens.filter((c) => c && c.dbSaudavel === false).length;
  if (foraDeVerdade < cfg.falhasParaAgir) {
    return {
      acao: 'aguardar',
      motivo: `evidencia insuficiente: ${foraDeVerdade} de ${cfg.falhasParaAgir} checagens indicam banco fora`,
      incerteza,
    };
  }

  // ── 3) Ja ha transicao em curso? ───────────────────────────────────────
  // Esta trava vem ANTES da checagem de incidente de proposito: em ambos os casos a
  // conduta e esperar, e "o projeto ja esta subindo" e a informacao mais util no log.
  if (e.statusProjeto !== STATUS_SEGURO_PARA_REINICIAR) {
    return {
      acao: 'aguardar',
      motivo: `projeto em ${e.statusProjeto || 'status desconhecido'}: ja ha transicao em curso, reiniciar por cima prolongaria a recuperacao`,
      incerteza,
    };
  }

  // ── 4) Incidente da plataforma ─────────────────────────────────────────
  if (e.incidentePlataforma === true) {
    return {
      acao: 'escalar',
      motivo: 'incidente aberto na plataforma Supabase: reiniciar agora joga o projeto na fila de requeue e atrasa a volta',
      incerteza,
    };
  }
  if (e.incidentePlataforma !== false) {
    // nao conseguimos consultar a status page. Nao e motivo para travar o vigia (o banco
    // esta fora agora), mas precisa aparecer no aviso para quem ler depois.
    incerteza.push('nao foi possivel confirmar se ha incidente na plataforma Supabase');
  }

  // ── 5) Travas anti-laco ────────────────────────────────────────────────
  const agoraMs = Date.parse(e.agoraIso || '') || Date.now();
  const desdeUltimo = minutosDesde(e.ultimoReinicioIso, agoraMs);
  if (desdeUltimo < cfg.minutosEntreReinicios) {
    return {
      acao: 'aguardar',
      motivo: `ultimo reinicio ha ${Math.round(desdeUltimo)} min (minimo ${cfg.minutosEntreReinicios}): cair de novo tao rapido indica causa nao transitoria`,
      incerteza,
    };
  }

  const jaHoje = Number(e.reiniciosHoje) || 0;
  if (jaHoje >= cfg.maxReiniciosPorDia) {
    return {
      acao: 'escalar',
      motivo: `teto diario atingido (${jaHoje} de ${cfg.maxReiniciosPorDia} reinicios): o problema e estrutural e precisa de gente, nao de mais um reinicio`,
      incerteza,
    };
  }

  // ── 6) Todas as condicoes afirmativamente satisfeitas ──────────────────
  return {
    acao: 'reiniciar',
    motivo: `banco fora em ${foraDeVerdade} checagens seguidas, projeto ocioso e plataforma sem incidente`,
    incerteza,
  };
}

/**
 * Texto curto do incidente para o aviso. Fica aqui (e nao na function) para poder ser
 * testado e para manter a function so com orquestracao.
 */
export function resumoIncidente({ acao, motivo, foraDesdeIso, agoraIso }) {
  const min = foraDesdeIso ? Math.round(minutosDesde(foraDesdeIso, Date.parse(agoraIso || '') || Date.now())) : null;
  const quanto = min != null && Number.isFinite(min) ? ` (fora ha ~${min} min)` : '';
  const cabecalho = {
    reiniciar: 'Banco de dados fora do ar: reinicio automatico disparado',
    escalar: 'Banco de dados fora do ar: PRECISA DE ACAO HUMANA',
    aguardar: 'Banco de dados instavel: vigia aguardando',
    nada: 'Banco de dados respondendo',
  }[acao] || 'Estado do banco de dados';
  return `${cabecalho}${quanto}. ${motivo}`;
}
