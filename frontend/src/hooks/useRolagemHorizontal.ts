// Quem diz se uma faixa que rola na horizontal tem conteúdo escondido — e para que lado.
//
// **O defeito que isto conserta.** A faixa de navegação (`NavDeTelas`) rola desde
// 13/10/2026, mas o único aviso de que havia aba além da borda era a máscara que
// esmaece o fim da faixa. Quem não tem roda horizontal no mouse (a maioria dos
// notebooks da operação, e todo mouse de duas teclas) não tinha COMO chegar nas abas
// escondidas: shift+roda é truque de quem já sabe, e a barra de rolagem está oculta de
// propósito. O Erick abriu a tela em 19/11/2026 e a OPERAÇÃO estava cortada ao meio,
// sem nada clicável para continuar.
//
// Este hook devolve as duas bordas, para a faixa desenhar uma seta em cada lado que
// tem mais conteúdo — seta que só existe quando há para onde ir, senão vira cromo que
// mente.
//
// **Medido por evento, não por `ResizeObserver`** — o observer já falhou nesta base
// sem avisar (ver o cabeçalho do `AppShell`). `scroll` + `resize` + `fonts.ready` +
// todo render cobrem as quatro causas reais de mudança: o usuário rolou, a janela
// mudou, a fonte chegou e trocou a largura do texto, e a lista de abas mudou.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { remedeQuandoAFonteChegar } from './useAlturaMedida.ts';

export interface BordasDeRolagem {
  /** Há conteúdo escondido ANTES do que se vê (já se rolou para a direita). */
  esquerda: boolean;
  /** Há conteúdo escondido DEPOIS do que se vê. */
  direita: boolean;
}

/**
 * A conta pura, para ser testável sem DOM.
 *
 * A folga de 1px não é frescura: com zoom do navegador em 110% ou 125% — e a operação
 * usa — `scrollWidth` e `clientWidth` saem de arredondamentos diferentes e sobra meio
 * pixel de diferença numa faixa que cabe inteira. Sem a folga, a seta da direita
 * aparece em tela cheia apontando para nada.
 */
export function calculaBordas(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
): BordasDeRolagem {
  const folga = 1;
  return {
    esquerda: scrollLeft > folga,
    direita: scrollLeft + clientWidth < scrollWidth - folga,
  };
}

/** Quanto um clique na seta anda: quase uma tela, mas nunca tão pouco que não valha o
 *  clique nem tanto que o usuário perca o ponto de referência. */
export function passoDeRolagem(clientWidth: number): number {
  return Math.max(120, Math.round(clientWidth * 0.75));
}

export function useRolagemHorizontal<T extends HTMLElement>(): {
  ref: React.RefObject<T | null>;
  bordas: BordasDeRolagem;
  rola: (direcao: -1 | 1) => void;
} {
  const ref = useRef<T | null>(null);
  const [bordas, setBordas] = useState<BordasDeRolagem>({ esquerda: false, direita: false });
  // Guarda pelo RESULTADO: `useLayoutEffect` sem lista de dependências roda a cada
  // render, e um `setBordas` com objeto novo a cada passada seria um laço infinito.
  const ultima = useRef<string>('');

  const medir = useCallback(() => {
    const elemento = ref.current;
    const proximo =
      elemento === null
        ? { esquerda: false, direita: false }
        : calculaBordas(elemento.scrollLeft, elemento.clientWidth, elemento.scrollWidth);
    const chave = `${String(proximo.esquerda)}|${String(proximo.direita)}`;
    if (chave === ultima.current) return;
    ultima.current = chave;
    setBordas(proximo);
  }, []);

  useLayoutEffect(medir);
  useEffect(() => {
    const elemento = ref.current;
    elemento?.addEventListener('scroll', medir, { passive: true });
    window.addEventListener('resize', medir);
    remedeQuandoAFonteChegar(medir);
    return () => {
      elemento?.removeEventListener('scroll', medir);
      window.removeEventListener('resize', medir);
    };
  }, [medir]);

  const rola = useCallback((direcao: -1 | 1) => {
    const elemento = ref.current;
    if (elemento === null) return;
    elemento.scrollBy({ left: direcao * passoDeRolagem(elemento.clientWidth), behavior: 'smooth' });
  }, []);

  return { ref, bordas, rola };
}
