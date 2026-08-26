// A transição de contexto declara a igualdade que ela implica, para o índice de
// igualdade poder pegar o caminho. Estes testes provam que isso **não muda número**.
//
// Por que eles têm de ser grandes: `MINIMO_PARA_INDEXAR` é 1.000 linhas. Abaixo
// disso o índice se recusa a existir, e um teste de 10 linhas passaria verde sem
// nunca ter exercitado o caminho que se quer provar. Foi exatamente assim que o
// ACHADOS #50 escapou — só aparecia contra a base real.
//
// O padrão sob teste é o que custava 32,6 s num visual só:
//
//     AVERAGEX( VALUES('T'[C]), CALCULATE( DISTINCTCOUNT('T'[P]) ) )
//
// Só `AVERAGEX` e `RANKX` iteram neste avaliador — ele implementa o que as 121
// expressões da base usam, e `SUMX`/`SUMMARIZE` não estão entre elas. A propriedade
// de partição é afirmada por `grupos × média`, que dá no mesmo com grupos de tamanho
// igual, e é por isso que os dados abaixo são construídos uniformes.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn } from '../../semantic-model/src/types.ts';
import { Dataset, type Row } from '../src/dataset.ts';
import { Evaluator } from '../src/evaluator.ts';
import { MINIMO_PARA_INDEXAR } from '../src/indice.ts';

const AGORA = new Date('2026-08-11T12:00:00Z');

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

/**
 * Avaliador sobre uma tabela só. Sem relacionamento de propósito: o que está em
 * teste é a transição de contexto sobre a própria tabela.
 */
function avaliadorDe(colunas: readonly ModelColumn[], rows: readonly Row[]): Evaluator {
  const model = new SemanticModel();
  model.addTable({ id: 't', name: 'T', queryRef: null, columns: [...colunas] });
  const dataset = new Dataset();
  dataset.addTable('T', rows as Row[]);
  return new Evaluator({ model, dataset, now: AGORA });
}

/** Linhas o bastante para o índice ligar, com repetição controlada. */
function linhas(n: number, fabrica: (i: number) => Row): Row[] {
  return Array.from({ length: n }, (_, i) => fabrica(i));
}

const N = MINIMO_PARA_INDEXAR * 3; // 3.000 — bem acima do limiar

/**
 * A propriedade que pega um balde furado: agrupar por uma coluna **particiona** a
 * tabela. Se o índice devolvesse um balde a menos, a contagem por grupo cairia — e
 * cairia num número plausível, sem erro nenhum. Com grupos de tamanho igual,
 * `grupos × linhas por grupo` tem de dar exatamente o total.
 */
function afirmaParticao(ev: Evaluator, coluna: string, gruposEsperados: number): void {
  const grupos = ev.evaluateExpression(`COUNTROWS( VALUES('T'[${coluna}]) )`);
  assert.equal(grupos, gruposEsperados, `grupos distintos de ${coluna}`);
  const porGrupo = ev.evaluateExpression(
    `AVERAGEX( VALUES('T'[${coluna}]), CALCULATE( COUNTROWS('T') ) )`,
  );
  assert.equal(porGrupo, N / gruposEsperados, `linhas por grupo de ${coluna}`);
  assert.equal(
    (grupos as number) * (porGrupo as number),
    N,
    `agrupar por ${coluna} tem de particionar a tabela`,
  );
}

test('AVERAGEX(VALUES(c), CALCULATE(DISTINCTCOUNT(p))) — o caso que estava caro', () => {
  // 30 datas × 100 linhas cada; cada data tem 50 protocolos distintos.
  const rows = linhas(N, (i) => ({
    data: new Date(Date.UTC(2026, 0, 1 + (i % 30))),
    protocolo: `P${Math.trunc(i / 30) % 50}`,
  }));
  const ev = avaliadorDe([col('data', { type: 'dateTime' }), col('protocolo')], rows);

  assert.equal(
    ev.evaluateExpression("AVERAGEX( VALUES('T'[data]), CALCULATE( DISTINCTCOUNT('T'[protocolo]) ) )"),
    50,
  );
  afirmaParticao(ev, 'data', 30);
});

