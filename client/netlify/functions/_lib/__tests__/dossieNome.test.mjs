// Casos REAIS da agenda (medidos em 12/08/2026). A ordem da cascata nao e
// arbitraria: em 63 de 334 pares (18,9%) o titulo e o Kommo divergem, e o titulo
// ganha quase sempre, porque e o que a vendedora escreveu DEPOIS de falar com a
// pessoa. Escrever "Ola, Maria" para quem se apresenta como Fatima e pior do que
// nao escrever nome nenhum: denuncia automacao cega no material que existe
// justamente para parecer serio.
import { describe, it, expect } from 'vitest';
import { primeiroNome } from '../dossieNome.mjs';

describe('o titulo do evento vence o cadastro do Kommo', () => {
  const casos = [
    ['Fatima +5518997479595', 'Maria de Fátima Frare Silva', 'Fatima'],
    ['Patty +5511947000390', 'PATRICIA DE OLIVEIRA MOURA FROS', 'Patty'],
    ['Cidinha +553491317716', 'MARIA APARECIDA NOGUEIRA E SILVA', 'Cidinha'],
    ['Guto +556599539957', 'Jose - CLAUDIANA DE SOUZA DUARTE COSTA', 'Guto'],
    ['Irasmom +556294727007', 'SILVA IRASMON', 'Irasmom'],   // Kommo com sobrenome primeiro
    ['Eliomar +557991441161', 'Santos Eliomar', 'Eliomar'],  // idem
  ];
  for (const [titulo, kommo, esperado] of casos) {
    it(`${JSON.stringify(titulo)} -> ${esperado}`, () => {
      expect(primeiroNome(titulo, kommo)).toBe(esperado);
    });
  }
});

describe('limpeza do titulo', () => {
  it('tira o telefone do fim, em qualquer formato', () => {
    expect(primeiroNome('João 91 88151-233')).toBe('João');
    expect(primeiroNome('Antonio 19 97405-5513')).toBe('Antonio');
    expect(primeiroNome('Luiz 6696657579')).toBe('Luiz');
    expect(primeiroNome('Wesley +5527996404690')).toBe('Wesley');
  });

  it('tira marcador no comeco', () => {
    expect(primeiroNome('*Luciano 17997048445')).toBe('Luciano');
  });

  it('corta na pontuacao quando o titulo tem dois nomes', () => {
    expect(primeiroNome('Reale/ Cris +559391209694', 'REALE')).toBe('Reale');
  });

  it('normaliza a caixa, preservando acento', () => {
    expect(primeiroNome('MARCIA +5511995178866')).toBe('Marcia');
    expect(primeiroNome('márcia +5511995178866')).toBe('Márcia');
    expect(primeiroNome('JOÃO 11999999999')).toBe('João');
  });

  it('aguenta nome composto com hifen', () => {
    expect(primeiroNome('Ana-Paula 11999999999')).toBe('Ana');
  });
});

describe('quando o titulo nao serve, cai no Kommo', () => {
  it('titulo so com telefone', () => {
    expect(primeiroNome('17 991393438', 'Eliane')).toBe('Eliane');
  });

  it('titulo com palavra que nao e nome de pessoa', () => {
    expect(primeiroNome('Reagendamento +5511999999999', 'Carlos Souza')).toBe('Carlos');
    expect(primeiroNome('Retorno 11999999999', 'Ana Lima')).toBe('Ana');
  });

  it('rejeita apelido de sistema no Kommo tambem', () => {
    // "robsonagnelo98" tem digito: nao e nome, e mandar isso na capa seria pior
    // do que nao mandar nome nenhum
    expect(primeiroNome('11 999999999', 'robsonagnelo98')).toBe(null);
  });
});

describe('sem nome em lugar nenhum', () => {
  it('devolve null para a capa se virar sem nome', () => {
    expect(primeiroNome('11 999999999')).toBe(null);
    expect(primeiroNome('', null)).toBe(null);
    expect(primeiroNome(null, null)).toBe(null);
    expect(primeiroNome(undefined)).toBe(null);
  });

  it('nao aceita inicial solta', () => {
    expect(primeiroNome('J 11999999999')).toBe(null);
  });
});
