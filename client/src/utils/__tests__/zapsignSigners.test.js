// (auditoria 01/08/2026 — item 204) A decisão que muda o status de um contrato para
// "assinado" vivia em TRÊS cópias (polling do App, botão do ContratosTab, webhook do
// servidor) — em dois formatos de campo diferentes, já divergindo. Estes testes travam a
// fonte única: se ela errar, um contrato assinado deixa de ser reconhecido, ou pior, um
// não assinado vira assinado.
import { describe, it, expect } from 'vitest';
import { lerSignatarios, linksMudaram } from '../../../netlify/functions/_lib/zapsignSigners.mjs';

const AGORA = new Date('2026-08-02T12:00:00Z');

// formato CRU da API do ZapSign (usado pelo polling e pelo webhook)
const cru = (over = {}) => ({
  name: 'Maria', email: 'maria@ex.com', token: 'tk1',
  sign_url: 'https://app.zapsign.com.br/verificar/tk1', status: 'signed',
  signed_at: '2026-07-30T10:00:00Z', times_viewed: 3, ...over,
});
// formato NORMALIZADO pelo zapsignService (usado pelo botão do ContratosTab)
const norm = (over = {}) => ({
  name: 'Maria', email: 'maria@ex.com', token: 'tk1',
  signUrl: 'https://app.zapsign.com.br/verificar/tk1', status: 'signed',
  signedAt: '2026-07-30T10:00:00Z', times_viewed: 3, ...over,
});

describe('lerSignatarios — os DOIS formatos de campo dão o mesmo resultado', () => {
  it('formato cru e formato normalizado produzem links idênticos', () => {
    const a = lerSignatarios([cru()], AGORA);
    const b = lerSignatarios([norm()], AGORA);
    expect(a.links).toEqual(b.links);
    expect(a.assinadoEm).toBe(b.assinadoEm);
    expect(a.todosAssinaram).toBe(b.todosAssinaram);
  });

  it('normaliza o link de assinatura vindo de qualquer um dos 3 nomes', () => {
    expect(lerSignatarios([cru({ sign_url: 'A' })]).links[0].sign_url).toBe('A');
    expect(lerSignatarios([cru({ sign_url: null, signing_link: 'B' })]).links[0].sign_url).toBe('B');
    expect(lerSignatarios([norm({ signUrl: 'C' })]).links[0].sign_url).toBe('C');
  });
});

describe('lerSignatarios — quando o contrato vira ASSINADO', () => {
  it('todos assinados = sim', () => {
    const r = lerSignatarios([cru(), cru({ token: 'tk2' })], AGORA);
    expect(r.todosAssinaram).toBe(true);
    expect(r.total).toBe(2);
  });

  it('um pendente = NÃO vira assinado', () => {
    const r = lerSignatarios([cru(), cru({ token: 'tk2', status: 'new', signed_at: null })], AGORA);
    expect(r.todosAssinaram).toBe(false);
    expect(r.assinadoEm).toBe(null);
  });

  it('LISTA VAZIA nunca vira assinado (o [].every do JavaScript devolve true)', () => {
    // sem esta guarda, um documento sem signatários viraria contrato assinado sozinho
    expect(lerSignatarios([], AGORA).todosAssinaram).toBe(false);
    expect(lerSignatarios(null, AGORA).todosAssinaram).toBe(false);
    expect(lerSignatarios(undefined, AGORA).todosAssinaram).toBe(false);
  });

  it('recusa é sinalizada à parte (não é o mesmo que "falta assinar")', () => {
    const r = lerSignatarios([cru({ status: 'refused', signed_at: null })], AGORA);
    expect(r.algumRecusou).toBe(true);
    expect(r.todosAssinaram).toBe(false);
  });
});

