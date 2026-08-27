// Faixas de cromo que dizem a própria altura.
//
// **O problema que isto resolve.** `--util` (o que sobra da tela para os cards) é
// `100vh` menos a soma de `--h-topbar`, `--h-nav` e `--h-filtros`. Enquanto esses três
// forem números escritos no `:root`, eles são um PALPITE sobre uma caixa que o
// navegador dimensiona sozinho — e quando o palpite erra para baixo, todo card da
// página fica maior do que cabe, sem nada acusando.
//
// Medido em 27/08/2026, com `--h-filtros: 50px` no `:root`:
//
//     visao-geral .......... 71px    (14 controles, quebra em 2 linhas)
//     agendamento-field .... 71px
//     manutencao-inicial ... 71px, e **110px** em 1366x768 (3 linhas)
//
// Ou seja, a conta errava por 21px em toda página e por **60px** na pior — mais de um
// terço da faixa que ela deveria representar. Nenhum teste falhava, porque o erro não
// está no CSS nem no componente: está na distância entre o número declarado e a caixa
// real.
//
// A faixa de navegação já fazia isto (o `AppShell` publicava `--h-nav`); aqui a
// mecânica vira uma peça só, para a barra de filtros usar a mesma.

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Mede o nó e publica a altura em `documentElement.style`, como `<nome>: <n>px`.
 *
 * Publica no `documentElement` porque `--util` é lido por regras que não descendem da
 * faixa medida (`.v-matriz`, `.caixa-grafico`). Só escreve quando o valor **muda** —
 * sem essa guarda, cada render reescreveria a variável e dispararia o próximo layout.
 *
 * `useLayoutEffect` sem lista de dependências: roda depois de **todo** render, que é o
 * único jeito de pegar a faixa mudando de altura sem um `resize` de janela — é o que
 * acontece quando um filtro entra, quando a troca de tela muda a quantidade de
 * controles, ou quando a fonte termina de carregar. E antes da pintura, senão o
 * primeiro quadro sai com a altura velha.
 *
 * Quando o nó não está montado (página sem barra de filtros), publica `0px`: a faixa
 * que não existe não pode continuar cobrando espaço na conta.
 */
export function usaAlturaMedida<T extends HTMLElement>(
  nome: string,
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const ultima = useRef<number>(-1);

  const medir = useCallback(() => {
    const px = ref.current === null ? 0 : Math.round(ref.current.getBoundingClientRect().height);
    if (px === ultima.current) return;
    ultima.current = px;
    document.documentElement.style.setProperty(nome, `${px}px`);
  }, [nome]);

  useLayoutEffect(medir);
  useEffect(() => {
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [medir]);

  return ref;
}
