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
import {
  clicaAno,
  clicaMes,
  selecaoDeData,
  type AnoDaArvore,
  type MudancaDeNivel,
} from './hierarquiaData.ts';

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
export function alternaValor(selecao: readonly Valor[], valor: Valor): Valor[] {
  const marcado = selecao.some((selecionado) => Object.is(selecionado, valor));
  return marcado
    ? selecao.filter((selecionado) => !Object.is(selecionado, valor))
    : [...selecao, valor];
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
  for (const segmentacao of segmentacoes) {
    const selecao = selecaoDe(estado.filtros, segmentacao.tabela, segmentacao.coluna);
    const clicados = estado.clicados.filter(
      (campoClicado) => chaveDeCampo(campoClicado) !== chaveDeCampo(segmentacao),
    );
    for (const valor of segmentacao.valores) {
      if (out.length >= teto) return out;
      out.push({
        filtros: aplicaSelecao(
          estado.filtros,
          segmentacao.tabela,
          segmentacao.coluna,
          alternaValor(selecao, valor),
        ),
        clicados,
      });
    }
  }
  return out;
}

/**
 * Os estados a um clique no PERÍODO: cada ano da árvore e cada mês dos anos marcados
 * (ou do ano mais recente, se nenhum estiver marcado), até `teto`.
 *
 * **Por que entrou (20/10/2026, teste de cliques no staging).** O período não estava em
 * pré-carregamento nenhum — nem aqui, nem no servidor — e foi o clique mais lento do
 * teste: `Período = 2024` na INSTALAÇÃO / REINCIDENTE levou 32 s. As contas são as do
 * clique de verdade: `clicaAno`/`clicaMes` (`ArvoreDeDatas`) e cada mudança aplicada como
 * `mudaFiltro` aplica (`aplicaSeletor`: o campo deixa de ser "clicado").
 */
export function estadosDoPeriodo(
  estado: EstadoDaTela,
  data: { tabela: string; coluna: string },
  arvore: readonly AnoDaArvore[],
  teto: number,
): EstadoDaTela[] {
  const sel = selecaoDeData(estado.filtros, data.tabela, data.coluna);
  const aplica = (mudancas: MudancaDeNivel[]): EstadoDaTela => ({
    filtros: mudancas.reduce(
      (acumulado, mudanca) =>
        aplicaSelecao(acumulado, data.tabela, data.coluna, mudanca.valores, mudanca.nivel),
      estado.filtros,
    ),
    clicados: estado.clicados.filter(
      (campoClicado) => chaveDeCampo(campoClicado) !== chaveDeCampo(data),
    ),
  });
  const anos = [...arvore].sort((primeiro, segundo) => segundo.ano - primeiro.ano);
  const doMes = anos.filter((anoAtual) => sel.anos.includes(anoAtual.ano));
  const out: EstadoDaTela[] = [];
  for (const alvo of doMes.length > 0 ? doMes : anos.slice(0, 1)) {
    for (const medida of [...alvo.meses].reverse())
      out.push(aplica(clicaMes(sel, alvo.ano, medida.nome)));
  }
  for (const anoAtual of anos) out.push(aplica(clicaAno(sel, anoAtual.ano)));
  return out.slice(0, teto);
}
