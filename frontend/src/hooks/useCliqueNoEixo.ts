// O clique numa categoria do eixo (coluna do gráfico, linha do ranking): o que filtra,
// o que fica em destaque e o que o mouse adianta. Era a mesma conta em `Grafico.tsx` e
// em `RankingBarra.tsx`; a regra de cada parte está em `utils/graficoClique.ts`.

import { useState } from 'react';
import type { FiltroDaTela, Valor } from '../services/dashboardService.ts';
import {
  alvosDaCategoria,
  chavesDeEixoDe,
  estaSelecionadaCategoria,
  selecaoDoEixoDe,
  type ChaveDoGrafico,
} from '../utils/graficoClique.ts';
import type { AoFiltrar } from '../utils/rota.ts';

/** O que acontece com o mouse e o clique sobre uma categoria (índice visível). */
export interface InteracaoDoGrafico {
  /** A categoria sob o mouse, ou `null`. */
  sob: number | null;
  /** Se o clique nesta categoria dispara filtro cruzado. */
  podeClicar: (i: number) => boolean;
  /** `col-grupo`, mais `clicavel` onde o clique filtra e `apagada` fora da seleção. */
  classeDa: (i: number) => string;
  aoEntrar: (i: number) => void;
  aoSair: () => void;
  clica: (i: number) => void;
}

export function useCliqueNoEixo(
  chaves: readonly unknown[],
  categorias: readonly { valores: readonly Valor[] }[],
  filtros: readonly FiltroDaTela[] | undefined,
  aoFiltrar: AoFiltrar | undefined,
  aoPrever: AoFiltrar | undefined,
): InteracaoDoGrafico {
  const [sob, setSob] = useState<number | null>(null);

  /**
   * O clique manda a CATEGORIA INTEIRA, um alvo por chave de eixo — a ordem casa porque
   * `graficoForma.ts` projeta `categorias[].valores` pelo mesmo filtro de papel que
   * `chavesDeEixoDe` usa. Valor nulo sai da lista: `(vazio)` não é valor de banco. Se a
   * categoria inteira for nula, não sobra alvo e o clique não faz nada.
   */
  const chavesDeEixo = chavesDeEixoDe(chaves as ChaveDoGrafico[]);
  const alvosDa = (indice: number) =>
    alvosDaCategoria(chavesDeEixo, categorias[indice]?.valores ?? []);

  /**
   * CURSOR DE MÃO SÓ ONDE O CLIQUE FILTRA. A categoria que não filtra (nula, eixo sem
   * tabela) não pode parecer igual à que filtra — promessa falsa nos dois sentidos.
   */
  const podeClicar = (indice: number) => aoFiltrar !== undefined && alvosDa(indice).length > 0;

  /**
   * O QUE ESTÁ SELECIONADO NO EIXO. Com a auto-exclusão do servidor, o visual clicado
   * volta com TODAS as categorias (clicar em SÃO LEOPOLDO mantém as outras cidades), e o
   * clique só tem efeito visível pelo destaque: a selecionada cheia, as outras esmaecem.
   * Sem filtro em nenhum nível do eixo, nada esmaece.
   */
  const selecaoDoEixo = selecaoDoEixoDe(chavesDeEixo, filtros);
  const haSelecao = selecaoDoEixo.some((serie) => serie !== null);
  const estaSelecionada = (indice: number) =>
    estaSelecionadaCategoria(selecaoDoEixo, categorias[indice]?.valores ?? []);

  return {
    sob,
    podeClicar,
    classeDa: (indice) =>
      'col-grupo' +
      (podeClicar(indice) ? ' clicavel' : '') +
      (haSelecao && !estaSelecionada(indice) ? ' apagada' : ''),
    aoEntrar: (indice) => {
      setSob(indice);
      if (podeClicar(indice)) aoPrever?.(alvosDa(indice));
    },
    aoSair: () => setSob(null),
    clica: (indice) => {
      if (!aoFiltrar) return;
      const alvos = alvosDa(indice);
      if (alvos.length > 0) aoFiltrar(alvos);
    },
  };
}
