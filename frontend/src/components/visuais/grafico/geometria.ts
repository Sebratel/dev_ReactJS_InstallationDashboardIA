// A geometria que as partes do gráfico compartilham, e a conta dela (`geometriaDoGrafico`).

import { marcasDoEixo } from '../../../utils/graficoForma.ts';

export const FACETA = 96;
// `base` de 64 e nao 46: a margem de baixo e o teto do rotulo girado, e com 46 ele
// cabia em 8 caracteres. Numa caixa de 460px sobra espaco, e o plot fica com 382.
export const MARGEM = { topo: 14, direita: 8, base: 64, esquerda: 54 };
/** A coluna mais larga: 54px, o `maxBarSize` do COM. Até 13/10/2026 eram 24px, e um
 *  gráfico de 6 categorias desenhava colunas de 11px num vão de 210. */
export const LARGURA_MAXIMA = 54;
/** O vão de 2px na cor do fundo é o que separa as fatias — nunca uma borda. */
export const VAO = 2;

export interface Geometria {
  /** A margem de cima: maior quando há chip de valor acima das colunas. */
  margemTopo: number;
  /** Largura de uma categoria no plot. */
  banda: number;
  alturaDoPlot: number;
  /** A margem de baixo de verdade (ela cede quando a caixa é baixa). */
  base: number;
  /** O valor no topo do eixo. */
  topo: number;
  y: (v: number) => number;
  xMeio: (i: number) => number;
  larguraDaMarca: number;
  larguraDaFatia: number;
}

/**
 * A geometria do desenho para uma caixa medida.
 *
 * A altura é EXATAMENTE a da caixa, sem piso (ver o cabeçalho de `Grafico.tsx`): quem
 * cede é a margem de baixo, no máximo 30% do espaço, então o plot é sempre positivo.
 *
 * @param teto o maior valor de TODAS as categorias, não das visíveis — reescalar o eixo
 *   a cada página faria duas páginas com colunas de altura igual valerem números
 *   diferentes.
 */
export function geometriaDoGrafico(p: {
  alturaDaCaixa: number;
  larguraDoPlot: number;
  nCategorias: number;
  naFaceta: boolean;
  teto: number;
  empilha: boolean;
  nAreas: number;
  /** Há chip de valor acima das colunas: a margem de cima cresce para ele caber (26px,
   *  a do COM com rótulo). */
  comRotulos?: boolean;
}): { geo: Geometria; marcas: number[] } {
  const margemTopo = p.comRotulos ? 26 : MARGEM.topo;
  const espacoAbaixoDoTopo = p.alturaDaCaixa - margemTopo - (p.naFaceta ? FACETA : 0);
  const base = Math.max(18, Math.min(MARGEM.base, Math.round(espacoAbaixoDoTopo * 0.3)));
  const alturaDoPlot = Math.max(1, espacoAbaixoDoTopo - base);
  const banda = p.nCategorias > 0 ? p.larguraDoPlot / p.nCategorias : p.larguraDoPlot;
  const marcas = marcasDoEixo(p.teto);
  const topo = Math.max(...marcas, 1);
  // 70% da categoria: o vão entre vizinhas fica proporcional, como no COM.
  const larguraDaMarca = Math.min(LARGURA_MAXIMA, Math.max(6, banda * 0.7));
  return {
    marcas,
    geo: {
      margemTopo,
      banda,
      alturaDoPlot,
      base,
      topo,
      y: (v) => margemTopo + alturaDoPlot * (1 - v / topo),
      xMeio: (i) => MARGEM.esquerda + banda * (i + 0.5),
      larguraDaMarca,
      larguraDaFatia: p.empilha
        ? larguraDaMarca
        : Math.max(3, (larguraDaMarca - VAO * (p.nAreas - 1)) / Math.max(p.nAreas, 1)),
    },
  };
}
