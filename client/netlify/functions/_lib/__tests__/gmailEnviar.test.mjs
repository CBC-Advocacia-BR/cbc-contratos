// So a montagem do MIME e testada aqui. A chamada de rede ao Gmail fica de fora:
// e o padrao do projeto (a decisao vira lib pura, a rede so na function), e um
// MIME malformado e justamente o erro que passa despercebido, porque o Gmail
// aceita a requisicao e entrega um e-mail quebrado.
import { describe, it, expect } from 'vitest';
import { montarMime } from '../gmailEnviar.mjs';

const base = (extra = {}) => montarMime({
  de: 'Conforto, Bergonsi & Cavalari Advogados <institucional@advocaciacbc.com>',
  para: 'lead@exemplo.com',
  responderPara: 'beatriz@advocaciacbc.com',
  assunto: 'Sua videochamada de sexta-feira (14/08), às 15h',
  html: '<p>Olá, Fátima.</p>',
  texto: 'Olá, Fátima.',
  anexo: { nome: 'CBC-Advogados-Apresentacao.pdf', bytes: Buffer.from('%PDF-1.7 teste') },
  ...extra,
});

describe('cabecalhos', () => {
  it('poe De, Para e Responder-para', () => {
    const m = base();
    expect(m).toContain('To: lead@exemplo.com');
    expect(m).toContain('Reply-To: beatriz@advocaciacbc.com');
    expect(m).toContain('institucional@advocaciacbc.com');
  });

  it('omite o Responder-para quando nao ha', () => {
    expect(base({ responderPara: null })).not.toContain('Reply-To:');
  });

  it('codifica o assunto com acento (RFC 2047)', () => {
    // assunto com acento em texto cru chega com caractere trocado em varios
    // clientes de e-mail; o Gmail nao reclama, so entrega errado
    const m = base();
    expect(m).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    expect(m).not.toContain('Subject: Sua videochamada de sexta');
  });

  it('nao codifica assunto que so tem ASCII', () => {
    expect(base({ assunto: 'Sua videochamada' })).toContain('Subject: Sua videochamada');
  });

  it('nao deixa injetar cabecalho pelo assunto', () => {
    // assunto vem de bot_config, que e editavel: uma quebra de linha ali poderia
    // inserir um Bcc: e mandar copia para terceiro.
    //
    // O que importa NAO e o texto "Bcc:" sumir (ele pode aparecer legitimamente
    // dentro do valor do assunto), e sim nenhuma LINHA comecar por ele, que e o
    // que transformaria o texto em cabecalho de verdade.
    const m = base({ assunto: 'Oi\r\nBcc: intruso@exemplo.com' });
    const linhas = m.split('\r\n');
    expect(linhas.some((l) => /^bcc:/i.test(l))).toBe(false);
    expect(linhas.filter((l) => /^Subject:/.test(l))).toHaveLength(1);
    expect(m).toContain('Subject: Oi Bcc: intruso@exemplo.com');   // virou uma linha so
  });

  it('nao deixa injetar cabecalho pelo destinatario nem pelo nome do anexo', () => {
    const m = base({
      para: 'lead@exemplo.com\r\nBcc: intruso@exemplo.com',
      anexo: { nome: 'x.pdf"\r\nBcc: intruso@exemplo.com', bytes: Buffer.from('a') },
    });
    expect(m.split('\r\n').some((l) => /^bcc:/i.test(l))).toBe(false);
  });
});

describe('estrutura', () => {
  it('manda texto puro e HTML na mesma mensagem', () => {
    const m = base();
    expect(m).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(m).toContain('Content-Type: text/html; charset="UTF-8"');
    expect(m).toContain('multipart/alternative');
  });

  it('anexa o PDF em base64', () => {
    const m = base();
    expect(m).toContain('Content-Type: application/pdf');
    expect(m).toContain('Content-Transfer-Encoding: base64');
    expect(m).toContain('filename="CBC-Advogados-Apresentacao.pdf"');
    expect(m).toContain(Buffer.from('%PDF-1.7 teste').toString('base64'));
  });

  it('funciona sem anexo', () => {
    const m = base({ anexo: null });
    expect(m).not.toContain('application/pdf');
    expect(m).toContain('text/html');
  });

  it('quebra o base64 em linhas de 76, como o RFC manda', () => {
    const m = base({ anexo: { nome: 'x.pdf', bytes: Buffer.alloc(5000, 65) } });
    const linhas = m.split('\r\n').filter((l) => /^[A-Za-z0-9+/=]{40,}$/.test(l));
    expect(linhas.length).toBeGreaterThan(10);
    expect(Math.max(...linhas.map((l) => l.length))).toBeLessThanOrEqual(76);
  });

  it('usa CRLF, nao LF solto', () => {
    // servidor de e-mail rejeita ou corrompe MIME com quebra de linha solitaria
    const m = base();
    expect(m).toContain('\r\n');
    expect(m.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('fecha a fronteira do multipart', () => {
    const m = base();
    const fronteira = m.match(/boundary="([^"]+)"/)[1];
    expect(m.trimEnd().endsWith(`--${fronteira}--`)).toBe(true);
  });
});
