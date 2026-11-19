// A geometria da marca (`components/visuais/grafico/geometria.ts`).
//
// A regra que este arquivo trava: **`LARGURA_MAXIMA` é o teto de UMA BARRA, não do
// grupo.** Aplicado ao grupo, duas séries agrupadas dividiam os mesmos 54px e saíam com
// 26 cada — num INSTALADOS POR MÊS de largura cheia, onde cada categoria dispõe de ~200px.
// Além de magras, as colunas perdiam o número: "3.613" pede 33px e era descartado por não
// caber na fatia, com 146px de vão vazio ao lado. Medido no print do Erick, 19/11/2026.

import { expect, test } from 'vitest';
import {
  LARGURA_MAXIMA,
  VAO,
  geometriaDoGrafico,
} from '../src/components/visuais/grafico/geometria.ts';

const geo = (p: { nCategorias: number; larguraDoPlot: number; nAreas: number; empilha: boolean }) =>
  geometriaDoGrafico({
    alturaDaCaixa: 400,
    larguraDoPlot: p.larguraDoPlot,
    nCategorias: p.nCategorias,
    naFaceta: false,
    teto: 4000,
    empilha: p.empilha,
    nAreas: p.nAreas,
    comRotulos: true,
  }).geo;

test('série única não muda: o teto continua sendo uma barra', () => {
  const g = geo({ nCategorias: 12, larguraDoPlot: 2400, nAreas: 1, empilha: false });
  expect(g.larguraDaFatia).toBe(LARGURA_MAXIMA);
});

test('duas séries agrupadas ganham 54px CADA, não 27', () => {
  // INSTALADOS POR MÊS — ANO ATUAL × ANO ANTERIOR, em largura cheia.
  const g = geo({ nCategorias: 12, larguraDoPlot: 2400, nAreas: 2, empilha: false });
  expect(g.larguraDaFatia).toBe(LARGURA_MAXIMA);
  expect(g.larguraDaMarca).toBe(LARGURA_MAXIMA * 2 + VAO);
  // E o número cabe: "3.613" a 10px pede ~33px.
  expect('3.613'.length * 10 * 0.58 + 4).toBeLessThanOrEqual(g.larguraDaFatia + VAO);
});

test('a PILHA não engorda: as fatias se sobrepõem na mesma coluna', () => {
  const g = geo({ nCategorias: 22, larguraDoPlot: 2400, nAreas: 3, empilha: true });
  expect(g.larguraDaMarca).toBe(LARGURA_MAXIMA);
  expect(g.larguraDaFatia).toBe(LARGURA_MAXIMA);
});

test('a banda continua mandando quando ela é o limite', () => {
  // Categoria estreita: 70% da banda, e o teto por barra nem entra na conta.
  const g = geo({ nCategorias: 60, larguraDoPlot: 1200, nAreas: 2, empilha: false });
  expect(g.larguraDaMarca).toBeCloseTo((1200 / 60) * 0.7, 6);
  expect(g.larguraDaFatia).toBeGreaterThanOrEqual(3);
});

test('a marca nunca passa de 70% da categoria — as vizinhas não se encostam', () => {
  for (const nAreas of [1, 2, 3, 4]) {
    for (const nCategorias of [4, 6, 12, 30, 90]) {
      const g = geo({ nCategorias, larguraDoPlot: 2400, nAreas, empilha: false });
      expect(g.larguraDaMarca, `${nAreas} séries, ${nCategorias} categorias`).toBeLessThanOrEqual(
        g.banda * 0.7 + 1e-9,
      );
    }
  }
});
