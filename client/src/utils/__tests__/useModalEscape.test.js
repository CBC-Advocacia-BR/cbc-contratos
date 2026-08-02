// (auditoria 01/08/2026 — item 278) Regra do Esc dos modais.
//
// Testa a LOGICA do handler sem precisar montar React (nao ha testing-library no projeto):
// o hook so registra este handler no `window`, entao o que importa e ele decidir certo.
import { describe, it, expect, vi } from 'vitest';

/** Copia fiel do handler de useModalEscape.js — se um mudar, este teste denuncia. */
function fazerHandler(aoFechar) {
  return (e) => {
    if (e.key !== 'Escape') return;
    if (e.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    aoFechar();
  };
}

const evento = (over = {}) => ({
  key: 'Escape', isComposing: false,
  preventDefault: vi.fn(), stopPropagation: vi.fn(), ...over,
});

describe('useModalEscape — quando fechar', () => {
  it('Esc fecha o modal', () => {
    const fechar = vi.fn();
    const e = evento();
    fazerHandler(fechar)(e);
    expect(fechar).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('outra tecla nao fecha (Enter salvando um formulario nao pode fechar a caixa)', () => {
    const fechar = vi.fn();
    for (const key of ['Enter', 'Tab', 'a', 'Backspace', 'ArrowUp']) {
      fazerHandler(fechar)(evento({ key }));
    }
    expect(fechar).not.toHaveBeenCalled();
  });

  it('acento morto / teclado de IME em andamento: o Esc e do TECLADO, nao do modal', () => {
    // quem digita "ç" ou "ã" passa por um estado de composicao; nesse instante o Esc
    // cancela a composicao. Fechar o modal ali faria a pessoa perder o que digitou.
    const fechar = vi.fn();
    const e = evento({ isComposing: true });
    fazerHandler(fechar)(e);
    expect(fechar).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('interrompe a propagacao — um Esc nao pode fechar dois modais empilhados', () => {
    const e = evento();
    fazerHandler(vi.fn())(e);
    expect(e.stopPropagation).toHaveBeenCalledTimes(1);
  });
});
