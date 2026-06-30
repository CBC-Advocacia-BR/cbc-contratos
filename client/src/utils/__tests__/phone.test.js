import { describe, it, expect } from 'vitest';
import { waNumber, waLink } from '../phone';

describe('waNumber', () => {
  it('prefixa 55 em celular com DDD (11 digitos)', () => {
    expect(waNumber('81998313882')).toBe('5581998313882');
  });
  it('prefixa 55 em fixo/numero com 10 digitos', () => {
    expect(waNumber('6285589738')).toBe('556285589738');
  });
  it('mantem numero que ja vem com DDI 55 (13 digitos)', () => {
    expect(waNumber('5581998313882')).toBe('5581998313882');
  });
  it('ignora mascara/pontuacao', () => {
    expect(waNumber('(81) 99831-3882')).toBe('5581998313882');
  });
  it('retorna vazio para entrada invalida/curta', () => {
    expect(waNumber('')).toBe('');
    expect(waNumber(null)).toBe('');
    expect(waNumber('1234')).toBe('');
  });
  it('nao prefixa 55 duas vezes em 12 digitos iniciando com 55', () => {
    expect(waNumber('551112345678')).toBe('551112345678');
  });
});

describe('waLink', () => {
  it('monta o link wa.me', () => {
    expect(waLink('81998313882')).toBe('https://wa.me/5581998313882');
  });
  it('vazio quando sem numero', () => {
    expect(waLink('')).toBe('');
  });
});
