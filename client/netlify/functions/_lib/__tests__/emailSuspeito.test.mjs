// Os quatro primeiros casos sao REAIS, medidos na base em 12/08/2026. Dois deles
// faltaram a videochamada, e a causa provavel nao e o dossie: com o endereco
// errado no convite, o Google nunca entregou o convite da agenda, entao a pessoa
// ficou sem o link do Meet.
import { describe, it, expect } from 'vitest';
import { avaliarEmail, textoDoAviso } from '../emailSuspeito.mjs';

describe('erros de digitacao encontrados na base', () => {
  const reais = [
    ['weldersonwrs@gmai.com', 'weldersonwrs@gmail.com'],
    ['anapaulassantos79@gmailcom', null],          // sem ponto: nem formato valido
    ['pauloindalecio@hotmai.com', 'pauloindalecio@hotmail.com'],
    ['mac.cazotti@htomail.com', 'mac.cazotti@hotmail.com'],
  ];
  for (const [email, sugestao] of reais) {
    it(`reprova ${email}`, () => {
      const r = avaliarEmail(email);
      expect(r.ok).toBe(false);
      if (sugestao) expect(r.sugestao).toBe(sugestao);
    });
  }
});

describe('endereco bom passa', () => {
  const bons = [
    'acambientecontabil@gmail.com',
    'sueli@fasanosp.com.br',
    'ricardocruz@policiamilitar.sp.gov.br',
    'luiz.chaves@biolabprimavera.com.br',
    'nome+etiqueta@gmail.com',
    'a@b.co',
  ];
  for (const email of bons) {
    it(email, () => expect(avaliarEmail(email).ok).toBe(true));
  }
});

describe('formato', () => {
  it('reprova vazio e nulo', () => {
    expect(avaliarEmail('').motivo).toBe('vazio');
    expect(avaliarEmail(null).motivo).toBe('vazio');
    expect(avaliarEmail(undefined).motivo).toBe('vazio');
  });

  it('reprova sem arroba, sem ponto e com espaco', () => {
    expect(avaliarEmail('semarroba.com').motivo).toBe('formato');
    expect(avaliarEmail('sem@ponto').motivo).toBe('formato');
    expect(avaliarEmail('com espaco@gmail.com').motivo).toBe('formato');
    expect(avaliarEmail('dois@@gmail.com').motivo).toBe('formato');
  });

  it('reprova extensao de uma letra', () => {
    expect(avaliarEmail('joao@empresa.c').motivo).toBe('extensao_curta');
  });

  it('nao se importa com maiuscula nem espaco em volta', () => {
    expect(avaliarEmail('  Joao@Gmail.COM  ').ok).toBe(true);
  });
});

describe('texto do aviso', () => {
  it('diz o problema, a sugestao e a consequencia', () => {
    const email = 'weldersonwrs@gmai.com';
    const t = textoDoAviso({
      email, avaliacao: avaliarEmail(email),
      quandoTexto: 'Quinta-feira, 13 de agosto, às 10h30',
    });
    expect(t).toContain('gmai.com');
    expect(t).toContain('weldersonwrs@gmail.com');          // a sugestao
    expect(t).toContain('link do Meet');                    // a consequencia real
    expect(t).toContain('Quinta-feira, 13 de agosto');
    expect(t).toContain('Corrija o convidado no evento');   // o que fazer
  });

  it('funciona sem sugestao', () => {
    const t = textoDoAviso({
      email: 'coisa-errada', avaliacao: avaliarEmail('coisa-errada'),
      quandoTexto: 'Sexta-feira, 14 de agosto, às 15h',
    });
    expect(t).toContain('não tem formato de e-mail válido');
    expect(t).not.toContain('Provavelmente seria');
  });

  it('nunca usa travessao', () => {
    const email = 'x@gmai.com';
    const t = textoDoAviso({ email, avaliacao: avaliarEmail(email), quandoTexto: 'hoje' });
    expect(t).not.toMatch(/[—–]/);
  });
});
