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
});
