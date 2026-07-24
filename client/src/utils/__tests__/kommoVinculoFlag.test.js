import { describe, it, expect } from 'vitest';
import { resolveFlag } from '../kommoVinculoFlag';

describe('resolveFlag (feature flag kommo_vinculo)', () => {
  it('off por padrao quando nao ha config', () => {
    expect(resolveFlag(undefined, 'a@x.com')).toBe(false);
    expect(resolveFlag(null, 'a@x.com')).toBe(false);
  });
  it('off quando ativo=false e usuario nao listado', () => {
    expect(resolveFlag({ ativo: false, usuarios: [] }, 'a@x.com')).toBe(false);
    expect(resolveFlag({ ativo: false, usuarios: ['b@x.com'] }, 'a@x.com')).toBe(false);
  });
  it('on quando ativo=true (global)', () => {
    expect(resolveFlag({ ativo: true }, 'a@x.com')).toBe(true);
    expect(resolveFlag({ ativo: true, usuarios: [] }, 'qualquer@x.com')).toBe(true);
  });
  it('on quando o e-mail esta na lista de usuarios (case-insensitive)', () => {
    expect(resolveFlag({ ativo: false, usuarios: ['a@x.com'] }, 'a@x.com')).toBe(true);
    expect(resolveFlag({ ativo: false, usuarios: ['A@X.com'] }, 'a@x.com')).toBe(true);
  });
  it('off se o e-mail for vazio e nao for global', () => {
    expect(resolveFlag({ ativo: false, usuarios: ['a@x.com'] }, '')).toBe(false);
    expect(resolveFlag({ ativo: false, usuarios: ['a@x.com'] }, null)).toBe(false);
  });
});