describe('lerSignatarios — data real da assinatura', () => {
  it('usa a data do ÚLTIMO signatário, não a do primeiro', () => {
    const r = lerSignatarios([
      cru({ token: 'a', signed_at: '2026-07-28T09:00:00Z' }),
      cru({ token: 'b', signed_at: '2026-07-30T18:30:00Z' }),
      cru({ token: 'c', signed_at: '2026-07-29T11:00:00Z' }),
    ], AGORA);
    expect(r.assinadoEm).toBe('2026-07-30T18:30:00Z');
  });

  it('todos assinaram mas a API não devolveu data -> usa agora (nunca fica vazio)', () => {
    const r = lerSignatarios([cru({ signed_at: null })], AGORA);
    expect(r.todosAssinaram).toBe(true);
    expect(r.assinadoEm).toBe(AGORA.toISOString());
  });

  it('sem todos assinarem, não inventa data', () => {
    expect(lerSignatarios([cru({ status: 'new', signed_at: null })], AGORA).assinadoEm).toBe(null);
  });
});

describe('lerSignatarios — rastreio de visualização preservado', () => {
  it('contagem de aberturas vira número (a API às vezes manda texto)', () => {
    expect(lerSignatarios([cru({ times_viewed: '7' })]).links[0].times_viewed).toBe(7);
    expect(lerSignatarios([cru({ times_viewed: null })]).links[0].times_viewed).toBe(0);
    expect(lerSignatarios([cru({ times_viewed: 'x' })]).links[0].times_viewed).toBe(0);
  });

  it('datas de abertura ausentes viram null, nunca undefined', () => {
    const l = lerSignatarios([cru()]).links[0];
    expect(l.first_opened_at).toBe(null);
    expect(l.last_view_at).toBe(null);
  });
});

describe('linksMudaram — evita gravar (e auditar) a cada 5 minutos sem motivo', () => {
  it('iguais = não mudou', () => {
    const a = lerSignatarios([cru()]).links;
    const b = lerSignatarios([cru()]).links;
    expect(linksMudaram(a, b)).toBe(false);
  });

  it('qualquer diferença = mudou', () => {
    const a = lerSignatarios([cru()]).links;
    const b = lerSignatarios([cru({ times_viewed: 9 })]).links;
    expect(linksMudaram(a, b)).toBe(true);
  });

  it('nulo x vazio não conta como mudança', () => {
    expect(linksMudaram(null, [])).toBe(false);
  });

  // (06/08/2026) O bug que manteve 45,7 mil gravacoes em 20 dias apesar do guard:
  // o Postgres REORDENA as chaves de um objeto jsonb (por tamanho e depois alfabeto).
  // O objeto novo tem as chaves na ordem do codigo; o que volta do banco vem na ordem
  // do jsonb. Conteudo identico, JSON.stringify diferente -> "mudou" toda rodada de
  // 5 minutos. Este teste compara a lista recem-construida com a MESMA lista na ordem
  // em que o banco a devolve.
  it('mesma lista com chaves na ordem do jsonb do banco NAO conta como mudança', () => {
    const fresca = lerSignatarios([cru()]).links;
    const doBanco = fresca.map((l) => {
      const ordenado = {};
      // ordem do jsonb: tamanho da chave, depois bytes — como o PostgREST devolve
      for (const k of Object.keys(l).sort((a, b) => a.length - b.length || (a < b ? -1 : 1))) {
        ordenado[k] = l[k];
      }
      return ordenado;
    });
    expect(JSON.stringify(doBanco)).not.toBe(JSON.stringify(fresca)); // a armadilha existe...
    expect(linksMudaram(doBanco, fresca)).toBe(false);                // ...e o guard nao pode cair nela
  });

  it('diferenca real continua sendo detectada mesmo com ordens diferentes', () => {
    const fresca = lerSignatarios([cru({ status: 'signed' })]).links;
    const doBancoOutroStatus = lerSignatarios([cru({ status: 'link-opened' })]).links
      .map((l) => Object.fromEntries(Object.entries(l).reverse()));
    expect(linksMudaram(doBancoOutroStatus, fresca)).toBe(true);
  });
});
