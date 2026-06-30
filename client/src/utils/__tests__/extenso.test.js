import { describe, it, expect } from 'vitest';
import { valorExtenso, formatCurrency } from '../extenso';

describe('valorExtenso', () => {
  it('zero reais', () => {
    expect(valorExtenso(0)).toBe('zero reais');
  });

  it('um real (singular)', () => {
    expect(valorExtenso(1)).toBe('um real');
  });

  it('dois reais (plural)', () => {
    expect(valorExtenso(2)).toBe('dois reais');
  });

  it('valor com centavos', () => {
    expect(valorExtenso(1.5)).toBe('um real e cinquenta centavos');
  });

  it('apenas centavos', () => {
    expect(valorExtenso(0.5)).toBe('cinquenta centavos');
    expect(valorExtenso(0.01)).toBe('um centavo');
  });

  it('cem reais (palavra especial "cem")', () => {
    expect(valorExtenso(100)).toBe('cem reais');
  });

  it('cento e um', () => {
    expect(valorExtenso(101)).toBe('cento e um reais');
  });

  it('mil reais', () => {
    expect(valorExtenso(1000)).toBe('um mil reais');
  });

  it('dois mil', () => {
    expect(valorExtenso(2000)).toBe('dois mil reais');
  });

  it('valor combinado', () => {
    expect(valorExtenso(1234.56)).toContain('mil');
    expect(valorExtenso(1234.56)).toContain('reais');
    expect(valorExtenso(1234.56)).toContain('centavos');
  });

  it('cinco mil reais', () => {
    expect(valorExtenso(5000)).toBe('cinco mil reais');
  });

  it('cinco mil e quinhentos reais e cinquenta centavos', () => {
    expect(valorExtenso(5500.50)).toBe('cinco mil e quinhentos reais e cinquenta centavos');
  });
});

describe('formatCurrency', () => {
  it('formata valor inteiro em BRL', () => {
    expect(formatCurrency(100)).toMatch(/R\$\s?100,00/);
  });

  it('formata valor com decimais', () => {
    expect(formatCurrency(1234.56)).toMatch(/R\$\s?1\.234,56/);
  });

  it('formata zero', () => {
    expect(formatCurrency(0)).toMatch(/R\$\s?0,00/);
  });
});
