import { describe, it, expect } from 'vitest';
import { decideSaveMode, SAVE_MODES } from '../saveGuard';

// Trava anti-substituicao (17/07/2026): contrato enviado/assinado NUNCA e sobrescrito
// pelo salvar do formulario; rascunho com resort trocado pergunta (salvar manual) ou
// vira contrato novo (fluxo de envio ZapSign, onde o doc ja foi criado).
describe('decideSaveMode', () => {
  it('enviado_zapsign: sempre cria contrato novo (caso Fernanda 16/07)', () => {
    expect(decideSaveMode({ statusAtual: 'enviado_zapsign', resortAtual: 'Barretos Country', resortNovo: 'Hot Beach You' }))
      .toBe(SAVE_MODES.INSERT_NOVO);
    // mesmo SEM trocar resort: contrato enviado e imutavel via formulario
    expect(decideSaveMode({ statusAtual: 'enviado_zapsign', resortAtual: 'Barretos Country', resortNovo: 'Barretos Country' }))
      .toBe(SAVE_MODES.INSERT_NOVO);
  });

  it('assinado: sempre cria contrato novo', () => {
    expect(decideSaveMode({ statusAtual: 'assinado', resortAtual: 'Gran Paradiso', resortNovo: 'Gran Paradiso' }))
      .toBe(SAVE_MODES.INSERT_NOVO);
  });

  it('cancelado: nunca reaproveita a linha — cria novo', () => {
    expect(decideSaveMode({ statusAtual: 'cancelado', resortAtual: 'X', resortNovo: 'X' }))
      .toBe(SAVE_MODES.INSERT_NOVO);
  });

  it('registro sumiu (deletado/nao encontrado): cria novo em vez de update cego', () => {
    expect(decideSaveMode({ statusAtual: null, resortAtual: null, resortNovo: 'Gran Paradiso' }))
      .toBe(SAVE_MODES.INSERT_NOVO);
    expect(decideSaveMode({ statusAtual: undefined, resortAtual: undefined, resortNovo: 'Gran Paradiso' }))
      .toBe(SAVE_MODES.INSERT_NOVO);
  });

  it('rascunho com mesmo resort: update normal (sessao de trabalho)', () => {
    expect(decideSaveMode({ statusAtual: 'rascunho', resortAtual: 'Gran Paradiso', resortNovo: 'Gran Paradiso' }))
      .toBe(SAVE_MODES.UPDATE);
  });

  it('rascunho com resort trocado (salvar manual): pergunta novo vs corrigir', () => {
    expect(decideSaveMode({ statusAtual: 'rascunho', resortAtual: 'Barretos Country', resortNovo: 'Hot Beach You' }))
      .toBe(SAVE_MODES.PERGUNTAR);
  });

  it('rascunho com resort trocado no fluxo de ENVIO: novo automatico (doc ZapSign ja existe)', () => {
    expect(decideSaveMode({ statusAtual: 'rascunho', resortAtual: 'Barretos Country', resortNovo: 'Hot Beach You', fluxoEnvio: true }))
      .toBe(SAVE_MODES.INSERT_NOVO);
  });

  it('rascunho preenchendo resort pela primeira vez (antes vazio): update, nao e troca', () => {
    expect(decideSaveMode({ statusAtual: 'rascunho', resortAtual: '', resortNovo: 'Gran Paradiso' }))
      .toBe(SAVE_MODES.UPDATE);
    expect(decideSaveMode({ statusAtual: 'rascunho', resortAtual: null, resortNovo: 'Gran Paradiso' }))
      .toBe(SAVE_MODES.UPDATE);
  });

  it('rascunho apagando o resort (novo vazio): update, nao considera troca', () => {
    expect(decideSaveMode({ statusAtual: 'rascunho', resortAtual: 'Gran Paradiso', resortNovo: '' }))
      .toBe(SAVE_MODES.UPDATE);
  });

  it('comparacao de resort ignora caixa e espacos nas pontas', () => {
    expect(decideSaveMode({ statusAtual: 'rascunho', resortAtual: ' Gran Paradiso ', resortNovo: 'gran paradiso' }))
      .toBe(SAVE_MODES.UPDATE);
  });

  it('status desconhecido/futuro: trata como protegido (cria novo)', () => {
    expect(decideSaveMode({ statusAtual: 'algum_status_novo', resortAtual: 'X', resortNovo: 'X' }))
      .toBe(SAVE_MODES.INSERT_NOVO);
  });
});
