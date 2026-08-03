import { describe, it, expect } from 'vitest';
import { maskCPF, maskCEP, maskRG, maskPhone, maskCNPJ } from '../masks';

describe('maskCPF', () => {
  it('formata CPF completo', () => {
    expect(maskCPF('12345678900')).toBe('123.456.789-00');
  });

  it('formata progressivamente', () => {
    expect(maskCPF('123')).toBe('123');
    expect(maskCPF('1234')).toBe('123.4');
    expect(maskCPF('1234567')).toBe('123.456.7');
    expect(maskCPF('12345678')).toBe('123.456.78');
  });

  it('ignora caracteres nao-numericos', () => {
    expect(maskCPF('abc123def456ghi789jkl00')).toBe('123.456.789-00');
  });

  it('limita a 11 digitos', () => {
    expect(maskCPF('1234567890012345')).toBe('123.456.789-00');
  });

  it('aceita string vazia', () => {
    expect(maskCPF('')).toBe('');
  });
});

describe('maskCEP', () => {
  it('formata CEP completo', () => {
    expect(maskCEP('01310100')).toBe('01310-100');
  });

  it('limita a 8 digitos', () => {
    expect(maskCEP('013101001234')).toBe('01310-100');
  });

  it('ignora nao-numericos', () => {
    expect(maskCEP('01.310-100')).toBe('01310-100');
  });
});

describe('maskRG', () => {
  it('preserva digitos, letras, ponto, hifen e barra', () => {
    expect(maskRG('12.345.678-9')).toBe('12.345.678-9');
    expect(maskRG('AB123/45')).toBe('AB123/45');
  });

  it('remove caracteres invalidos', () => {
    expect(maskRG('12@345#678!')).toBe('12345678');
  });

  it('limita a 20 caracteres', () => {
    expect(maskRG('123456789012345678901234567890').length).toBeLessThanOrEqual(20);
  });
});

describe('maskCNPJ', () => {
  it('formata CNPJ completo', () => {
    expect(maskCNPJ('11222333000181')).toBe('11.222.333/0001-81');
  });

  it('formata progressivamente', () => {
    expect(maskCNPJ('11')).toBe('11');
    expect(maskCNPJ('112')).toBe('11.2');
    expect(maskCNPJ('11222')).toBe('11.222');
    expect(maskCNPJ('11222333')).toBe('11.222.333');
    expect(maskCNPJ('112223330001')).toBe('11.222.333/0001');
  });

  it('ignora caracteres nao-numericos', () => {
    expect(maskCNPJ('ab11.222/333-0001!81')).toBe('11.222.333/0001-81');
  });

  it('limita a 14 digitos', () => {
    expect(maskCNPJ('112223330001819999')).toBe('11.222.333/0001-81');
  });

  it('aceita string vazia', () => {
    expect(maskCNPJ('')).toBe('');
  });
});

describe('maskPhone', () => {
  it('formata celular 11 digitos', () => {
    expect(maskPhone('11987654321')).toBe('(11) 98765-4321');
  });

  it('formata progressivamente', () => {
    // mascara aplica apos 3 digitos (regex requer (\d{2})(\d))
    expect(maskPhone('11')).toBe('11');
    expect(maskPhone('119')).toBe('(11) 9');
    expect(maskPhone('1198')).toBe('(11) 98');
    expect(maskPhone('1198765')).toBe('(11) 98765');
  });

  it('limita a 11 digitos', () => {
    expect(maskPhone('119876543210000')).toBe('(11) 98765-4321');
  });

  // (auditoria 01/08/2026 — item 311) A mascara so era testada com celular. Telefone
  // FIXO tem 8 digitos apos o DDD, nao 9, e saia deformado: '(11) 34567-890'. O teste
  // que faltava e o que revelou o defeito.
  it('formata telefone FIXO de 10 digitos', () => {
    expect(maskPhone('1134567890')).toBe('(11) 3456-7890');
    expect(maskPhone('1932345678')).toBe('(19) 3234-5678'); // DDD de Americana
  });

  it('troca de formato ao passar de fixo para celular', () => {
    // enquanto se digita, o numero passa por 10 antes de chegar a 11
    expect(maskPhone('193234567')).toBe('(19) 3234-567');
    expect(maskPhone('1932345678')).toBe('(19) 3234-5678');
    expect(maskPhone('19932345678')).toBe('(19) 93234-5678');
  });

  it('nao deixa hifen sobrando no fim', () => {
    // '(11) 3456-' com o cursor logo depois e um estado feio e comum em mascara mal feita
    expect(maskPhone('113456')).toBe('(11) 3456');
    expect(maskPhone('1134')).toBe('(11) 34');
  });

  it('aceita numero ja formatado sem se perder', () => {
    expect(maskPhone('(19) 3234-5678')).toBe('(19) 3234-5678');
    expect(maskPhone('+55 19 99999-8888')).toBe('(55) 19999-9988'); // sem tratar o +55
  });

  it('nao quebra com vazio, nulo ou texto', () => {
    expect(maskPhone('')).toBe('');
    expect(maskPhone(null)).toBe('');
    expect(maskPhone(undefined)).toBe('');
    expect(maskPhone('abc')).toBe('');
  });
});
