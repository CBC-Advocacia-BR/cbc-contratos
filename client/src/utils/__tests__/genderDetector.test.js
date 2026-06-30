import { describe, it, expect } from 'vitest';
import { detectGenderByName, getGenderUpdates, adjustProfissaoGender } from '../genderDetector';

describe('detectGenderByName', () => {
  it('detecta feminino por terminacao em A', () => {
    expect(detectGenderByName('Maria Silva')).toBe('F');
    expect(detectGenderByName('Ana Santos')).toBe('F');
    expect(detectGenderByName('Fernanda')).toBe('F');
  });

  it('detecta masculino por terminacao em O', () => {
    expect(detectGenderByName('Paulo Conforto')).toBe('M');
    expect(detectGenderByName('Pedro')).toBe('M');
    expect(detectGenderByName('Joao Silva')).toBe('M');
  });

  it('detecta masculino por terminacao em consoante', () => {
    expect(detectGenderByName('Anderson')).toBe('M');
    expect(detectGenderByName('Carlos')).toBe('M');
    expect(detectGenderByName('Heitor')).toBe('M');
    expect(detectGenderByName('Rafael')).toBe('M');
  });

  it('lista de femininos com terminacao atipica', () => {
    expect(detectGenderByName('Beatriz')).toBe('F');
    expect(detectGenderByName('Raquel')).toBe('F');
    expect(detectGenderByName('Iris')).toBe('F');
  });

  it('masculinos terminados em A', () => {
    expect(detectGenderByName('Davi Souza')).toBe('M');
    expect(detectGenderByName('Lucas')).toBe('M');
    expect(detectGenderByName('Tobias')).toBe('M');
  });

  it('nomes ambiguos retornam null', () => {
    // Darci esta em AMBIGUOS e nao em FEMININOS/MASCULINOS_EM_A — verdadeiramente ambiguo
    expect(detectGenderByName('Darci')).toBe(null);
    expect(detectGenderByName('Mauri')).toBe(null);
    expect(detectGenderByName('Neri')).toBe(null);
  });

  it('aceita acentos e converte', () => {
    expect(detectGenderByName('João')).toBe('M');
    expect(detectGenderByName('Antônio')).toBe('M');
  });

  it('input invalido retorna null', () => {
    expect(detectGenderByName('')).toBe(null);
    expect(detectGenderByName(null)).toBe(null);
    expect(detectGenderByName(undefined)).toBe(null);
    expect(detectGenderByName('A')).toBe(null);
  });
});

describe('adjustProfissaoGender', () => {
  it('engenheiro para feminino vira engenheira', () => {
    expect(adjustProfissaoGender('engenheiro', 'F').toLowerCase()).toBe('engenheira');
  });

  it('engenheira para masculino vira engenheiro', () => {
    expect(adjustProfissaoGender('engenheira', 'M').toLowerCase()).toBe('engenheiro');
  });

  it('advogado <-> advogada', () => {
    expect(adjustProfissaoGender('advogado', 'F').toLowerCase()).toBe('advogada');
    expect(adjustProfissaoGender('advogada', 'M').toLowerCase()).toBe('advogado');
  });

  it('preserva capitalizacao da primeira letra', () => {
    expect(adjustProfissaoGender('Engenheiro', 'F')).toBe('Engenheira');
    expect(adjustProfissaoGender('Advogado', 'F')).toBe('Advogada');
  });

  it('professor para feminino', () => {
    expect(adjustProfissaoGender('professor', 'F').toLowerCase()).toBe('professora');
  });

  it('input vazio retorna input', () => {
    expect(adjustProfissaoGender('', 'F')).toBe('');
    expect(adjustProfissaoGender('advogado', null)).toBe('advogado');
  });
});

describe('getGenderUpdates', () => {
  it('feminino ajusta nacionalidade brasileiro(a) para brasileira', () => {
    const updates = getGenderUpdates('Maria Silva', { nacionalidade: 'brasileiro(a)' });
    expect(updates.nacionalidade).toBe('brasileira');
  });

  it('masculino ajusta brasileiro(a) para brasileiro', () => {
    const updates = getGenderUpdates('Paulo Silva', { nacionalidade: 'brasileiro(a)' });
    expect(updates.nacionalidade).toBe('brasileiro');
  });

  it('feminino ajusta estado civil', () => {
    const updates = getGenderUpdates('Maria', { estadoCivil: 'casado' });
    expect(updates.estadoCivil).toBe('Casada');
  });

  it('masculino ajusta estado civil', () => {
    const updates = getGenderUpdates('Paulo', { estadoCivil: 'casada' });
    expect(updates.estadoCivil).toBe('Casado');
  });

  it('nome ambiguo retorna objeto vazio', () => {
    const updates = getGenderUpdates('Darci', { estadoCivil: 'casado' });
    expect(updates).toEqual({});
  });

  it('preserva sexo se ja definido', () => {
    const updates = getGenderUpdates('Maria', { sexo: 'F', estadoCivil: 'casado' });
    expect(updates.sexo).toBeUndefined();
  });

  it('seta sexo se nao definido', () => {
    const updates = getGenderUpdates('Maria', {});
    expect(updates.sexo).toBe('F');
  });
});
