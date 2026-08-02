// (auditoria 01/08/2026 — item 188) Um cache que erra na tela de Boletos mostra
// inadimplencia que ja foi paga. Estes testes travam as tres regras que impedem isso:
// a validade expira de verdade, gravacao invalida, e logout limpa tudo.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  gravarCacheAba, lerCacheAba, cacheFresco, idadeCacheAba,
  invalidarCacheAba, limparCacheAba, estatisticasCacheAba, TTL_PADRAO,
} from '../cacheAba';

beforeEach(() => limparCacheAba());
afterEach(() => vi.useRealTimers());

describe('cacheAba — o basico', () => {
  it('grava e le a MESMA referencia (nao serializa)', () => {
    // o painel de Boletos guarda ~11 mil linhas: se isto serializasse, travaria a tela
    const linhas = [{ id: 1 }, { id: 2 }];
    gravarCacheAba('boletos:raw', linhas);
    expect(lerCacheAba('boletos:raw')).toBe(linhas);
  });

  it('chave nunca gravada devolve null, nao undefined', () => {
    expect(lerCacheAba('nao-existe')).toBe(null);
    expect(idadeCacheAba('nao-existe')).toBe(null);
    expect(cacheFresco('nao-existe')).toBe(false);
  });

  it('gravar devolve os proprios dados (encadeia com o fetch)', () => {
    const d = [1, 2, 3];
    expect(gravarCacheAba('x', d)).toBe(d);
  });
});

describe('cacheAba — validade', () => {
  it('dentro do prazo, pula a consulta; passado o prazo, nao pula', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T10:00:00Z'));
    gravarCacheAba('boletos:raw', [1]);

    vi.setSystemTime(new Date('2026-08-02T10:04:00Z')); // 4 min
    expect(cacheFresco('boletos:raw')).toBe(true);

    vi.setSystemTime(new Date('2026-08-02T10:06:00Z')); // 6 min
    expect(cacheFresco('boletos:raw')).toBe(false);
  });

  it('expirado ainda PINTA a tela (mostra o que tem, confere depois)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T10:00:00Z'));
    gravarCacheAba('k', ['velho']);
    vi.setSystemTime(new Date('2026-08-02T11:00:00Z')); // 1h depois

    expect(cacheFresco('k')).toBe(false);        // vai consultar
    expect(lerCacheAba('k')).toEqual(['velho']); // mas nao pisca vazio
  });

  it('validade sob medida vence o padrao', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T10:00:00Z'));
    gravarCacheAba('k', [1]);
    vi.setSystemTime(new Date('2026-08-02T10:00:30Z')); // 30s
    expect(cacheFresco('k', 10_000)).toBe(false); // 10s de validade
    expect(cacheFresco('k', TTL_PADRAO)).toBe(true);
  });
});

describe('cacheAba — invalidacao (a regra que evita mostrar dado que mudou)', () => {
  it('invalida uma familia inteira pelo comeco da chave', () => {
    gravarCacheAba('boletos:raw', [1]);
    gravarCacheAba('boletos:customers', [2]);
    gravarCacheAba('vendas:contratos', [3]);

    invalidarCacheAba('boletos:');

    expect(lerCacheAba('boletos:raw')).toBe(null);
    expect(lerCacheAba('boletos:customers')).toBe(null);
    expect(lerCacheAba('vendas:contratos')).toEqual([3]); // vizinho intacto
  });

  it('invalidar sem prefixo apaga tudo', () => {
    gravarCacheAba('a', [1]); gravarCacheAba('b', [2]);
    invalidarCacheAba();
    expect(lerCacheAba('a')).toBe(null);
    expect(lerCacheAba('b')).toBe(null);
  });

  it('prefixo que nao casa com ninguem nao apaga nada', () => {
    gravarCacheAba('boletos:raw', [1]);
    invalidarCacheAba('asaas:');
    expect(lerCacheAba('boletos:raw')).toEqual([1]);
  });
});

describe('cacheAba — logout', () => {
  it('limpa dados E contadores (ha CPF e valor de cobranca aqui dentro)', () => {
    gravarCacheAba('boletos:customers', [{ cpf: '12345678901' }]);
    cacheFresco('boletos:customers');
    limparCacheAba();
    expect(lerCacheAba('boletos:customers')).toBe(null);
    expect(estatisticasCacheAba()).toEqual({ chaves: 0, acertos: 0, faltas: 0, aproveitamento: null });
  });
});

describe('cacheAba — estatisticas para o Monitor', () => {
  it('conta quantas consultas o cache evitou', () => {
    gravarCacheAba('k', [1]);
    cacheFresco('k');          // acerto
    cacheFresco('k');          // acerto
    cacheFresco('outra');      // falta
    const e = estatisticasCacheAba();
    expect(e.acertos).toBe(2);
    expect(e.faltas).toBe(1);
    expect(e.aproveitamento).toBe(67);
    expect(e.chaves).toBe(1);
  });
});