test('texto com caixa diferente é o MESMO grupo — índice e `=` têm de concordar', () => {
  // `=` do DAX compara texto sem caixa, e `identityKey` também. Se divergissem, o
  // balde perderia linha que o `keep` aceita — a falha silenciosa que este arquivo
  // existe para impedir.
  const rows = linhas(N, (i) => ({
    chave: i % 2 === 0 ? 'grupo' : 'GRUPO',
    protocolo: `P${i % 2}`,
  }));
  const ev = avaliadorDe([col('chave'), col('protocolo')], rows);

  afirmaParticao(ev, 'chave', 1);
  assert.equal(
    ev.evaluateExpression("AVERAGEX( VALUES('T'[chave]), CALCULATE( DISTINCTCOUNT('T'[protocolo]) ) )"),
    2,
    'um grupo só, com os dois protocolos dentro',
  );
});

test('coluna com BLANK: o índice recusa e a varredura decide — mesmo número', () => {
  // BLANK é uma das bordas onde `candidatos()` devolve "varra" (BLANK = 0 e
  // BLANK = "" são verdadeiros no DAX). O resultado não pode depender disso.
  const rows = linhas(N, (i) => ({ chave: i % 3 === 0 ? null : `K${i % 3}`, valor: i % 7 }));
  const ev = avaliadorDe([col('chave'), col('valor', { type: 'int64' })], rows);
  afirmaParticao(ev, 'chave', 3);
});

test('zero, vazio e branco na mesma coluna — as outras bordas da coerção', () => {
  const rows = linhas(N, (i) => ({
    chave: i % 4 === 0 ? 0 : i % 4 === 1 ? '' : i % 4 === 2 ? null : 'x',
    n: 1,
  }));
  const ev = avaliadorDe([col('chave'), col('n', { type: 'int64' })], rows);

  // Quantos grupos o DAX vê aqui é decisão de `identityKey`, e não é o que está sob
  // teste. O que está sob teste é que os grupos **particionam**: qualquer que seja o
  // número deles, grupos × linhas por grupo tem de dar o total.
  const grupos = ev.evaluateExpression("COUNTROWS( VALUES('T'[chave]) )") as number;
  const porGrupo = ev.evaluateExpression(
    "AVERAGEX( VALUES('T'[chave]), CALCULATE( SUM('T'[n]) ) )",
  ) as number;
  assert.equal(grupos * porGrupo, N, 'nada some e nada duplica entre os grupos');
});

test('transição de VÁRIAS colunas continua correta (ali não se declara igualdade)', () => {
  // Iterar a tabela inteira põe todas as colunas no contexto de linha, e
  // `igualdadeDaTransicao` devolve `undefined` de propósito. O número não pode
  // mudar por causa disso.
  //
  // `b = i % 5` é determinado por `a = i % 10`, então há 10 combinações de
  // (a, b), cada uma com 300 linhas. `n` é sempre 1 e não restringe nada.
  const rows = linhas(N, (i) => ({ a: i % 10, b: i % 5, n: 1 }));
  const ev = avaliadorDe(
    [col('a', { type: 'int64' }), col('b', { type: 'int64' }), col('n', { type: 'int64' })],
    rows,
  );
  assert.equal(ev.evaluateExpression("AVERAGEX( 'T', CALCULATE( COUNTROWS('T') ) )"), N / 10);
});

test('DISTINCTCOUNT por grupo: um balde furado apareceria aqui', () => {
  // Protocolo único por linha, 25 grupos de 120. Se um balde perdesse linha, a
  // média cairia abaixo de 120 — plausivelmente, e sem erro.
  const rows = linhas(N, (i) => ({ grupo: `G${i % 25}`, protocolo: `P${i}` }));
  const ev = avaliadorDe([col('grupo'), col('protocolo')], rows);

  assert.equal(
    ev.evaluateExpression("AVERAGEX( VALUES('T'[grupo]), CALCULATE( DISTINCTCOUNT('T'[protocolo]) ) )"),
    N / 25,
  );
  afirmaParticao(ev, 'grupo', 25);
});

test('data com hora como chave — o tipo exato do caso real', () => {
  // `Média Diária` agrupa por `[Data]`. `identityKey` codifica data pelo serial e
  // `compareValues` também; se divergissem, os baldes errariam.
  const rows = linhas(N, (i) => ({
    d: new Date(Date.UTC(2026, 0, 1 + (i % 40), 10, 30, 0)),
    n: 1,
  }));
  const ev = avaliadorDe([col('d', { type: 'dateTime' }), col('n', { type: 'int64' })], rows);
  afirmaParticao(ev, 'd', 40);
});
