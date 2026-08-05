// As regras de conversão e comparação do DAX.
//
// Cada teste aqui existe porque a alternativa "natural" em JavaScript dá outra
// resposta — e a diferença aparece como número errado sem erro nenhum.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BLANK,
  DaxEvalError,
  compareValues,
  dateFromSerial,
  identityKey,
  isBlank,
  makeDate,
  serialFromDate,
  toBoolean,
  toNumber,
  toText,
  valuesEqual,
} from '../src/value.ts';

test('BLANK vira 0 em contexto numérico e "" em texto', () => {
  assert.equal(toNumber(BLANK, 'teste'), 0);
  assert.equal(toText(BLANK), '');
  assert.equal(toBoolean(BLANK, 'teste'), false);
  assert.ok(isBlank(null));
  assert.ok(!isBlank(0));
  assert.ok(!isBlank(''));
});

test('texto NÃO vira número, nem quando parece número', () => {
  // Deixar "42" virar 42 abriria a porta para "04/08/2026" virar alguma coisa.
  assert.throws(() => toNumber('42', 'teste'), DaxEvalError);
  assert.throws(() => toNumber('04/08/2026', 'teste'), DaxEvalError);
});

test('`=` trata BLANK como 0 e como "", `==` não', () => {
  assert.ok(valuesEqual(BLANK, 0, false, 't'), 'BLANK = 0 é verdade');
  assert.ok(valuesEqual(BLANK, '', false, 't'), 'BLANK = "" é verdade');
  assert.ok(!valuesEqual(BLANK, 0, true, 't'), 'BLANK == 0 é falso');
  assert.ok(!valuesEqual(BLANK, '', true, 't'), 'BLANK == "" é falso');
  assert.ok(valuesEqual(BLANK, BLANK, true, 't'), 'BLANK == BLANK é verdade');
});

test('comparação de texto ignora caixa — é o collation do Power BI', () => {
  // 'PROTOCOLOS GERAL'[ITEM] == "Sem Informação" casa com "SEM INFORMAÇÃO".
  assert.ok(valuesEqual('Sem Informação', 'SEM INFORMAÇÃO', true, 't'));
  assert.ok(valuesEqual('domingo', 'Domingo', false, 't'));
  assert.equal(identityKey('ABC'), identityKey('abc'));
});

test('comparar texto com número erra alto em vez de inventar ordem', () => {
  assert.throws(() => compareValues('10', 10, false, 't'), DaxEvalError);
  assert.throws(() => compareValues(makeDate(2026, 8, 4), '04/08/2026', false, 't'), DaxEvalError);
});

test('data é número de série: aritmética e comparação funcionam entre as duas', () => {
  const d = makeDate(2026, 8, 4);
  assert.equal(dateFromSerial(serialFromDate(d)).getTime(), d.getTime());
  // O + 7 de `today() + 7` produz número; comparar com data tem de funcionar.
  assert.equal(compareValues(d, serialFromDate(d), false, 't'), 0);
  assert.equal(compareValues(makeDate(2026, 8, 4), makeDate(2026, 8, 11), false, 't'), -1);
  assert.equal(serialFromDate(makeDate(2026, 8, 11)) - serialFromDate(d), 7);
});

test('número vira texto na cultura do modelo — decimal com vírgula', () => {
  // O `&` do DAX formata pela cultura, e o modelo é pt-BR (model.tmdl).
  assert.equal(toText(3), '3');
  assert.equal(toText(3.5), '3,5');
  assert.equal(toText(makeDate(2026, 8, 4)), '04/08/2026');
});

test('ordenar data em texto DD/MM/YYYY ordena por dia — o erro do achado 1', () => {
  // Este teste não cobre código nosso: fixa por escrito por que o avaliador se
  // recusa a comparar texto com data. Se alguém "facilitar" a conversão, cai aqui.
  const datas = ['30/03/2029', '04/01/2030'];
  assert.deepEqual([...datas].sort(), ['04/01/2030', '30/03/2029'], 'sort() põe 2030 antes de 2029');
  const iso = (s: string) => s.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, '$3-$2-$1');
  assert.deepEqual([...datas].sort((a, b) => (iso(a) < iso(b) ? -1 : 1)), datas);
});
