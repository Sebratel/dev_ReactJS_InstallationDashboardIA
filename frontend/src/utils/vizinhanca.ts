// A VIZINHANÇA de um estado da tela: os estados a um clique de filtro dele (ACHADOS #179).
//
// O clique de UM valor já sai pronto do servidor (#163 pré-calcula cada valor das
// segmentações de até 40 valores, a partir da abertura). O segundo filtro em cima do
// primeiro é combinação nova, ~1 s a frio — e não dá para pré-calcular todas as
// combinações. Dá para pré-calcular as que estão a UM clique de onde a pessoa está, no
// tempo em que ela lê a tela antes de clicar de novo. É o que `useVizinhanca` faz com
// esta lista.
//
// **As contas são as do clique de verdade**, de propósito: `alternaValor` é a de
// `SegmentacaoChips`/`Segmentacao` (o valor entra na seleção, ou sai se já estava) e o
// resto é `aplicaSelecao` e a regra de `mudaFiltro` para os clicados. Uma conta
// diferente daria outra URL, e o pré-carregamento encheria uma chave que o clique nunca
// lê.

import type { FiltroDaTela, Valor } from '../services/dashboardService.ts';
import { aplicaSelecao, chaveDeCampo, selecaoDe, type CampoClicado } from './rota.ts';

/** Uma segmentação com a lista de valores já carregada. */
export interface SegmentacaoComValores {
  tabela: string;
  coluna: string;
  valores: readonly Valor[];
}

export interface EstadoDaTela {
  filtros: FiltroDaTela[];
  clicados: CampoClicado[];
}

/** A seleção depois de clicar em `v`: entra, ou sai se já estava. */
export function alternaValor(selecao: readonly Valor[], v: Valor): Valor[] {
  const marcado = selecao.some((x) => Object.is(x, v));
  return marcado ? selecao.filter((x) => !Object.is(x, v)) : [...selecao, v];
}

/**
 * Os estados a um clique, na ordem das segmentações e dos valores, até `teto`.
 *
 * Só segmentação de coluna (sem nível de data): o período é a árvore, e os meses
 * recentes já são pré-calculados pelo servidor (`filtrosRecentes`).
 */
export function estadosVizinhos(
  estado: EstadoDaTela,
  segmentacoes: readonly SegmentacaoComValores[],
  teto: number,
): EstadoDaTela[] {
  const out: EstadoDaTela[] = [];
  for (const s of segmentacoes) {
    const selecao = selecaoDe(estado.filtros, s.tabela, s.coluna);
    const clicados = estado.clicados.filter((c) => chaveDeCampo(c) !== chaveDeCampo(s));
    for (const v of s.valores) {
      if (out.length >= teto) return out;
      out.push({
        filtros: aplicaSelecao(estado.filtros, s.tabela, s.coluna, alternaValor(selecao, v)),
        clicados,
      });
    }
  }
  return out;
}
