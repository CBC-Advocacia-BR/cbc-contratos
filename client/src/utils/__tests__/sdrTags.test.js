import { describe, it, expect } from 'vitest';
import { escolherTagResort, unirTags, palavraChave, normalizar, TAG_SITUACAO, TAGS_SITUACAO_IDS } from '../../../netlify/functions/_lib/sdrTags.mjs';

describe('sdrTags', () => {
  it('normaliza acento/caixa e acha a palavra-chave', () => {
    expect(normalizar('Solar das Águas')).toBe('SOLAR DAS AGUAS');
    expect(palavraChave('Resort Ondas Praia')).toBe('ONDAS');
    expect(palavraChave('')).toBeNull();
  });
  it('casa o resort dito pelo lead com a tag canonica, nao com combinacoes', () => {
    const cands = [{ id: 85726, name: 'BRENDA-Ondas Praia' }, { id: 86984, name: 'BRENDA-Ondas Praia-Quitado' }, { id: 87150, name: 'Acordos Particular-Ondas Praia' }];
    expect(escolherTagResort('Ondas Praia Resort (Porto Seguro)', cands)?.id).toBe(54530);
    expect(escolherTagResort('ondas em porto', cands)?.id).toBe(54530);
    expect(escolherTagResort('solar das aguas', [])?.id).toBe(54358);
    expect(escolherTagResort('Hot Beach', [])?.id).toBe(54522);
    expect(escolherTagResort('hot beach you', [])?.id).toBe(54638);
    expect(escolherTagResort('Thermas de São Pedro', [])?.id).toBe(54366);
    // caso real do piloto 08/09: 'Praias em Goiás' e Praias do Lago (Caldas Novas), nao a tag solta 'PRAIAS'
    expect(escolherTagResort('Praias em Goiás', [{ id: 203792, name: 'PRAIAS' }, { id: 86848, name: 'BRENDA-Praias do Lago' }])?.id).toBe(54608);
  });
  it('nao arrisca tag quando nao ha casamento razoavel', () => {
    expect(escolherTagResort('um lugar em Gramado que nao lembro', [])).toBeNull();
    expect(escolherTagResort('', [])).toBeNull();
    expect(escolherTagResort(null, [{ id: 1, name: 'X' }])).toBeNull();
  });
  it('usa candidato vivo do Kommo quando nao esta na lista preferida', () => {
    expect(escolherTagResort('Costa do Sauipe', [{ id: 209831, name: 'COSTA DO SAUIPE' }])?.id).toBe(209831);
  });
  it('unirTags mantem as atuais, troca a situacao e soma o resort', () => {
    expect(unirTags([126160, TAG_SITUACAO.pagando], { resortId: 54530, situacaoId: TAG_SITUACAO.quitada })).toEqual([54530, 54550, 126160]);
    expect(unirTags([], { resortId: null, situacaoId: null })).toEqual([]);
    expect(unirTags(['54530'], { resortId: 54530 })).toEqual([54530]);
    expect(TAGS_SITUACAO_IDS).toHaveLength(3);
  });
});
