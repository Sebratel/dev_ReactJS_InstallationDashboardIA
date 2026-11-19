// ONDE O NÚMERO DO GRÁFICO É ESCRITO (`src/utils/graficoRotulos.ts`, 19/11/2026).
//
// Cada teste aqui corresponde a uma das portas que a regra antiga fechava em silêncio —
// gráfico só de linha, coluna agrupada e 100% empilhado saíam sem número nenhum, e os
// gestores tiram print da tela. Um rótulo que não aparece não quebra nada: é por isso que
// a regra virou função pura e ganhou teste.

import { expect, test } from 'vitest';
import {
  MAXIMO_COM_ROTULO,
  modoDeRotulo,
  precisaDeMargemParaRotulo,
  rotulaTodosOsPontos,
  type FormaDoGrafico,
} from '../src/utils/graficoRotulos.ts';

const forma = (p: Partial<FormaDoGrafico>): FormaDoGrafico => ({
  nAreas: 1,
  nLinhas: 0,
  empilha: false,
  percentual: false,
  nCategorias: 12,
  naFaceta: false,
  ...p,
});

test('série única de coluna leva o chip por categoria — o que já funcionava continua', () => {
  expect(modoDeRotulo(forma({ nAreas: 1 }))).toBe('categoria');
});

test('pilha leva o chip do TOTAL por categoria', () => {
  expect(modoDeRotulo(forma({ nAreas: 3, empilha: true }))).toBe('categoria');
});

test('porta 1: coluna AGRUPADA passa a rotular cada fatia, não o total', () => {
  // Era 'nenhum': `areas.length === 1 || empilha` barrava. Um total somado de 2 séries
  // lado a lado não é número de ninguém — o número tem de ser o da fatia.
  expect(modoDeRotulo(forma({ nAreas: 2, empilha: false }))).toBe('fatia');
});

test('porta 2: 100% empilhado escreve a parte DENTRO da fatia', () => {
  // Era 'nenhum' por `!percentual`. O total da pilha é sempre 100% e não informa nada.
  expect(modoDeRotulo(forma({ nAreas: 2, empilha: true, percentual: true }))).toBe('dentro');
});

test('porta 3: gráfico só de LINHA rotula todo ponto, com uma série só', () => {
  const soLinha = forma({ nAreas: 0, nLinhas: 1 });
  expect(modoDeRotulo(soLinha)).toBe('nenhum'); // não há coluna para rotular
  expect(rotulaTodosOsPontos(soLinha)).toBe(true);
});

test('duas linhas continuam só com o pico: ponto a ponto elas se cruzam', () => {
  expect(rotulaTodosOsPontos(forma({ nAreas: 0, nLinhas: 2 }))).toBe(false);
});

test('linha por cima de coluna continua só com o pico', () => {
  // O combo (AGENDA + CAPACIDADE) já tem o número das colunas; dois conjuntos de número
  // disputando a mesma altura é o que a regra antiga evitava, e isso se mantém.
  expect(rotulaTodosOsPontos(forma({ nAreas: 2, nLinhas: 1, empilha: true }))).toBe(false);
});

test('na faceta a linha tem painel próprio — o pico continua sendo a leitura', () => {
  expect(rotulaTodosOsPontos(forma({ nAreas: 0, nLinhas: 1, naFaceta: true }))).toBe(false);
});

test('acima do teto de categorias nenhum modo liga', () => {
  const demais = { nCategorias: MAXIMO_COM_ROTULO + 1 };
  expect(modoDeRotulo(forma({ ...demais, nAreas: 1 }))).toBe('nenhum');
  expect(modoDeRotulo(forma({ ...demais, nAreas: 2 }))).toBe('nenhum');
  expect(modoDeRotulo(forma({ ...demais, nAreas: 2, percentual: true, empilha: true }))).toBe(
    'nenhum',
  );
  expect(rotulaTodosOsPontos(forma({ ...demais, nAreas: 0, nLinhas: 1 }))).toBe(false);
});

test('no teto exato ainda liga — o corte é "acima de", não "a partir de"', () => {
  expect(modoDeRotulo(forma({ nCategorias: MAXIMO_COM_ROTULO }))).toBe('categoria');
});

test('janela vazia não rotula nada', () => {
  expect(modoDeRotulo(forma({ nCategorias: 0 }))).toBe('nenhum');
});

test('só quem escreve ACIMA da marca cobra margem do plot', () => {
  // A altura é o recurso escasso da tela: `dentro` escreve na fatia e não pode cobrar os
  // 12px a mais que `geometria.ts` reserva (14 → 26).
  expect(precisaDeMargemParaRotulo(forma({ nAreas: 1 }))).toBe(true);
  expect(precisaDeMargemParaRotulo(forma({ nAreas: 2 }))).toBe(true);
  expect(precisaDeMargemParaRotulo(forma({ nAreas: 0, nLinhas: 1 }))).toBe(true);
  expect(precisaDeMargemParaRotulo(forma({ nAreas: 2, empilha: true, percentual: true }))).toBe(
    false,
  );
  expect(precisaDeMargemParaRotulo(forma({ nAreas: 0, nLinhas: 2 }))).toBe(false);
});
