import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import { leGrupos, QUERY_BLOQUEADA, validaGrupos, type GrupoDeRefresh } from '../src/grupos.ts';

function tmpSpecsDir(yaml: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-yaml-'));
  fs.mkdirSync(path.join(dir, '_catalog'), { recursive: true });
  fs.writeFileSync(path.join(dir, '_catalog', 'refresh.yaml'), yaml, 'utf8');
  return dir;
}

test('sem o arquivo, nenhum grupo — não é erro', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-vazio-'));
  assert.deepEqual(leGrupos(dir), new Map());
});

test('lê grupo com os defaults certos (incremental: false quando omitido)', () => {
  const dir = tmpSpecsDir(`
formato: 1
grupos:
  quente:
    queries: [a, b]
    intervalo_minutos: 15
`);
  const grupos = leGrupos(dir);
  assert.deepEqual(grupos.get('quente'), {
    id: 'quente', queries: ['a', 'b'], intervaloMinutos: 15, incremental: false,
  });
});

test('formato diferente de 1 derruba', () => {
  const dir = tmpSpecsDir('formato: 2\ngrupos: {}\n');
  assert.throws(() => leGrupos(dir), /formato 2, esperado 1/);
});

test('grupo sem queries derruba', () => {
  const dir = tmpSpecsDir('formato: 1\ngrupos:\n  x:\n    intervalo_minutos: 10\n');
  assert.throws(() => leGrupos(dir), /'x' não declara 'queries'/);
});

test('grupo sem intervalo_minutos, ou com zero/negativo, derruba', () => {
  const semIntervalo = tmpSpecsDir('formato: 1\ngrupos:\n  x:\n    queries: [a]\n');
  assert.throws(() => leGrupos(semIntervalo), /intervalo_minutos/);

  const zero = tmpSpecsDir('formato: 1\ngrupos:\n  x:\n    queries: [a]\n    intervalo_minutos: 0\n');
  assert.throws(() => leGrupos(zero), /intervalo_minutos/);
});

// ------------------------------------------------------------- validaGrupos

const IDS = new Set(['a', 'b', 'c', QUERY_BLOQUEADA]);

function g(over: Partial<GrupoDeRefresh>): GrupoDeRefresh {
  return { id: 'g', queries: [], intervaloMinutos: 15, incremental: false, ...over };
}

test('validaGrupos: tudo certo devolve lista vazia', () => {
  const grupos = new Map([
    ['x', g({ id: 'x', queries: ['a', 'b'] })],
    ['y', g({ id: 'y', queries: ['c'] })],
  ]);
  assert.deepEqual(validaGrupos(grupos, IDS), []);
});

test('validaGrupos: query que não existe no registry é reportada', () => {
  const grupos = new Map([['x', g({ id: 'x', queries: ['fantasma'] })]]);
  const problemas = validaGrupos(grupos, IDS);
  assert.equal(problemas.length, 1);
  assert.match(problemas[0]!, /fantasma.*não existe/);
});

test('validaGrupos: a mesma query em dois grupos é reportada', () => {
  const grupos = new Map([
    ['x', g({ id: 'x', queries: ['a'] })],
    ['y', g({ id: 'y', queries: ['a'] })],
  ]);
  const problemas = validaGrupos(grupos, IDS);
  assert.equal(problemas.length, 1);
  assert.match(problemas[0]!, /'a' aparece em dois grupos: 'x' e 'y'/);
});

test('validaGrupos: a query bloqueada (ACHADOS #81) é sempre reportada, mesmo sozinha num grupo', () => {
  const grupos = new Map([['x', g({ id: 'x', queries: [QUERY_BLOQUEADA] })]]);
  const problemas = validaGrupos(grupos, IDS);
  assert.equal(problemas.length, 1);
  assert.match(problemas[0]!, /não materializa em nenhum modo/);
});

test('validaGrupos: o refresh.yaml de verdade do catálogo passa em todas as validações', () => {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const registry = QueryRegistry.fromSpecsDir(path.join(raiz, 'specs'));
  const grupos = leGrupos(path.join(raiz, 'specs'));
  assert.ok(grupos.size > 0, 'specs/_catalog/refresh.yaml deveria ter ao menos um grupo');
  const problemas = validaGrupos(grupos, new Set(registry.queries.keys()));
  assert.deepEqual(problemas, []);
});
