import { describe, it, expect } from 'vitest';
import { detectConflicts, getConflictColor } from '../clausulaConflicts';

const mkData = (overrides = {}) => ({
  honorarios: { somenteIniciais: false, somenteExito: false, total: 5000, percentualExito: 20 },
  numContratantes: 1,
  resort: 'Resort X',
  tipoAcao: 'rescisão',
  ...overrides,
});

const noTexto = () => null;
const noModif = () => false;

describe('detectConflicts', () => {
  it('contrato valido nao gera conflitos', () => {
    const conflicts = detectConflicts(mkData(), noTexto, noModif);
    expect(conflicts).toEqual([]);
  });

  it('exito ativo sem percentual gera warning', () => {
    const data = mkData({
      honorarios: { somenteIniciais: false, somenteExito: false, total: 5000, percentualExito: 0 },
    });
    const conflicts = detectConflicts(data, noTexto, noModif);
    const exito = conflicts.find(c => c.ruleId === 'exito_sem_percentual');
    expect(exito).toBeTruthy();
    expect(exito.severity).toBe('warning');
  });

  it('honorarios fixos sem valor gera warning', () => {
    const data = mkData({
      honorarios: { somenteIniciais: false, somenteExito: false, total: 0, percentualExito: 20 },
    });
    const conflicts = detectConflicts(data, noTexto, noModif);
    const semHon = conflicts.find(c => c.ruleId === 'sem_honorarios');
    expect(semHon).toBeTruthy();
  });

  it('somenteExito desativa regra de honorarios fixos', () => {
    const data = mkData({
      honorarios: { somenteIniciais: false, somenteExito: true, total: 0, percentualExito: 20 },
    });
    const conflicts = detectConflicts(data, noTexto, noModif);
    expect(conflicts.find(c => c.ruleId === 'sem_honorarios')).toBeFalsy();
  });

  it('somenteIniciais desativa regra de exito sem percentual', () => {
    const data = mkData({
      honorarios: { somenteIniciais: true, somenteExito: false, total: 5000, percentualExito: 0 },
    });
    const conflicts = detectConflicts(data, noTexto, noModif);
    expect(conflicts.find(c => c.ruleId === 'exito_sem_percentual')).toBeFalsy();
  });

  it('detecta percentuais de rescisao em ordem decrescente', () => {
    const cl4 = 'antes da sentença 30%, após sentença 20%, após trânsito 10%';
    const data = mkData();
    const getTexto = (id) => (id === 'clausula4' ? cl4 : null);
    const conflicts = detectConflicts(data, getTexto, noModif);
    expect(conflicts.find(c => c.ruleId === 'rescisao_percentuais_inconsistentes')).toBeTruthy();
  });

  it('aceita percentuais em ordem crescente', () => {
    const cl4 = 'antes 10%, depois 20%, transito 30%';
    const data = mkData();
    const getTexto = (id) => (id === 'clausula4' ? cl4 : null);
    const conflicts = detectConflicts(data, getTexto, noModif);
    expect(conflicts.find(c => c.ruleId === 'rescisao_percentuais_inconsistentes')).toBeFalsy();
  });

  it('sem resort e sem acao gera info', () => {
    const data = mkData({ resort: '', tipoAcao: '' });
    const conflicts = detectConflicts(data, noTexto, noModif);
    const objSem = conflicts.find(c => c.ruleId === 'objeto_sem_acao');
    expect(objSem).toBeTruthy();
    expect(objSem.severity).toBe('info');
  });

  it('regra quebrada nao derruba demais', () => {
    const data = mkData();
    const brokenGetTexto = () => { throw new Error('boom'); };
    const conflicts = detectConflicts(data, brokenGetTexto, noModif);
    expect(Array.isArray(conflicts)).toBe(true);
  });
});

describe('getConflictColor', () => {
  it('retorna estrutura para cada severity', () => {
    for (const sev of ['error', 'warning', 'info']) {
      const c = getConflictColor(sev);
      expect(c.bg).toBeTruthy();
      expect(c.border).toBeTruthy();
      expect(c.text).toBeTruthy();
      expect(c.icon).toBeTruthy();
    }
  });

  it('default para severity desconhecida', () => {
    const c = getConflictColor('xyz');
    expect(c.icon).toBe('dot');
  });
});
