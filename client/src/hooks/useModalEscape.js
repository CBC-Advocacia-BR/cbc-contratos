import { useEffect } from 'react';

/**
 * (auditoria 01/08/2026 — item 278) Fecha o modal com a tecla Esc.
 *
 * POR QUE UM HOOK: dos 29 modais do sistema, so 7 tratavam Esc — e cada um com a sua
 * copia do mesmo useEffect. Quem trabalha rapido (a equipe passa o dia neste app) aprende
 * que Esc fecha caixa, tenta em todas, e em duas de cada tres nao acontece nada: e preciso
 * achar o "x" com o mouse. Pior: em modal SEM botao de fechar visivel, a pessoa fica presa.
 *
 * Com o hook, ligar Esc num modal e uma linha — e a regra fica num lugar so, em vez de
 * sete copias que podem divergir (o mesmo padrao que causou o bug do mapa do ADVBOX).
 *
 * REGRAS:
 *  - so escuta enquanto `aberto` for verdadeiro (nada de listener vivo com modal fechado);
 *  - NAO fecha se o foco estiver num campo com texto sendo composto (acento morto/IME):
 *    ali o Esc pertence ao teclado, nao ao modal;
 *  - `capture: true` para chegar antes de handlers de dentro do modal;
 *  - `stopPropagation` impede que UM Esc feche dois modais empilhados de uma vez.
 *
 * Uso:
 *   useModalEscape(isOpen, onClose);
 */
export function useModalEscape(aberto, aoFechar) {
  useEffect(() => {
    if (!aberto || typeof aoFechar !== 'function') return;
    const handler = (e) => {
      if (e.key !== 'Escape') return;
      if (e.isComposing) return; // acento morto / teclado de IME em andamento
      e.preventDefault();
      e.stopPropagation();
      aoFechar();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [aberto, aoFechar]);
}

export default useModalEscape;
