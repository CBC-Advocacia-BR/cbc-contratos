/**
 * Detecção de cláusulas conflitantes
 * Verifica se edições em cláusulas criam contradições lógicas
 */

const CONFLICT_RULES = [
  {
    id: 'exito_sem_percentual',
    check: (ctx) => {
      if (!ctx.honorarios.somenteIniciais && ctx.honorarios.percentualExito <= 0) {
        return {
          severity: 'warning',
          message: 'Honorários de êxito estão ativados mas o percentual não foi definido.',
          clausulas: ['clausula3'],
          fix: 'Configure o percentual de êxito nos honorários ou ative "Somente Honorários Iniciais".',
        };
      }
      return null;
    },
  },
  {
    id: 'sem_honorarios',
    check: (ctx) => {
      if (!ctx.honorarios.somenteExito && ctx.honorarios.total <= 0) {
        return {
          severity: 'warning',
          message: 'Honorários fixos estão ativados mas o valor total não foi definido.',
          clausulas: ['clausula3'],
          fix: 'Configure o valor dos honorários fixos ou ative "Somente Êxito".',
        };
      }
      return null;
    },
  },
  {
    id: 'rescisao_percentuais_inconsistentes',
    check: (ctx) => {
      const cl4 = ctx.getTexto('clausula4');
      if (cl4) {
        const percentuais = [...cl4.matchAll(/(\d+)%/g)].map(m => parseInt(m[1]));
        if (percentuais.length >= 3) {
          for (let i = 1; i < percentuais.length; i++) {
            if (percentuais[i] < percentuais[i - 1]) {
              return {
                severity: 'warning',
                message: 'Os percentuais de rescisão na Cláusula 4ª não estão em ordem crescente (' + percentuais.join('%, ') + '%). Devem aumentar conforme a fase processual.',
                clausulas: ['clausula4'],
                fix: 'Ajuste os percentuais para ordem crescente: antes da sentença < após sentença < após trânsito em julgado.',
              };
            }
          }
        }
      }
      return null;
    },
  },
  {
    id: 'objeto_sem_acao',
    check: (ctx) => {
      if (!ctx.resort && !ctx.tipoAcao) {
        return {
          severity: 'info',
          message: 'Ação e resort não foram selecionados. A Cláusula 1ª ficará incompleta.',
          clausulas: ['clausula1'],
          fix: 'Selecione o resort e o tipo de ação.',
        };
      }
      return null;
    },
  },
];

/**
 * Run all conflict checks
 */
export function detectConflicts(data, getClausulaTexto, isClausulaModificada) {
  const ctx = {
    honorarios: data.honorarios || {},
    numContratantes: data.numContratantes || 1,
    resort: data.resort || '',
    tipoAcao: data.tipoAcao || '',
    getTexto: (id) => {
      try { return getClausulaTexto(id); } catch { return null; }
    },
    isModificada: (id) => {
      try { return isClausulaModificada(id); } catch { return false; }
    },
  };

  const conflicts = [];
  for (const rule of CONFLICT_RULES) {
    try {
      const result = rule.check(ctx);
      if (result) conflicts.push({ ...result, ruleId: rule.id });
    } catch { /* skip broken rules */ }
  }

  return conflicts;
}

/**
 * Get conflict severity color
 * O campo `icon` devolve a CHAVE (string) que identifica o severity —
 * o componente consumidor mapeia essa chave para um Heroicon apropriado.
 */
export function getConflictColor(severity) {
  switch (severity) {
    case 'error': return { bg: '#FEF2F2', border: '#FECACA', text: '#DC2626', icon: 'error' };
    case 'warning': return { bg: '#FFFBEB', border: '#FDE68A', text: '#D97706', icon: 'warning' };
    case 'info': return { bg: '#EFF6FF', border: '#BFDBFE', text: '#2563EB', icon: 'info' };
    default: return { bg: '#F3F4F6', border: '#E5E7EB', text: '#6B7280', icon: 'dot' };
  }
}
