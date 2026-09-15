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

// `identityKey` é memoizada por tipo desde 13/09/2026 — eram 118,9 milhões de
// chamadas e 644 mil valores distintos nas 14 páginas, 99,46% de acerto. Cache sobre
// VALOR DE LINHA tem duas formas de mentir, e as duas estão fixadas abaixo.

test('identityKey: DATA é cacheada por instante, não por referência de objeto', () => {
  // A armadilha que decidiu o desenho. Chave de `Map` compara objeto por
  // REFERÊNCIA, então um cache `Map<DaxValue, string>` trataria duas `Date` do
  // mesmo instante como valores diferentes: nunca acertaria no caminho de objetos
  // (uma instância por linha) e cresceria uma entrada POR LINHA. Sem este teste, a
  // volta para o `Map` único passaria na suíte e vazaria só em produção.
  const a = new Date(Date.UTC(2026, 7, 4));
  const b = new Date(Date.UTC(2026, 7, 4));
  assert.notEqual(a, b, "instâncias distintas, de propósito");
  assert.equal(identityKey(a), identityKey(b));

  // E instantes diferentes continuam diferentes — um cache cego devolveria o
  // primeiro para os dois.
  assert.notEqual(identityKey(a), identityKey(new Date(Date.UTC(2026, 7, 5))));
});

test('identityKey: a segunda chamada devolve o mesmo que a primeira, em todo tipo', () => {
  // O erro clássico de memoização — guardar a chave como valor, ou o valor como
  // chave — só aparece a partir da SEGUNDA chamada.
  const casos: unknown[] = ['Canoas', 'CANOAS', '', 'Sem Informação', 0, -0, 1, 1.5,
    NaN, true, false, null, new Date(Date.UTC(2026, 0, 1))];
  for (const v of casos) {
    const um = identityKey(v as never);
    assert.equal(identityKey(v as never), um, `${String(v)} mudou na 2a chamada`);
  }

  // As equivalências que o cache não pode quebrar.
  assert.equal(identityKey('ABC'), identityKey('abc'));
  assert.equal(identityKey(0), identityKey(-0), "0 e -0 são o mesmo valor em DAX");
  assert.notEqual(identityKey('1'), identityKey(1), 'texto e número não podem colidir');
  assert.notEqual(identityKey('n:1'), identityKey(1), 'o prefixo não pode ser forjável por dado');
});

test('identityKey: muito valor distinto não muda a resposta — o teto só para de cachear', () => {
  // O teto existe porque aqui o domínio cresce com o DADO. Passando dele, a função
  // tem de continuar correta; o que ela perde é desempenho, não verdade.
  for (let i = 0; i < 20_000; i++) {
    assert.equal(identityKey(`Valor Sintético ${i}`), `s:valor sintético ${i}`);
    assert.equal(identityKey(i + 0.5), `n:${i + 0.5}`);
  }
  assert.equal(identityKey('ABC'), identityKey('abc'));
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
