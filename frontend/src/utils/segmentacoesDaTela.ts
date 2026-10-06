// Quais segmentações a tela desenha, e em que forma. Usado pela barra de filtros e
// pela vizinhança (`useVizinhanca`), que pré-carrega um clique em cada uma — as duas
// têm de ver a MESMA lista, na mesma ordem.

import type { FiltroDaTela, Segmentacao, VisualCalculado } from '../services/dashboardService.ts';

export interface SegmentacoesDaTela {
  /** TIPO DE PROTOCOLO como fileira de chips, quando a página o segmenta. */
  chips: Segmentacao | null;
  /** As demais, como botão + diálogo, na ordem do relatório. */
  dropdowns: { id: string; spec: Segmentacao }[];
  /** Filtros aplicados que nenhuma segmentação desta tela mostra. */
  ocultos: FiltroDaTela[];
}

/**
 * TIPO DE PROTOCOLO vira fileira de chips, não dropdown — é o "TIPO DE SOLICITAÇÃO" do
 * BY, poucos valores e sempre visíveis (ver `SegmentacaoChips.tsx`). Casado por
 * tabela+coluna, não por página: é o mesmo padrão de `dataDaPagina`, não uma config nova.
 */
const ehChipDeSolicitacao = (s: { tabela: string; coluna: string }): boolean =>
  s.tabela === 'PROTOCOLOS GERAL' && s.coluna === 'TIPO DE PROTOCOLO';

export function segmentacoesDaTela(
  visuais: readonly VisualCalculado[],
  dataDaTela: { tabela: string; coluna: string } | null,
  filtros: readonly FiltroDaTela[],
): SegmentacoesDaTela {
  // A segmentação de hierarquia da coluna de data sai da lista: a árvore ocupa o
  // lugar dela. O motor marca aquela como `naoFiltra` ("controle de drill... a
  // escolha ali é um caminho, não um conjunto de valores de um nível"), então ela
  // desenhava um botão que dizia "todos" com a página filtrada em julho. Deixar os
  // dois seria oferecer dois controles para a mesma coluna, um deles morto.
  const todas = visuais.filter(
    (v) =>
      v.segmentacao &&
      !(
        dataDaTela !== null &&
        v.segmentacao.tabela === dataDaTela.tabela &&
        v.segmentacao.coluna === dataDaTela.coluna
      ),
  );
  const chips = todas.find((v) => ehChipDeSolicitacao(v.segmentacao!))?.segmentacao ?? null;
  const dropdowns = todas
    .filter((v) => !ehChipDeSolicitacao(v.segmentacao!))
    .map((v) => ({ id: v.id, spec: v.segmentacao! }));

  // FILTRO SEM SEGMENTAÇÃO NA TELA É RECORTE INVISÍVEL.
  //
  // Nem todo filtro nasce de um slicer: clicar num card ou numa barra faz filtragem
  // cruzada, e a URL pode trazer um filtro de coluna que esta página nem segmenta.
  // Esses não apareciam em lugar nenhum — os números mudavam, a causa não estava na
  // tela e a única saída era recarregar. É a diferença entre "o dashboard está com
  // número errado" e "há um recorte aplicado".
  //
  // Os que TÊM slicer ficam de fora de propósito: o botão já mostra a seleção e a
  // contagem, e repetir a mesma informação em dois lugares vira ruído. A árvore de data
  // cobre TODOS os níveis da sua coluna (Ano, Mês, Dia) de uma vez — por isso ela sai
  // por coluna, não por nível, senão o mês padrão apareceria também como pill ao lado
  // do controle que já o mostra.
  const comSlicer = new Set(
    todas.map(
      (v) => `${v.segmentacao!.tabela}.${v.segmentacao!.coluna}.${v.segmentacao!.nivel ?? ''}`,
    ),
  );
  const ocultos = filtros.filter(
    (f) =>
      f.valores.length > 0 &&
      !comSlicer.has(`${f.tabela}.${f.coluna}.${f.nivel ?? ''}`) &&
      !(dataDaTela !== null && f.tabela === dataDaTela.tabela && f.coluna === dataDaTela.coluna),
  );

  return { chips, dropdowns, ocultos };
}
