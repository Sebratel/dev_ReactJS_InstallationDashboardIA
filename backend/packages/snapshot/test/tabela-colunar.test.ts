import assert from 'node:assert/strict';
import test from 'node:test';

import { ID_NULO, montaColuna, TabelaColunar } from '../src/tabela-colunar.ts';
import type { Escalar } from '../src/formato.ts';

function tabela(nome: string, linhas: number, cols: Record<string, Escalar[]>): TabelaColunar {
  const t = new TabelaColunar(nome, linhas);
  for (const [n, vs] of Object.entries(cols)) t.poe(montaColuna(n, vs, linhas));
  return t;
}

// --------------------------------------------------------------- o básico

test('devolve o valor que entrou, com o tipo que entrou', () => {
  const d = new Date('2026-03-01T12:00:00.000Z');
  const t = tabela('T', 4, { c: ['a', 7, d, null] });
  assert.equal(t.valor('c', 0), 'a');
  assert.equal(t.valor('c', 1), 7);
  assert.equal((t.valor('c', 2) as Date).getTime(), d.getTime());
  assert.equal(t.valor('c', 3), null);
});

test('valor repetido compartilha id; a coluna constante tem 1 distinto além do nulo', () => {
  const t = tabela('T', 5, { c: ['x', 'x', 'x', 'x', 'x'] });
  assert.equal(t.distintos('c'), 2, 'o nulo mora sempre na posição 0');
  assert.equal(t.id('c', 0), t.id('c', 4));
  // É o caso real de `PROTOCOLOS PRODUTIVIDADE[ITEM]`: 1 valor distinto em 73.757
  // linhas. É daqui que vem a diferença entre 332 MB e 24 MB.
  assert.equal(t.coluna('c').valores.length, 2);
});

test('o nulo é sempre o id 0, mesmo quando nenhuma linha é nula', () => {
  const t = tabela('T', 2, { c: ['a', 'b'] });
  assert.equal(t.coluna('c').valores[ID_NULO], null);
  assert.notEqual(t.id('c', 0), ID_NULO);
});

// ------------------------------------------- a razão de a chave ser etiquetada
//
// `identityKey` do avaliador mapeia `true`, `1` e a data de serial 1 para a MESMA
// chave (`n:1`), e texto para minúsculas. Isso está certo para agrupar e errado
// para guardar: se o dicionário usasse aquela chave, `valor()` devolveria o
// primeiro que entrou, com o tipo errado, e a tela mostraria um número plausível.
// Estes testes existem para que ninguém "simplifique" a chave reusando aquela.

test('número, texto, booleano e data NÃO colidem no dicionário', () => {
  const t = tabela('T', 4, { c: [1, '1', true, new Date(1)] });
  assert.equal(t.distintos('c'), 5, '4 distintos + o nulo');
  assert.equal(t.valor('c', 0), 1);
  assert.equal(t.valor('c', 1), '1');
  assert.equal(t.valor('c', 2), true);
  assert.ok(t.valor('c', 3) instanceof Date);
});

test('texto preserva a caixa e NÃO agrupa como o `=` do DAX faria', () => {
  const t = tabela('T', 2, { c: ['São Paulo', 'SÃO PAULO'] });
  assert.equal(t.distintos('c'), 3, 'os dois são valores diferentes para o armazenamento');
  assert.equal(t.valor('c', 0), 'São Paulo');
  assert.equal(t.valor('c', 1), 'SÃO PAULO');
  assert.notEqual(t.id('c', 0), t.id('c', 1));
});

test('duas datas do mesmo instante compartilham id; instantes diferentes não', () => {
  const a = new Date('2026-01-05T00:00:00.000Z');
  const b = new Date('2026-01-05T00:00:00.000Z');
  const c = new Date('2026-01-06T00:00:00.000Z');
  const t = tabela('T', 3, { d: [a, b, c] });
  assert.equal(t.id('d', 0), t.id('d', 1));
  assert.notEqual(t.id('d', 0), t.id('d', 2));
});

// ---------------------------------------------------------------- os guardas

test('coluna com contagem de linhas diferente da tabela erra alto', () => {
  const t = new TabelaColunar('T', 3);
  assert.throws(() => t.poe(montaColuna('c', ['a', 'b'], 2)), /tem 2 linhas, a tabela tem 3/);
});

test('valores a mais ou a menos que o cabeçalho erram alto, não truncam', () => {
  assert.throws(() => montaColuna('c', ['a', 'b', 'c'], 2), /o cabeçalho mente/);
  assert.throws(() => montaColuna('c', ['a'], 3), /vieram 1 valores para 3 linhas/);
});

test('coluna repetida erra alto em vez de sobrescrever', () => {
  const t = new TabelaColunar('T', 1);
  t.poe(montaColuna('c', ['a'], 1));
  assert.throws(() => t.poe(montaColuna('c', ['b'], 1)), /já existe na tabela/);
});

test('pedir coluna que não existe nomeia a tabela e a coluna', () => {
  const t = tabela('MINHA TABELA', 1, { a: ['x'] });
  assert.throws(() => t.valor('b', 0), /MINHA TABELA: coluna 'b' não está na tabela/);
  assert.throws(() => t.id('b', 0), /não está na tabela/);
  assert.throws(() => t.distintos('b'), /não está na tabela/);
});

// ------------------------------------------------------------- o que ela custa

test('o custo dos ids é 4 bytes por célula, e o dicionário não repete o texto', () => {
  // 1.000 linhas, uma coluna com 3 cidades — o perfil real das colunas desta base.
  const cidades = ['Canoas', 'São Leopoldo', 'Novo Hamburgo'];
  const vs = Array.from({ length: 1000 }, (_, i) => cidades[i % 3]!);
  const t = tabela('T', 1000, { cidade: vs });

  assert.equal(t.distintos('cidade'), 4);
  const b = t.bytes();
  assert.equal(b.ids, 4000, '4 bytes por linha');
  // O texto aparece 4 vezes no dicionário, não 1.000. Guardar 1.000 strings de
  // ~12 caracteres custaria ~28 KB; aqui o dicionário fica na casa das dezenas
  // de bytes, e é essa razão que produz os 332 MB -> 24 MB medidos.
  assert.ok(b.dicionarios < 300, `dicionário deveria ser minúsculo, veio ${b.dicionarios}`);
});

test('a tabela conhece suas colunas e o número de linhas', () => {
  const t = tabela('T', 2, { a: [1, 2], b: ['x', 'y'] });
  assert.equal(t.linhas, 2);
  assert.deepEqual(t.nomes, ['a', 'b']);
  assert.equal(t.tem('a'), true);
  assert.equal(t.tem('z'), false);
});
