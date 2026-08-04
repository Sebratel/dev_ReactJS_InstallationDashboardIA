import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QueryRegistry, DEFAULT_POLICY } from '../src/registry.ts';
import type { QuerySpec } from '../src/types.ts';

const SPECS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'specs',
);

function spec(over: Partial<QuerySpec> = {}): QuerySpec {
  return {
    id: 'q1',
    name: 'Q1',
    origin: 'expression',
    source_type: 'odbc',
    datasource: 'dbVoalle',
    sql: 'select 1 from foo',
    url: null,
    source_tables: ['foo'],
    ...over,
  };
}

test('registry: add/get/has/list', () => {
  const r = new QueryRegistry();
  r.add(spec());
  assert.ok(r.has('q1'));
  assert.equal(r.get('q1').name, 'Q1');
  assert.equal(r.list().length, 1);
  assert.throws(() => r.get('nope'), /não registrada/);
});

test('registry: rejeita query duplicada', () => {
  const r = new QueryRegistry();
  r.add(spec());
  assert.throws(() => r.add(spec()), /duplicada/);
});

test('registry: aplica policy default quando não informada', () => {
  const r = new QueryRegistry();
  r.add(spec());
  assert.deepEqual(r.get('q1').cache, DEFAULT_POLICY);
});

test('registry: mapa tabela -> queries (case-insensitive)', () => {
  const r = new QueryRegistry();
  r.add(spec({ id: 'a', source_tables: ['contracts', 'people'] }));
  r.add(spec({ id: 'b', source_tables: ['CONTRACTS'] }));
  assert.deepEqual(r.queriesForTable('contracts'), ['a', 'b']);
  assert.deepEqual(r.queriesForTable('CoNtRaCtS'), ['a', 'b']);
  assert.deepEqual(r.queriesForTable('people'), ['a']);
  assert.deepEqual(r.queriesForTable('inexistente'), []);
});

test('registry: validate aponta problemas reais', () => {
  const r = new QueryRegistry();
  r.datasources.set('dbVoalle', { id: 'dbVoalle', type: 'odbc', connection: null });
  r.add(spec({ id: 'ok' }));
  r.add(spec({ id: 'sem-sql', sql: null, url: null }));
  r.add(spec({ id: 'ds-ruim', datasource: 'fantasma' }));
  r.add(spec({ id: 'sem-tabelas', source_tables: [] }));
  const problems = r.validate();
  assert.ok(problems.some((p) => p.startsWith('sem-sql:')));
  assert.ok(problems.some((p) => p.startsWith('ds-ruim:')));
  assert.ok(problems.some((p) => p.startsWith('sem-tabelas:')));
  assert.ok(!problems.some((p) => p.startsWith('ok:')));
});

// ---------- Integração com as specs reais ----------

test('registry: carrega as specs reais do PBIP', () => {
  const r = QueryRegistry.fromSpecsDir(SPECS_DIR);
  assert.equal(r.queries.size, 24, '24 queries extraídas');
  assert.ok(r.has('contratos'));
  assert.ok(r.has('protocolos-geral'));
  // as 3 fontes externas reais + os pseudo-datasources classificados
  for (const id of ['dbVoalle', 'dbMaria', 'gsheets', 'web', 'inline', 'computed']) {
    assert.ok(r.datasources.has(id), `datasource ${id}`);
  }
});

test('registry: nenhuma query fica com fonte desconhecida', () => {
  const r = QueryRegistry.fromSpecsDir(SPECS_DIR);
  const unknown = r.list().filter((q) => q.source_type === 'unknown');
  assert.deepEqual(unknown.map((q) => q.id), [], 'toda query deve ter fonte classificada');
});

test('registry: cache-policies.yaml é aplicado por cima das specs geradas', () => {
  const r = QueryRegistry.fromSpecsDir(SPECS_DIR);
  // override explícito
  assert.equal(r.get('protocolos-geral').cache.ttl, 60);
  assert.equal(r.get('feriados').cache.ttl, 86400);
  assert.equal(r.get('feriados').cache.realtime, false);
  // fontes sem CDC não podem ser marcadas realtime
  assert.equal(r.get('quadro-funcional').cache.realtime, false);
  assert.equal(r.get('gestores-equipes').cache.realtime, false);
});

test('registry: specs reais têm dependências de tabela utilizáveis pelo realtime', () => {
  const r = QueryRegistry.fromSpecsDir(SPECS_DIR);
  // contratos vem de authentication_contracts + contracts + people
  const deps = r.get('contratos').source_tables;
  assert.ok(deps.includes('contracts'), 'contracts');
  assert.ok(deps.includes('people'), 'people');
  // e o índice inverso encontra a query a partir da tabela
  assert.ok(r.queriesForTable('contracts').includes('contratos'));
  // tabela central do domínio afeta várias queries
  assert.ok(
    r.queriesForTable('assignment_incidents').length >= 2,
    'assignment_incidents afeta múltiplas queries',
  );
});

test('registry: specs reais passam na validação (datasources e realtime)', () => {
  const r = QueryRegistry.fromSpecsDir(SPECS_DIR);
  const problems = r.validate();
  // Google Sheets não tem SQL/source_tables — é esperado e não deve poluir
  const relevant = problems.filter((p) => !p.startsWith('quadro-funcional:'));
  assert.deepEqual(relevant, [], `problemas inesperados:\n${relevant.join('\n')}`);
});
