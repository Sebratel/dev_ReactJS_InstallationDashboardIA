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
  const alvosDa = (i: number) => alvosDaCategoria(chavesDeEixo, categorias[i]?.valores ?? []);

  /**
   * CURSOR DE MÃO SÓ ONDE O CLIQUE FILTRA. A categoria que não filtra (nula, eixo sem
   * tabela) não pode parecer igual à que filtra — promessa falsa nos dois sentidos.
   */
  const podeClicar = (i: number) => aoFiltrar !== undefined && alvosDa(i).length > 0;

  /**
   * O QUE ESTÁ SELECIONADO NO EIXO. Com a auto-exclusão do servidor, o visual clicado
   * volta com TODAS as categorias (clicar em SÃO LEOPOLDO mantém as outras cidades), e o
   * clique só tem efeito visível pelo destaque: a selecionada cheia, as outras esmaecem.
   * Sem filtro em nenhum nível do eixo, nada esmaece.
   */
  const selecaoDoEixo = selecaoDoEixoDe(chavesDeEixo, filtros);
  const haSelecao = selecaoDoEixo.some((s) => s !== null);
  const estaSelecionada = (i: number) => estaSelecionadaCategoria(selecaoDoEixo, categorias[i]?.valores ?? []);

  return {
    sob,
    classeDa: (i) =>
      'col-grupo' + (podeClicar(i) ? ' clicavel' : '') + (haSelecao && !estaSelecionada(i) ? ' apagada' : ''),
    aoEntrar: (i) => {
      setSob(i);
      if (podeClicar(i)) aoPrever?.(alvosDa(i));
    },
    aoSair: () => setSob(null),
    clica: (i) => {
      if (!aoFiltrar) return;
      const alvos = alvosDa(i);
      if (alvos.length > 0) aoFiltrar(alvos);
    },
  };
}
