// A vista tem de ser indistinguível de um objeto simples para o avaliador — e os
// testes aqui são escolhidos pelos pontos onde ela PODERIA divergir em silêncio.
//
// Os três que importam: `in` falso para coluna calculada não memoizada (achado
// #50), `Object.keys`/espalhamento enxergando só propriedade própria, e o índice
// da linha não podendo aparecer como coluna.

import assert from 'node:assert/strict';
import test from 'node:test';

import { colunasDe, copiaLinha, type Row } from '../../measure-engine/src/dataset.ts';
import { VistaDeLinhas, indiceDaVista } from '../src/linha-vista.ts';
import { ConstrutorDeTabela, type TabelaColunar } from '../src/tabela-colunar.ts';

const QUANDO = new Date('2026-03-04T00:00:00.000Z');

/** Uma tabela pequena com um valor de cada tipo, e repetição para o dicionário. */
function tabela(): TabelaColunar {
  const c = new ConstrutorDeTabela('T', ['cidade', 'n', 'ok', 'quando', 'vazio'], 3);
  c.poeLinha(['Canoas', 1, true, QUANDO, null]);
  c.poeLinha(['Canoas', 2, false, null, null]);
  c.poeLinha(['Esteio', 1, true, QUANDO, null]);
  return c.fecha();
}

test('a vista lê valor e TIPO como o objeto leria', () => {
  const v = new VistaDeLinhas(tabela());
  const r = v.linha(0);
  assert.equal(r['cidade'], 'Canoas');
  assert.equal(r['n'], 1);
  assert.equal(r['ok'], true);
  assert.ok(r['quando'] instanceof Date);
  assert.equal((r['quando'] as Date).getTime(), QUANDO.getTime());
  assert.equal(r['vazio'], null);

  assert.equal(v.linha(1)['ok'], false, 'false não pode virar nulo');
  assert.equal(v.linha(1)['quando'], null);
  assert.equal(v.linha(2)['cidade'], 'Esteio');
});

test('`in` é verdadeiro para coluna física e FALSO para o resto — é o achado #50', () => {
  const r = new VistaDeLinhas(tabela()).linha(0);
  assert.ok('cidade' in r);
  assert.ok('vazio' in r, 'coluna que só tem nulo EXISTE — nulo não é ausência');
  assert.ok(!('calculada' in r), 'coluna calculada ainda não memoizada tem de ser ausente');
  assert.ok(!('inexistente' in r));
});

test('memoizar coluna calculada na linha funciona, e só aí ela passa a existir', () => {
  const r = new VistaDeLinhas(tabela()).linha(0) as Row;
  assert.ok(!('dobro' in r));
  r['dobro'] = 2;
  assert.ok('dobro' in r);
  assert.equal(r['dobro'], 2);
  assert.deepEqual(Object.keys(r), ['dobro'], 'a memoizada é propriedade PRÓPRIA');
});

test('escrever em coluna FÍSICA erra alto, em vez de sombrear o armazenamento', () => {
  const r = new VistaDeLinhas(tabela()).linha(0) as Row;
  assert.throws(() => {
    r['cidade'] = 'Sapucaia';
  }, /coluna FÍSICA.*vista sobre o armazenamento colunar/s);
  assert.equal(r['cidade'], 'Canoas', 'e o valor continua o do armazenamento');
});

test('`for...in` lista as colunas e NÃO o índice da linha', () => {
  const r = new VistaDeLinhas(tabela()).linha(1);
  const vistos: string[] = [];
  for (const c in r) vistos.push(c);
  assert.deepEqual(vistos.sort(), ['cidade', 'n', 'ok', 'quando', 'vazio']);

  // É o `for...in` de `Dataset.adotaTabela` que decide quais colunas são físicas.
  // Um índice enumerável viraria coluna fantasma ali, sem erro nenhum.
  assert.ok(!vistos.includes('i'));
  assert.equal(Object.getOwnPropertySymbols(r).length, 1, 'o índice existe, como símbolo');
  assert.equal(indiceDaVista(r), 1);
  assert.equal(indiceDaVista({ cidade: 'x' }), null, 'objeto simples não tem índice');
});

test('a armadilha documentada: `Object.keys` e espalhamento veem a vista VAZIA', () => {
  const r = new VistaDeLinhas(tabela()).linha(0) as Row;

  // Isto não é o comportamento desejado — é o motivo de `colunasDe`/`copiaLinha`
  // existirem. Fixar aqui é o que faz um "simplifica pra Object.keys" quebrar.
  assert.deepEqual(Object.keys(r), []);
  assert.deepEqual(Object.keys({ ...r }), []);

  assert.deepEqual(colunasDe(r).sort(), ['cidade', 'n', 'ok', 'quando', 'vazio']);
});

test('`colunasDe` soma as físicas com as calculadas já memoizadas, sem repetir', () => {
  const r = new VistaDeLinhas(tabela()).linha(0) as Row;
  r['dobro'] = 2;
  const cs = colunasDe(r);
  assert.deepEqual(cs.sort(), ['cidade', 'dobro', 'n', 'ok', 'quando', 'vazio']);
  assert.equal(new Set(cs).size, cs.length, 'nenhum nome repetido');
});

test('`copiaLinha` devolve objeto SIMPLES com todos os valores', () => {
  const r = new VistaDeLinhas(tabela()).linha(0) as Row;
  r['dobro'] = 2;
  const c = copiaLinha(r);
  assert.deepEqual(Object.keys(c).sort(), ['cidade', 'dobro', 'n', 'ok', 'quando', 'vazio']);
  assert.equal(c['cidade'], 'Canoas');
  assert.equal(c['dobro'], 2);
  assert.equal((c['quando'] as Date).getTime(), QUANDO.getTime());
  // Simples de verdade: escrever nela não estoura, e não afeta a vista.
  c['cidade'] = 'Sapucaia';
  assert.equal(r['cidade'], 'Canoas');
});

test('`copiaLinha` e `colunasDe` continuam corretos para objeto simples', () => {
  const o: Row = { a: 1, b: null };
  assert.deepEqual(colunasDe(o).sort(), ['a', 'b']);
  assert.deepEqual(copiaLinha(o), o);
  assert.notEqual(copiaLinha(o), o, 'cópia, não a mesma referência');
});

test('`todas()` devolve SEMPRE o mesmo array — o WeakMap de indice.ts depende disso', () => {
  const v = new VistaDeLinhas(tabela());
  const a = v.todas();
  const b = v.todas();
  assert.equal(a, b, 'array novo a cada chamada reconstruiria todo índice, em silêncio');
  assert.equal(a.length, 3);
  assert.equal(a[2]!['cidade'], 'Esteio');
});

test('linha fora do intervalo erra alto, em vez de devolver nulo', () => {
  const v = new VistaDeLinhas(tabela());
  assert.throws(() => v.linha(3), /fora de 0\.\.2/);
  assert.throws(() => v.linha(-1), /fora de 0\.\.2/);
});

test('duas tabelas têm protótipos independentes', () => {
  const outra = new ConstrutorDeTabela('U', ['cidade'], 1);
  outra.poeLinha(['Gravataí']);
  const a = new VistaDeLinhas(tabela()).linha(0);
  const b = new VistaDeLinhas(outra.fecha()).linha(0);
  assert.equal(a['cidade'], 'Canoas');
  assert.equal(b['cidade'], 'Gravataí');
  assert.ok(!('n' in b), 'a coluna de uma não pode vazar para a outra');
});
