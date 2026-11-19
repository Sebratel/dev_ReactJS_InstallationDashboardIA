// As marcas do eixo Y (`src/utils/graficoForma.ts`).
//
// A regra que este arquivo existe para travar é uma só: **a última marca cobre o teto**.
// `Grafico.tsx` usa `Math.max(...marcas)` como topo da escala, então marca que para antes
// do maior valor não encolhe a coluna — manda ela para fora do plot, onde o
// `overflow: hidden` da caixa corta tudo sem erro nenhum, inclusive o número dela.
//
// Medido em 19/11/2026 nos prints do Erick: PROTOCOLOS REALIZADOS (teto 165) desenhava o
// eixo até 150, e PROTOCOLOS GERADOS (teto ~240) até 200. O sintoma visível era o oposto
// da causa — "a coluna mais alta é a única sem número".

import { expect, test } from 'vitest';
import { marcasDoEixo } from '../src/utils/graficoForma.ts';

const topo = (teto: number, quantas?: number) => Math.max(...marcasDoEixo(teto, quantas));

test('a última marca SEMPRE cobre o teto', () => {
  // Os três casos vistos na tela, e que falhavam.
  expect(topo(165)).toBeGreaterThanOrEqual(165);
  expect(topo(213)).toBeGreaterThanOrEqual(213);
  expect(topo(240)).toBeGreaterThanOrEqual(240);
  // E uma varredura — nenhum teto pode sobrar para fora da escala.
  for (let teto = 1; teto <= 2000; teto += 1) {
    expect(topo(teto), `teto ${teto}`).toBeGreaterThanOrEqual(teto);
  }
});

test('o teto exato não gera uma marca a mais', () => {
  // 200 com passo 50 fecha em 200; arredondar por ponto flutuante daria 250 e uma faixa
  // inteira de espaço morto no alto de todo gráfico redondo.
  expect(marcasDoEixo(200)).toEqual([0, 50, 100, 150, 200]);
  expect(marcasDoEixo(100)).toEqual([0, 25, 50, 75, 100]);
  expect(marcasDoEixo(1000)).toEqual([0, 250, 500, 750, 1000]);
});

test('as marcas começam em zero, sobem com passo constante e são redondas', () => {
  for (const teto of [37, 92, 165, 213, 240, 7, 3333]) {
    const m = marcasDoEixo(teto);
    expect(m[0]).toBe(0);
    const passo = m[1]! - m[0]!;
    m.forEach((v, i) => expect(v).toBeCloseTo(passo * i, 6));
    // Passo redondo: 1, 2, 2,5, 5 ou 10 vezes uma potência de dez.
    const grandeza = 10 ** Math.floor(Math.log10(passo));
    expect([1, 2, 2.5, 5, 10].map((x) => x * grandeza)).toContain(passo);
  }
});

test('teto inválido ou não positivo devolve só o zero', () => {
  expect(marcasDoEixo(0)).toEqual([0]);
  expect(marcasDoEixo(-5)).toEqual([0]);
  expect(marcasDoEixo(Number.NaN)).toEqual([0]);
  expect(marcasDoEixo(Number.POSITIVE_INFINITY)).toEqual([0]);
});

test('a faceta pede duas faixas e continua cobrindo o teto', () => {
  // `FacetaDeLinha` chama com `quantas = 2`.
  expect(topo(165, 2)).toBeGreaterThanOrEqual(165);
  expect(topo(37, 2)).toBeGreaterThanOrEqual(37);
});
