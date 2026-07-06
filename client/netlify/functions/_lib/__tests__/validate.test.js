// (auditoria #55/#63) Primeiro teste de LIB de function — logica pura de _lib/.
import { describe, it, expect } from 'vitest';
import { requireFields, isPlainObject } from '../validate.mjs';

describe('validate.isPlainObject', () => {
  it('true so para objeto simples', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject('x')).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });
});

describe('validate.requireFields', () => {
  it('ok quando todos os campos estao presentes', () => {
    expect(requireFields({ a: 1, b: 'x' }, ['a', 'b'])).toEqual({ ok: true });
  });
  it('aponta os campos ausentes (undefined/null/vazio)', () => {
    const r = requireFields({ a: 1, b: '', c: null }, ['a', 'b', 'c', 'd']);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['b', 'c', 'd']);
    expect(r.motivo).toMatch(/b, c, d/);
  });
  it('body nao-objeto => falha com todos os campos', () => {
    expect(requireFields(null, ['a']).ok).toBe(false);
    expect(requireFields('x', ['a', 'b']).missing).toEqual(['a', 'b']);
  });
  it('0 e false contam como PRESENTES (nao sao ausentes)', () => {
    expect(requireFields({ a: 0, b: false }, ['a', 'b'])).toEqual({ ok: true });
  });
});
