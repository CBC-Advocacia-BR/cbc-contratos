// Sanitizacao de texto p/ CAMPOS personalizados do Kommo (31/07/2026).
// Contexto (caso Leomara, lead 12822852): o Kommo persiste campos custom em
// armazenamento que NAO aceita caracteres fora do BMP (emoji de 4 bytes UTF-8).
// O PATCH retorna 200, mas o valor e truncado silenciosamente no primeiro emoji:
// "Olá, Leomara! 😊 Seu contrato... {link}" virou "Olá, Leomara! " e o Salesbot
// enviou so a saudacao, sem o link de assinatura (100 disparos afetados 02-31/07).
// Fonte: netlify/functions/_lib/kommoText.mjs (modulo PURO, padrao assinaturaWhatsapp).
import { describe, it, expect } from 'vitest';
import { paraCampoKommo, persistiuIgual } from '../../../netlify/functions/_lib/kommoText.mjs';
import { montarMensagem } from '../../../netlify/functions/_lib/assinaturaWhatsapp.mjs';

const ASTRAL = /[\u{10000}-\u{10FFFF}]/u;

describe('paraCampoKommo — transliteracao astral -> BMP', () => {
  it('troca 😊 por ☺️ (sobrevive ao utf8mb3 do Kommo)', () => {
    const out = paraCampoKommo('Olá, Leomara! 😊 Seu contrato está pronto.');
    expect(out).toBe('Olá, Leomara! ☺️ Seu contrato está pronto.');
    expect(ASTRAL.test(out)).toBe(false);
  });

  it('troca 👉 por ➡️ antes do link', () => {
    const out = paraCampoKommo('👉 https://app.zapsign.com.br/verificar/abc');
    expect(out).toBe('➡️ https://app.zapsign.com.br/verificar/abc');
    expect(ASTRAL.test(out)).toBe(false);
  });

  it('sanitiza a msg_1 REAL da config sem perder o link nem as quebras de linha', () => {
    const msg1 = 'Olá, {nome}! 😊 Seu contrato com a CBC Advogados está pronto para assinatura digital. É rápido e pode ser feito pelo celular:\n👉 {link}\nQualquer dúvida, é só responder por aqui.';
    const montada = montarMensagem(
      [{ nome: 'LEOMARA AMORIM DO ROSARIO PRADO', link: 'https://app.zapsign.com.br/verificar/597e4336' }],
      { msg_1: msg1 },
    );
    const out = paraCampoKommo(montada);
    expect(ASTRAL.test(out)).toBe(false);
    expect(out).toContain('Olá, Leomara! ☺️ Seu contrato');
    expect(out).toContain('➡️ https://app.zapsign.com.br/verificar/597e4336');
    expect(out.split('\n')).toHaveLength(3);
  });

  it('a copy nova (ja em BMP) passa ilesa — byte a byte', () => {
    const nova = 'Olá, Maria! ☺️ Seu contrato está pronto:\n➡️ https://x.y/z\nQualquer dúvida, é só responder por aqui.';
    expect(paraCampoKommo(nova)).toBe(nova);
  });
});

describe('paraCampoKommo — remocao de astrais sem equivalente', () => {
  it('remove emoji sem mapa e colapsa o espaco que sobra', () => {
    expect(paraCampoKommo('Saldo 💰 disponível')).toBe('Saldo disponível');
    expect(paraCampoKommo('📄 Documento pronto')).toBe('Documento pronto');
  });

  it('remove sequencias compostas inteiras (ZWJ, tom de pele, bandeira)', () => {
    expect(paraCampoKommo('familia 👨‍👩‍👧 unida')).toBe('familia unida');
    expect(paraCampoKommo('joia 👍🏽 dada')).toBe('joia dada');
    expect(paraCampoKommo('brasil 🇧🇷 sil')).toBe('brasil sil');
  });

  it('nao deixa seletor de variacao orfao ao remover astral com FE0F', () => {
    const out = paraCampoKommo('assinar 🖌️ aqui');
    expect(out).toBe('assinar aqui');
    expect(out.includes('\uFE0F')).toBe(false);
  });

  it('emoji astral no fim da mensagem (caso da régua de cobrança)', () => {
    expect(paraCampoKommo('é só responder esta mensagem. 😊')).toBe('é só responder esta mensagem. ☺️');
  });
});

describe('paraCampoKommo — textos sem astral ficam INTOCADOS', () => {
  it('preserva byte a byte, inclusive espacos duplos e BMP (✍️ ✅ ⚠️ → # keycap)', () => {
    const casos = [
      'texto  com  espacos duplos legitimos',
      '✍️ *Maria*: https://x.y/a\n✍️ *Jose*: https://x.y/b',
      'checklist ✅ pronto ⚠️ atencao → seguir',
      'tecla #️⃣ pressionada',
      'PIX copia-e-cola: 00020126580014BR.GOV.BCB.PIX',
      'https://www.asaas.com/i/abc123?x=1&y=2',
    ];
    for (const c of casos) expect(paraCampoKommo(c)).toBe(c);
  });

  it('null continua null; string vazia continua vazia', () => {
    expect(paraCampoKommo(null)).toBe(null);
    expect(paraCampoKommo(undefined)).toBe(null);
    expect(paraCampoKommo('')).toBe('');
  });

  it('nunca devolve caractere fora do BMP, qualquer que seja a entrada', () => {
    const entradas = ['🤖🚀🎯💥🌈', 'a😊b👉c💰d', '😊', '👨‍👩‍👧‍👦'];
    for (const e of entradas) expect(ASTRAL.test(paraCampoKommo(e))).toBe(false);
  });
});

describe('persistiuIgual — verificacao pos-gravacao (le o campo de volta)', () => {
  it('detecta o truncamento real do caso Leomara', () => {
    const enviado = 'Olá, Leomara! ☺️ Seu contrato...\n➡️ https://x.y/z';
    expect(persistiuIgual(enviado, 'Olá, Leomara! ')).toBe(false);
  });

  it('igualdade tolerante a CRLF e espacos das pontas', () => {
    expect(persistiuIgual('linha1\nlinha2', 'linha1\r\nlinha2')).toBe(true);
    expect(persistiuIgual('  texto ', 'texto')).toBe(true);
  });

  it('campo limpo: null, undefined e vazio se equivalem', () => {
    expect(persistiuIgual(null, null)).toBe(true);
    expect(persistiuIgual(null, '')).toBe(true);
    expect(persistiuIgual('', null)).toBe(true);
    expect(persistiuIgual('x', null)).toBe(false);
  });
});
