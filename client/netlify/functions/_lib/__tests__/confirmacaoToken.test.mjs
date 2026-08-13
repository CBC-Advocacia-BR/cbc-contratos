import { describe, it, expect } from 'vitest';
import { assinar, conferir, linkConfirmacao } from '../confirmacaoToken.mjs';

const S = 'segredo-de-teste-nao-usado-em-producao';

describe('assinatura', () => {
  it('aceita o proprio token', () => {
    expect(conferir('evt1', 'sim', assinar('evt1', 'sim', S), S)).toBe(true);
  });

  it('recusa token de OUTRO evento', () => {
    // e o ataque obvio: os ids do Google Calendar aparecem em convites
    expect(conferir('evt2', 'sim', assinar('evt1', 'sim', S), S)).toBe(false);
  });

  it('recusa quando trocam a resposta no link', () => {
    // quem recebe o link de "confirmo" nao pode virar "remarcar" so editando a URL
    expect(conferir('evt1', 'remarcar', assinar('evt1', 'sim', S), S)).toBe(false);
  });

  it('recusa token vazio, nulo e lixo', () => {
    expect(conferir('evt1', 'sim', '', S)).toBe(false);
    expect(conferir('evt1', 'sim', null, S)).toBe(false);
    expect(conferir('evt1', 'sim', 'aaaaaaaaaaaaaaaaaaaa', S)).toBe(false);
  });

  it('recusa com o segredo errado', () => {
    expect(conferir('evt1', 'sim', assinar('evt1', 'sim', S), 'outro-segredo')).toBe(false);
  });

  it('nao explode sem segredo, so recusa', () => {
    expect(conferir('evt1', 'sim', 'x', undefined)).toBe(false);
  });

  it('assinar sem segredo lanca, para o erro aparecer na geracao e nao no clique', () => {
    expect(() => assinar('evt1', 'sim', '')).toThrow(/BOT_RPC_SECRET/);
  });
});

describe('link', () => {
  it('monta a URL com evento, resposta e assinatura', () => {
    const url = linkConfirmacao('https://x.dev', 'evt1', 'sim', S);
    expect(url).toContain('/videochamada-confirmar?e=evt1&r=sim&t=');
    const t = new URL(url).searchParams.get('t');
    expect(conferir('evt1', 'sim', t, S)).toBe(true);
  });

  it('escapa id com caractere especial', () => {
    const url = linkConfirmacao('https://x.dev', 'a b&c', 'remarcar', S);
    expect(url).toContain('e=a%20b%26c');
    expect(new URL(url).searchParams.get('e')).toBe('a b&c');
  });
});
