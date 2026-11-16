// A ordenação de tabela — `?ordem=` ordenando a consulta INTEIRA, no servidor (QA D-17).
//
// **O defeito que ela conserta.** O clique no cabeçalho vivia inteiro em `Tabela.tsx` e
// ordenava `d.linhas`: as 200 linhas da janela já baixada. Numa tabela de 95.157 linhas,
// "maior primeiro" reordenava a PÁGINA e deixava o maior valor de verdade em alguma
// janela que ninguém abriu. A tela chegava a avisar ("vale sobre as 200 linhas desta
// fatia") — e um aviso desses é a confissão de que o botão não faz o que diz.
//
// É o mesmo conserto da busca (16/09/2026, `busca-de-tabela.test.ts`), e o que estes
// testes guardam é a mesma coisa: a ORDEM das operações. Ordenar depois de cortar
// continua "funcionando" e responde pela página em vez da tabela.

import assert from 'node:assert/strict';
import test from 'node:test';
import { janelaDe, ordenaLinhas, type Completo } from '../src/calcula.ts';

function tabela(linhas: unknown[][]): Completo {
  return {
    especie: 'tabela',
    colunas: [
      { nome: 'PROTOCOLO', tipo: 'string', chave: true, tabela: 'PROTOCOLOS GERAL', coluna: 'N°PROTOCOLO' },
      { nome: 'QTD', tipo: 'number', chave: false, tabela: null, coluna: null },
    ],
    linhas,
    linhasTotais: linhas.length,
    filtros: [],
  };
}

/** 500 linhas; a MAIOR quantidade mora na linha 380, fora da primeira janela. */
function quinhentasComOMaiorLonge(): Completo {
  const linhas: unknown[][] = [];
  for (let i = 0; i < 500; i++) linhas.push([`90${String(i).padStart(4, '0')}`, i === 380 ? 9999 : i]);
  return tabela(linhas);
}

test('ordenaLinhas: números por valor, texto por texto, e nulo sempre no fim', () => {
  assert.deepEqual(ordenaLinhas([[2], [1], [3]], 0, false), [[1], [2], [3]]);
  assert.deepEqual(ordenaLinhas([[2], [1], [3]], 0, true), [[3], [2], [1]]);
  // Nulo não é "o menor": é ausência, e ausência vai para o fim nas DUAS direções.
  assert.deepEqual(ordenaLinhas([[2], [null], [1]], 0, false), [[1], [2], [null]]);
  assert.deepEqual(ordenaLinhas([[2], [null], [1]], 0, true), [[2], [1], [null]]);
  // Texto compara em minúsculas, como a tela.
  assert.deepEqual(ordenaLinhas([['b'], ['A'], ['c']], 0, false), [['A'], ['b'], ['c']]);
  // Data chega serializada em ISO, que ordena como texto — é por isso que não há ramo
  // de Date aqui, e é a mesma forma que a tela compara.
  assert.deepEqual(
    ordenaLinhas([['2026-11-16'], ['2026-01-02'], ['2026-03-04']], 0, true),
    [['2026-11-16'], ['2026-03-04'], ['2026-01-02']],
  );
});

test('janelaDe: ORDENA E DEPOIS CORTA — o maior valor aparece na primeira janela', () => {
  // Este é o teste inteiro. Cortando primeiro, o 9999 ficaria na janela 2 e a primeira
  // página de "maior primeiro" mostraria 199 como maior — número errado e plausível.
  const r = janelaDe(quinhentasComOMaiorLonge(), {
    de: 0,
    linhas: 200,
    ordem: { coluna: 1, desc: true },
  }) as { linhas: unknown[][]; linhasTotais: number };
  assert.equal(r.linhas[0]![1], 9999);
  assert.equal(r.linhasTotais, 500, 'ordenar não tira nem acrescenta linha');
});

test('janelaDe: sem ordem, a ordem natural do visual sobrevive', () => {
  const r = janelaDe(quinhentasComOMaiorLonge(), { de: 0, linhas: 3 }) as { linhas: unknown[][] };
  assert.deepEqual(
    r.linhas.map((l) => l[1]),
    [0, 1, 2],
  );
});

test('janelaDe: busca e ordem valem juntas, e as duas antes do corte', () => {
  const linhas: unknown[][] = [];
  for (let i = 0; i < 300; i++) linhas.push([`CASCAVEL-${i}`, i]);
  for (let i = 0; i < 300; i++) linhas.push([`TOLEDO-${i}`, 1000 + i]);
  const r = janelaDe(tabela(linhas), {
    de: 0,
    linhas: 10,
    termo: 'toledo',
    ordem: { coluna: 1, desc: true },
  }) as { linhas: unknown[][]; linhasTotais: number; totalSemBusca: number };
  assert.equal(r.linhasTotais, 300, 'o total é o do que a busca achou');
  assert.equal(r.totalSemBusca, 600);
  assert.equal(r.linhas[0]![1], 1299, 'a maior ENTRE AS ACHADAS, não a maior da tabela');
});

test('a janela de dentro continua sendo a mesma linha da ordem global', () => {
  // Paginar dentro de um resultado ordenado: a linha 200 da ordem global é a 200 da
  // ordenada, não a 200 da ordem natural ordenada depois.
  const c = quinhentasComOMaiorLonge();
  const inteira = janelaDe(c, { de: 0, linhas: 500, ordem: { coluna: 1, desc: true } }) as {
    linhas: unknown[][];
  };
  const segunda = janelaDe(c, { de: 200, linhas: 200, ordem: { coluna: 1, desc: true } }) as {
    linhas: unknown[][];
  };
  assert.deepEqual(segunda.linhas[0], inteira.linhas[200]);
});

test('coluna fora da tabela ERRA ALTO, em vez de inventar uma ordem', () => {
  assert.throws(
    () => janelaDe(quinhentasComOMaiorLonge(), { de: 0, linhas: 10, ordem: { coluna: 7, desc: false } }),
    /ordem= pede a coluna 7, e esta tabela tem 2/,
  );
});
