// As contas do eixo do gráfico, que saíram de `Grafico.tsx` na fase 4. Um rótulo de
// eixo errado não quebra nada: só mostra vinte colunas com o mesmo texto.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  caminhoDaSerie,
  maiorIndice,
  orcamentoDoRotulo,
  passoDoEixo,
  prefixoComum,
  rotuloDoEixo,
} from '../src/utils/graficoEixo.ts';

test('o prefixo comum é o que se repete em TODAS as categorias, e sempre sobra um nível', () => {
  const partes = [
    ['2026', 'julho', '1'],
    ['2026', 'julho', '2'],
    ['2026', 'agosto', '1'],
  ];
  assert.equal(prefixoComum(partes), 1);
  assert.equal(
    prefixoComum([
      ['2026', 'julho'],
      ['2026', 'julho'],
    ]),
    1,
  );
  assert.equal(prefixoComum([['Canoas']]), 0);
  assert.equal(prefixoComum([]), 0);
});

test('o rótulo vem do nível mais específico para trás, e nunca come o dia', () => {
  // O defeito antigo: cortar pelo começo devolvia "2026 / julho /…" em toda coluna.
  assert.equal(rotuloDoEixo(['2026', 'julho', '15'], '2026 / julho / 15', 10), 'julho/15');
  assert.equal(rotuloDoEixo(['2026', 'julho', '15'], '2026 / julho / 15', 20), '2026/julho/15');
  assert.equal(rotuloDoEixo(['julho', '15'], 'x', 4), '15');
  // Um nível longo sozinho corta no fim.
  assert.equal(rotuloDoEixo(['Equipe Field Service'], 'x', 8), 'Equipe …');
  // Sem partes, o rótulo inteiro.
  assert.equal(rotuloDoEixo([], 'Canoas', 10), 'Canoas');
});

test('o passo do eixo afina com a banda', () => {
  assert.equal(passoDoEixo(24), 3);
  assert.equal(passoDoEixo(40), 2);
  assert.equal(passoDoEixo(64), 1);
});

test('o orçamento do rótulo respeita a largura E a altura', () => {
  // Poucas categorias: a banda larga liberaria o rótulo inteiro, e é a altura que limita.
  // Medido em 27/08/2026: sem a conta da altura, o rótulo descia 66px além da caixa.
  assert.equal(orcamentoDoRotulo(330, 1, 64), Math.floor((64 - 22) / (5.6 * 0.71)));
  // Muitas categorias: a largura limita.
  assert.equal(orcamentoDoRotulo(24, 3, 200), Math.floor((24 * 3) / 0.71 / 5.6));
  // Nunca abaixo de 4.
  assert.equal(orcamentoDoRotulo(5, 1, 20), 4);
});

test('o caminho da série é interrompido pelo nulo', () => {
  const x = (i: number) => i * 10;
  const y = (v: number) => 100 - v;
  assert.equal(caminhoDaSerie([1, 2, null, 4], x, y), 'M0.0 99.0 L10.0 98.0 M30.0 96.0');
  assert.equal(caminhoDaSerie([null, null], x, y), '');
});

test('o maior índice ignora nulo e fica com o primeiro no empate', () => {
  assert.equal(maiorIndice([3, null, 7, 7, 1]), 2);
  assert.equal(maiorIndice([null, null]), null);
  assert.equal(maiorIndice([]), null);
});
