import { describe, it, expect } from 'vitest';
import { montarEmail } from '../dossieTexto.mjs';
import { quandoPorExtenso } from '../dossieVideochamada.mjs';
import { closerDaAgenda } from '../dossieClosers.mjs';

const QUANDO = quandoPorExtenso('2026-08-14T18:00:00Z');
const base = (extra = {}) => montarEmail({
  nome: 'Fátima', quando: QUANDO, vendedoraEmail: 'beatriz@advocaciacbc.com',
  config: {}, ...extra,
});

describe('assunto', () => {
  it('diz o dia e a hora, que e o que faz abrir', () => {
    expect(base().assunto).toBe('Sua videochamada de Sexta-feira (14/08), às 15h');
  });
});

describe('corpo', () => {
  it('trata a pessoa pelo nome', () => {
    expect(base().html).toContain('Olá, Fátima.');
  });

  it('funciona sem nome', () => {
    const r = base({ nome: null });
    expect(r.html).toContain('Olá!');
    expect(r.html).not.toContain('undefined');
    expect(r.html).not.toContain('null');
    expect(r.texto).not.toContain('undefined');
  });

  it('repete no corpo o essencial que esta no anexo', () => {
    // anexo de 4,5 MB muita gente nao abre no celular
    const h = base().html;
    expect(h).toContain('10 a 15 minutos');
    expect(h).toContain('não precisa decidir nada');
    expect(h).toContain('contrato de');
    expect(h).not.toContain('30 minutos');   // a duracao mudou em 12/08/2026
  });

  it('destaca o anexo em bloco proprio, no HTML e no texto puro', () => {
    // pedido do Paulo: o PDF e o motivo do e-mail existir, nao pode ficar
    // diluido no meio de um paragrafo
    const r = base();
    expect(r.html).toContain('Em anexo: a apresentação do escritório');
    expect(r.html).toContain('border-left:4px solid #1B3A5C');   // o bloco destacado
    expect(r.texto).toContain('>> EM ANEXO: a apresentação do escritório, em PDF.');
  });

  it('traz o bloco de verificacao, que e o que desarma a objecao de golpe', () => {
    const h = base().html;
    expect(h).toContain('OAB/SP 55.227');
    expect(h).toContain('56.096.172/0001-65');
    expect(h).toContain('Rua Guatemala, 122');
    expect(h).toContain('13465-761');
  });

  it('nunca usa travessao no que o cliente le', () => {
    // REGRA #6 do CLAUDE.md
    const r = base();
    expect(r.assunto + r.html + r.texto).not.toMatch(/[—–]/);
  });

  it('escapa o nome, para um sinal solto nao quebrar o HTML', () => {
    const h = base({ nome: "D'Ávila <b>" }).html;
    expect(h).toContain('&lt;b&gt;');
    expect(h).not.toContain('<b>');
  });

  it('tem versao em texto puro, para quem bloqueia HTML', () => {
    const t = base().texto;
    expect(t).toContain('Olá, Fátima.');
    expect(t).toContain('Sexta-feira, 14 de agosto, às 15h');
    expect(t).not.toMatch(/<[a-z]/i);
  });

  it('manda remarcar pelo WhatsApp, com link clicavel', () => {
    // decisao do Paulo (12/08): quem remarca decide em cima da hora, e e-mail
    // tem latencia de horas
    const r = base();
    expect(r.html).toContain('(19) 98805-1878');
    expect(r.html).toContain('https://wa.me/5519988051878');
    expect(r.html).toContain('Falar no WhatsApp agora');
    expect(r.html).not.toContain('é só responder este e-mail');
    // no texto puro o link precisa ir na mao, senao ninguem consegue clicar
    expect(r.texto).toContain('(19) 98805-1878');
    expect(r.texto).toContain('https://wa.me/5519988051878');
  });

  it('o link do WhatsApp leva o numero em formato internacional', () => {
    // wa.me sem o 55 abre conversa com numero errado
    expect(base().html).toMatch(/wa\.me\/5519988051878/);
  });

  it('devolve a vendedora como responder-para', () => {
    expect(base().responderPara).toBe('beatriz@advocaciacbc.com');
  });
});

describe('quem vai atender', () => {
  const comCloser = (email) => base({ closer: closerDaAgenda(email) });

  it('nomeia a closer com o tratamento e aponta a pagina do PDF', () => {
    const r = comCloser('marianamaciel@advocaciacbc.com');
    expect(r.html).toContain('Quem vai te atender');
    expect(r.html).toContain('Dra. Mariana Beraldo');
    expect(r.html).toContain('segunda página do PDF');
    expect(r.texto).toContain('Dra. Mariana Beraldo');
  });

  it('concorda o artigo e o pronome com o tratamento', () => {
    // o HTML e escrito em varias linhas; o que importa e a frase, nao a indentacao
    const frase = (email) => comCloser(email).html.replace(/\s+/g, ' ');
    expect(frase('emerson@advocaciacbc.com')).toContain('será com o <strong>Dr. Emerson');
    expect(frase('emerson@advocaciacbc.com')).toContain('A foto dele está');
    expect(frase('beatriz@advocaciacbc.com')).toContain('será com a <strong>Dra. Beatriz');
    expect(frase('beatriz@advocaciacbc.com')).toContain('A foto dela está');
  });

  it('sem closer o bloco some inteiro, e o e-mail continua correto', () => {
    // agenda fora do mapa: o PDF vai na versao generica, sem pagina de
    // apresentacao, entao apontar "a foto esta na segunda pagina" seria mentira
    const r = base();
    expect(r.html).not.toContain('Quem vai te atender');
    expect(r.html).not.toContain('segunda página');
    expect(r.texto).not.toContain('Quem vai te atender');
    expect(r.html).not.toContain('undefined');
  });

  it('nao deixa o bloco colar no paragrafo seguinte', () => {
    // o bloco entra no meio de um template; sem quebra a lista de anexo sobe junto
    expect(comCloser('beatriz@advocaciacbc.com').texto)
      .toContain('saber quem vai aparecer na chamada.\n\n>> EM ANEXO');
  });
});

describe('configuracao', () => {
  it('deixa trocar o assunto sem deploy', () => {
    const r = base({ config: { assunto: 'Amanhã tem conversa, {{primeiro_nome}}' } });
    expect(r.assunto).toBe('Amanhã tem conversa, Fátima');
  });

  it('marcador desconhecido no assunto vira vazio, nao quebra', () => {
    const r = base({ config: { assunto: 'Oi {{inexistente}}, {{hora}}' } });
    expect(r.assunto).toBe('Oi , 15h');
  });
});
