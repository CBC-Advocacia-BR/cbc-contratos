// (auditoria 01/08/2026 — itens 13/14/20/296) Testes da autenticacao das APIs de
// integracao. Antes desta lib as duas APIs aceitavam uma senha publicada no repositorio
// quando a variavel de ambiente faltava — e nada apitava.
import { describe, it, expect, afterEach } from 'vitest';
import { chavesDaEnv, autorizado, segredoIgual, SENHAS_DE_FABRICA } from '../apiAuth.mjs';

const ENV = 'TESTE_API_KEYS';
afterEach(() => { delete process.env[ENV]; });

// pedido falso, so com o que a lib le (headers + url)
const req = (headers = {}, url = 'https://x/.netlify/functions/api-rest') => ({
  url,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
});

describe('chavesDaEnv — a ausencia da chave DESATIVA o endpoint', () => {
  it('env ausente devolve erro (nunca uma senha de fabrica)', () => {
    const r = chavesDaEnv(ENV);
    expect(r.chaves).toEqual([]);
    expect(r.erro).toMatch(/nao configurada/i);
  });

  it('env vazia ou so espacos tambem devolve erro', () => {
    process.env[ENV] = '   ';
    expect(chavesDaEnv(ENV).erro).toBeTruthy();
  });

  it('recusa as senhas publicadas no repositorio', () => {
    for (const fraca of SENHAS_DE_FABRICA) {
      process.env[ENV] = fraca;
      const r = chavesDaEnv(ENV);
      expect(r.chaves).toEqual([]);
      expect(r.erro).toMatch(/senha de fabrica/i);
    }
  });

  it('recusa o conjunto inteiro se UMA das chaves for de fabrica', () => {
    process.env[ENV] = 'chave-forte-de-verdade-123,cbc-api-2026';
    expect(chavesDaEnv(ENV).erro).toMatch(/senha de fabrica/i);
  });

  it('aceita lista separada por virgula, aparando espacos', () => {
    process.env[ENV] = ' k1-forte , k2-forte ';
    expect(chavesDaEnv(ENV)).toEqual({ chaves: ['k1-forte', 'k2-forte'], erro: null });
  });
});

describe('autorizado — cabecalho Bearer e o caminho principal', () => {
  const chaves = ['segredo-A', 'segredo-B'];

  it('aceita Bearer valido (qualquer chave da lista)', () => {
    expect(autorizado(req({ authorization: 'Bearer segredo-A' }), chaves)).toBe(true);
    expect(autorizado(req({ authorization: 'Bearer segredo-B' }), chaves)).toBe(true);
  });

  it('aceita "bearer" minusculo (clientes variam a caixa)', () => {
    expect(autorizado(req({ authorization: 'bearer segredo-A' }), chaves)).toBe(true);
  });

  it('recusa chave errada, vazia e cabecalho ausente', () => {
    expect(autorizado(req({ authorization: 'Bearer errado' }), chaves)).toBe(false);
    expect(autorizado(req({ authorization: 'Bearer ' }), chaves)).toBe(false);
    expect(autorizado(req({}), chaves)).toBe(false);
  });

  it('recusa prefixo correto da chave (nao pode passar por comparacao parcial)', () => {
    expect(autorizado(req({ authorization: 'Bearer segredo-' }), chaves)).toBe(false);
  });
});

describe('autorizado — ?api_key= so vale no modo legado', () => {
  const chaves = ['segredo-A'];
  const comUrlKey = req({}, 'https://x/.netlify/functions/api-rest?api_key=segredo-A');

  it('por padrao RECUSA chave na URL (fica em log/historico/Referer)', () => {
    expect(autorizado(comUrlKey, chaves)).toBe(false);
  });

  it('aceita quando permitirUrl:true (integrador antigo, ate migrar)', () => {
    expect(autorizado(comUrlKey, chaves, { permitirUrl: true })).toBe(true);
  });
});

describe('segredoIgual — comparacao de tempo constante', () => {
  it('true so para valores identicos', () => {
    expect(segredoIgual('abc', 'abc')).toBe(true);
    expect(segredoIgual('abc', 'abd')).toBe(false);
  });

  it('tamanhos diferentes nao lancam excecao (timingSafeEqual exige igualdade)', () => {
    expect(segredoIgual('abc', 'abcdef')).toBe(false);
    expect(segredoIgual('', '')).toBe(false);
    expect(segredoIgual(null, undefined)).toBe(false);
  });
});
