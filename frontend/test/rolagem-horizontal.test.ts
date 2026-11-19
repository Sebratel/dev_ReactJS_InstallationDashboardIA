import assert from 'node:assert/strict';
import { test } from 'vitest';
import { calculaBordas, passoDeRolagem } from '../src/hooks/useRolagemHorizontal.ts';

test('faixa que cabe inteira não mostra seta nenhuma', () => {
  assert.deepEqual(calculaBordas(0, 1200, 1200), { esquerda: false, direita: false });
});

test('no começo de uma faixa que transborda, só a seta da direita', () => {
  // É o caso da captura de 19/11/2026: 1366px de tela, ~1.600px de abas.
  assert.deepEqual(calculaBordas(0, 1366, 1600), { esquerda: false, direita: true });
});

test('no fim da rolagem, só a seta da esquerda — nunca uma apontando para o vazio', () => {
  assert.deepEqual(calculaBordas(234, 1366, 1600), { esquerda: true, direita: false });
});

test('no meio, as duas', () => {
  assert.deepEqual(calculaBordas(100, 1366, 1600), { esquerda: true, direita: true });
});

test('meio pixel de sobra não é aba escondida', () => {
  // Zoom de 110%/125% (a operação usa) faz `scrollWidth` e `clientWidth` saírem de
  // arredondamentos diferentes. Sem a folga, a seta da direita aparecia em tela cheia.
  assert.equal(calculaBordas(0, 1366, 1366.5).direita, false);
  assert.equal(calculaBordas(0.5, 1366, 1366).esquerda, false);
});

test('o passo anda quase uma tela, com piso para o clique valer a pena', () => {
  assert.equal(passoDeRolagem(1366), 1025);
  assert.equal(passoDeRolagem(100), 120);
});
