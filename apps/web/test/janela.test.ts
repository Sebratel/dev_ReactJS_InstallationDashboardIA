// A aritmética da janela de linhas.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  anteriorDe,
  LINHAS_POR_JANELA,
  podeAvancar,
  podeVoltar,
  proximoDe,
  rotuloDaJanela,
  type Janela,
} from '../src/janela.ts';
import { urlDaPagina } from '../src/api.ts';

const cru = (n: number) => String(n);

/**
 * **A regra que evita a janela vazia.**
 *
 * `podeAvancar` usa `de + mostradas`, não `de + LINHAS_POR_JANELA`. Numa última janela
 * curta as duas contas divergem, e a segunda ofereceria um "próxima" que devolve zero
 * linhas — um botão que existe para não levar a lugar nenhum.
 */
test('na última janela curta não há próxima', () => {
  const j: Janela = { de: 200, mostradas: 43, total: 243 };
  assert.equal(podeAvancar(j), false);
  assert.equal(podeVoltar(j), true);
});

test('na primeira janela cheia há próxima e não há anterior', () => {
  const j: Janela = { de: 0, mostradas: 200, total: 32462 };
  assert.equal(podeAvancar(j), true);
  assert.equal(podeVoltar(j), false);
  assert.equal(proximoDe(j), 200);
});

test('tabela que cabe inteira não navega para lado nenhum', () => {
  const j: Janela = { de: 0, mostradas: 43, total: 43 };
  assert.equal(podeAvancar(j), false);
  assert.equal(podeVoltar(j), false);
});

test('tabela vazia não navega e diz que está vazia', () => {
  const j: Janela = { de: 0, mostradas: 0, total: 0 };
  assert.equal(podeAvancar(j), false);
  assert.equal(rotuloDaJanela(j, cru), 'nenhuma linha');
});

test('proximoDe não passa do fim quando não há próxima', () => {
  const j: Janela = { de: 200, mostradas: 43, total: 243 };
  assert.equal(proximoDe(j), 200, 'sem avanço, o de fica onde está');
});

test('anteriorDe nunca fica negativo', () => {
  assert.equal(anteriorDe({ de: 0, mostradas: 200, total: 1000 }), 0);
  assert.equal(anteriorDe({ de: 100, mostradas: 100, total: 1000 }), 0);
  assert.equal(anteriorDe({ de: 400, mostradas: 200, total: 1000 }), 400 - LINHAS_POR_JANELA);
});

/** O rótulo conta em base 1, que é como uma pessoa conta linha. */
test('o rótulo mostra o intervalo em base 1', () => {
  assert.equal(rotuloDaJanela({ de: 0, mostradas: 200, total: 32462 }, cru), '1–200 de 32462 linhas');
  assert.equal(rotuloDaJanela({ de: 200, mostradas: 200, total: 32462 }, cru), '201–400 de 32462 linhas');
  assert.equal(rotuloDaJanela({ de: 32400, mostradas: 62, total: 32462 }, cru), '32401–32462 de 32462 linhas');
});

test('tabela inteira mostra só o total, sem intervalo', () => {
  assert.equal(rotuloDaJanela({ de: 0, mostradas: 43, total: 43 }, cru), '43 linhas');
});

/**
 * A janela vai no pedido de **um visual**, não da página. O `?de=` da rota vale para a
 * página inteira: sem `visual=`, clicar em "próxima" numa tabela moveria todas as
 * outras junto.
 */
test('o pedido de janela isola o visual', () => {
  const u = urlDaPagina('protocolos-detalhados', [], { visual: 'abc', de: 400, linhas: 200 });
  assert.match(u, /visual=abc/);
  assert.match(u, /de=400/);
  assert.match(u, /linhas=200/);
});

/** `de=0` é o padrão da API; mandá-lo sujaria toda URL de primeira janela. */
test('de=0 não vira parâmetro', () => {
  assert.doesNotMatch(urlDaPagina('p', [], { visual: 'x', de: 0 }), /de=/);
});
