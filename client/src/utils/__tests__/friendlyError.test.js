// (auditoria #38) Garante que erros tecnicos viram mensagem amigavel em portugues.
import { describe, it, expect } from 'vitest';
import { friendlyError } from '../friendlyError';

describe('friendlyError', () => {
  it('rede', () => {
    expect(friendlyError(new Error('Failed to fetch'))).toMatch(/conexao/i);
    expect(friendlyError({ message: 'NetworkError when attempting to fetch resource' })).toMatch(/conexao/i);
  });
  it('duplicado', () => {
    expect(friendlyError(new Error('duplicate key value violates unique constraint "x"'))).toMatch(/ja existe/i);
  });
  it('permissao / RLS / sessao', () => {
    expect(friendlyError(new Error('new row violates row-level security policy'))).toMatch(/permissao/i);
    expect(friendlyError(new Error('JWT expired'))).toMatch(/permissao|sessao/i);
  });
  it('timeout e rate limit', () => {
    expect(friendlyError(new Error('statement timeout'))).toMatch(/demorou/i);
    expect(friendlyError(new Error('Too Many Requests'))).toMatch(/tentativas/i);
  });
  it('aceita string crua', () => {
    expect(friendlyError('duplicate key')).toMatch(/ja existe/i);
  });
  it('usa o fallback quando nao reconhece', () => {
    expect(friendlyError(new Error('erro cabuloso desconhecido'))).toMatch(/tente novamente/i);
    expect(friendlyError(null)).toMatch(/tente novamente/i);
    expect(friendlyError(undefined, 'meu fallback')).toBe('meu fallback');
  });
});
