// Validacao do Link Kommo na ORIGEM (03/08/2026).
// Contexto: o linkKommo e digitado a mao e congela no contrato. Em 02/08 isso custou 37
// leads mortos / 42 contratos, com 271 notas e 57 cobrancas que nunca chegaram ao cliente.
//
// O coracao desta feature e separar "o lead NAO existe" (404) de "nao consegui conferir"
// (429/500/timeout). Os dois chegam como Error do kGet, com texto quase igual. Se o
// codigo confundir, ou bloqueia contrato legitimo quando o Kommo oscila, ou deixa passar
// lead morto — os dois modos de falha que a feature existe para evitar.
import { describe, it, expect } from 'vitest';
import { classificarLink, classificarFalha, HOST_OFICIAL } from '../../../netlify/functions/_lib/kommoLink.mjs';

describe('classificarLink — de qual lead/conta e o link', () => {
  it('aceita o link normal da conta oficial', () => {
    const r = classificarLink('https://advocaciacbc.kommo.com/leads/detail/18219824');
    expect(r).toMatchObject({ veredito: 'checar', leadId: '18219824', host: HOST_OFICIAL });
  });

  // ⚠️ ESTE BLOCO EXISTE POR CAUSA DE UM BUG REAL (03/08/2026): a 1a versao ancorava o
  // regex em `dominio + /leads/detail/`. Medido depois contra os 460 links do banco:
  // so 6 passariam e 296 seriam reprovados por engano (64%), travando a maioria dos
  // envios no checklist. A equipe cola a URL da barra do navegador, que traz /chats/N/.
  // Formatos abaixo sao copias literais de linhas reais de contratos.
  it('aceita os formatos REAIS colados pela equipe (nao so o caminho limpo)', () => {
    const reais = [
      ['https://advocaciacbc.kommo.com/chats/10115/leads/detail/13312166?t=1782138587.1', '13312166'], // 161 no banco
      ['https://advocaciacbc.kommo.com/chats/leads/detail/10691546?filter%5Bterm%5D=LU', '10691546'],  // 11 no banco
      ['https://advocaciacbc.kommo.com/leads/detail/12796728', '12796728'],                            // 3 no banco
      ['https://advocaciacbc.kommo.com/chats/3063/leads/detail/6023416?t=1779905262.5&filter%5Bpipe%5D%5B13760367%5D%5B%5D=106167795', '6023416'],
    ];
    for (const [link, id] of reais) {
      const r = classificarLink(link);
      expect(r.veredito, link).toBe('checar');
      expect(r.leadId, link).toBe(id);
    }
  });

  it('link colado duas vezes e "quebrado", nao "de outra conta" (casos reais do banco)', () => {
    // "e de outra conta Kommo (https:)" nao diria nada a quem le
    for (const link of [
      'https://https://advocaciacbc.kommo.com/chats/31831/leads/detail/12822852',
      'https://advocaciachttps://advocaciacbc.kommo.com/chats/31036/leads/detail/999',
    ]) {
      const r = classificarLink(link);
      expect(r.veredito, link).toBe('invalido');
      expect(r.motivo, link).toMatch(/colado duas vezes|quebrado/i);
    }
  });

  it('URL que nao e do Kommo continua reprovada (106 links do banco eram do Drive)', () => {
    const r = classificarLink('https://drive.google.com/drive/folders/1MV6dtF2jck1QWry5g9qKlPapAr1nunJj');
    expect(r.veredito).toBe('invalido');
  });

  it('aceita variacoes de URL que a equipe cola no dia a dia', () => {
    const casos = [
      'https://advocaciacbc.kommo.com/leads/detail/123?from=list',
      'https://advocaciacbc.kommo.com/leads/detail/123#tab',
      'http://advocaciacbc.kommo.com/leads/detail/123',
      '  https://advocaciacbc.kommo.com/leads/detail/123  ',
    ];
    for (const c of casos) expect(classificarLink(c).leadId, c).toBe('123');
  });

  it('REPROVA link de OUTRA conta Kommo — nosso token nao alcanca', () => {
    // caso real achado em 02/08: um contrato apontava para brunoadvocaciacbccom
    const r = classificarLink('https://brunoadvocaciacbccom.kommo.com/leads/detail/999');
    expect(r.veredito).toBe('nao_existe');
    expect(r.motivo).toMatch(/outra conta/i);
  });

  it('reprova lixo / campo vazio sem chamar o Kommo', () => {
    for (const v of ['', null, undefined, 'abc', 'https://google.com', 'https://advocaciacbc.kommo.com/leads']) {
      expect(classificarLink(v).veredito, String(v)).toBe('invalido');
    }
  });

  it('id puro (sem URL) nao vale — o campo pede a URL da conversa', () => {
    // aceitar "18219824" solto abriria espaco p/ colar id de outra conta sem perceber
    expect(classificarLink('18219824').veredito).toBe('invalido');
  });
});

describe('classificarFalha — 404 e definitivo, o resto e duvida', () => {
  it('404 significa que o lead NAO existe', () => {
    expect(classificarFalha(new Error('Kommo GET /leads/18219824 HTTP 404')).veredito).toBe('nao_existe');
  });

  it('erro transitorio NAO pode virar "nao existe" (senao trava contrato legitimo)', () => {
    for (const msg of [
      'Kommo GET /leads/1 HTTP 429',
      'Kommo GET /leads/1 HTTP 500',
      'Kommo GET /leads/1 HTTP 502',
      'Kommo GET /leads/1 HTTP 401',   // token vencido: duvida, nao ausencia
      'timeout lead 6000ms',
      'fetch failed',
    ]) {
      expect(classificarFalha(new Error(msg)).veredito, msg).toBe('desconhecido');
    }
  });

  it('nao confunde 404 no meio de outro numero', () => {
    // id do lead terminando em 404 nao pode ser lido como status 404
    expect(classificarFalha(new Error('Kommo GET /leads/404 HTTP 500')).veredito).toBe('desconhecido');
    expect(classificarFalha(new Error('Kommo GET /leads/1404 HTTP 429')).veredito).toBe('desconhecido');
  });

  it('404 e reconhecido mesmo com o id contendo 404', () => {
    expect(classificarFalha(new Error('Kommo GET /leads/404 HTTP 404')).veredito).toBe('nao_existe');
  });

  it('entrada estranha nao quebra e cai no lado seguro (desconhecido)', () => {
    for (const v of [null, undefined, '', {}, 0]) {
      expect(classificarFalha(v).veredito, String(v)).toBe('desconhecido');
    }
  });
});
