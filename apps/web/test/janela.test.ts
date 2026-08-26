// A aritmética da janela de linhas.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  anteriorDe,
  janelaDeServidorPara,
  LINHAS_POR_JANELA,
  LINHAS_VISIVEIS,
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

/* ==========================================================================
   AS DUAS JANELAS EMPILHADAS

   `LINHAS_POR_JANELA` (200) é o que o servidor manda; `LINHAS_VISIVEIS` (20) é o
   que a tela desenha. `janelaDeServidorPara` é a costura entre as duas.
   ========================================================================== */

test('a janela visível é menor que a do servidor, e cabe um número inteiro de vezes', () => {
  assert.ok(LINHAS_VISIVEIS < LINHAS_POR_JANELA);
  assert.equal(
    LINHAS_POR_JANELA % LINHAS_VISIVEIS,
    0,
    'se não couber inteiro, a última página de uma fatia fica curta sem ser o fim dos dados',
  );
});

test('janelaDeServidorPara alinha em múltiplos, que é o que mantém o cache útil', () => {
  assert.equal(janelaDeServidorPara(0), 0);
  assert.equal(janelaDeServidorPara(19), 0);
  assert.equal(janelaDeServidorPara(199), 0);
  assert.equal(janelaDeServidorPara(200), 200, 'a borda pertence à fatia seguinte');
  assert.equal(janelaDeServidorPara(201), 200);
  assert.equal(janelaDeServidorPara(32461), 32400);
});

test('janelaDeServidorPara não devolve negativo', () => {
  assert.equal(janelaDeServidorPara(-1), 0);
  assert.equal(janelaDeServidorPara(-999), 0);
});

/**
 * Andar 20 a 20 dentro de uma fatia de 200 dá dez páginas ANTES de buscar de novo.
 * É esse o ganho: a tela encurta 10x e o número de requisições não muda.
 */
test('dez páginas de 20 cabem numa fatia de 200 sem nova busca', () => {
  const inicioDaFatia = 400;
  const linhas: number[] = [];
  for (let p = 0; p < LINHAS_POR_JANELA / LINHAS_VISIVEIS; p += 1) {
    linhas.push(inicioDaFatia + p * LINHAS_VISIVEIS);
  }
  assert.equal(linhas.length, 10);
  for (const l of linhas) {
    assert.equal(janelaDeServidorPara(l), inicioDaFatia, `a linha ${l} ainda está na fatia`);
  }
  // a 11ª página sai da fatia e aí sim busca
  assert.equal(janelaDeServidorPara(inicioDaFatia + 10 * LINHAS_VISIVEIS), 600);
});

/** O passo do "anterior" é o da janela que está sendo navegada, não sempre 200. */
test('anteriorDe respeita o passo de quem chama', () => {
  const j: Janela = { de: 60, mostradas: 20, total: 1000 };
  assert.equal(anteriorDe(j, LINHAS_VISIVEIS), 40, 'a tabela anda de 20 em 20');
  assert.equal(anteriorDe(j), 0, 'sem passo, continua o padrão de 200 da matriz');
});

test('anteriorDe com passo nunca fica negativo', () => {
  assert.equal(anteriorDe({ de: 10, mostradas: 10, total: 1000 }, LINHAS_VISIVEIS), 0);
});

/**
 * A armadilha que o `passo` evita: voltar por `mostradas` numa última página curta.
 * Com 3 linhas na tela, "anterior" andaria 3 e a pessoa veria 17 repetidas.
 */
test('a última página curta volta uma página inteira, não o tamanho dela', () => {
  const ultima: Janela = { de: 243, mostradas: 3, total: 246 };
  assert.equal(anteriorDe(ultima, LINHAS_VISIVEIS), 223);
  assert.notEqual(anteriorDe(ultima, LINHAS_VISIVEIS), ultima.de - ultima.mostradas);
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
