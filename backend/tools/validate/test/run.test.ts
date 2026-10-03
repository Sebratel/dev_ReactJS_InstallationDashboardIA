import assert from 'node:assert/strict';
import test from 'node:test';
import type { SqlRunner } from '../../../packages/query-engine/src/connectors.ts';
import type { ResolvedQuery } from '../../../packages/query-engine/src/types.ts';
import { runQuery } from '../src/run.ts';

const AT = '2026-08-04T12:00:00.000Z';
const OPTS = { sampleRows: 100, now: () => AT };

const QUERY: ResolvedQuery = {
  id: 'contratos',
  name: 'CONTRATOS',
  origin: 'expression',
  source_type: 'odbc',
  datasource: 'dbVoalle',
  sql: 'select * from contracts',
  url: null,
  source_tables: ['contracts'],
  cache: { ttl: 300, realtime: true },
};

/** Runner falso que responde por padrão de SQL e registra o que recebeu. */
function fakeRunner(handlers: { count?: unknown; sample?: unknown[]; direct?: unknown[] }): {
  run: SqlRunner;
  seen: string[];
} {
  const seen: string[] = [];
  const run: SqlRunner = async (sql) => {
    seen.push(sql);
    if (sql.includes('count(*) as _n')) {
      if (handlers.count === undefined) throw new Error('subquery não suportada');
      return [{ _n: handlers.count }];
    }
    if (sql.includes('limit')) {
      if (!handlers.sample) throw new Error('sem amostra');
      return handlers.sample as Record<string, unknown>[];
    }
    if (!handlers.direct) throw new Error('sem resultado direto');
    return handlers.direct as Record<string, unknown>[];
  };
  return { run, seen };
}

test('runQuery: caminho normal usa count exato + amostra', async () => {
  const { run, seen } = fakeRunner({ count: 1234, sample: [{ ID: 1, NOME: 'ab' }] });
  const out = await runQuery(QUERY, run, OPTS);

  assert.equal(out.ok, true);
  assert.equal(out.golden!.strategy, 'wrapped');
  assert.equal(out.golden!.rowCount, 1234, 'o total vem do count, não da amostra');
  assert.equal(out.golden!.profiledRows, 1);
  assert.deepEqual(out.golden!.columns.map((c) => c.name), ['ID', 'NOME']);
  assert.equal(seen.length, 2);
});

test('runQuery: count bigint-string do pg é convertido', async () => {
  const { run } = fakeRunner({ count: '98765', sample: [{ a: 1 }] });
  const out = await runQuery(QUERY, run, OPTS);
  assert.equal(out.golden!.rowCount, 98765);
});

test('runQuery: resultado vazio não gasta uma segunda query', async () => {
  const { run, seen } = fakeRunner({ count: 0, sample: [{ a: 1 }] });
  const out = await runQuery(QUERY, run, OPTS);
  assert.equal(out.golden!.rowCount, 0);
  assert.equal(out.golden!.profiledRows, 0);
  assert.equal(seen.length, 1, 'com 0 linhas não faz sentido buscar amostra');
});

test('runQuery: SQL que não aceita subquery cai para execução direta', async () => {
  const { run } = fakeRunner({ direct: [{ a: 1 }, { a: 2 }, { a: 3 }] });
  const out = await runQuery(QUERY, run, OPTS);

  assert.equal(out.ok, true);
  assert.equal(out.golden!.strategy, 'direct');
  assert.equal(out.golden!.rowCount, 3, 'em direct o total também é exato');
  assert.equal(out.golden!.truncated, false);
  assert.match(out.fallbackFrom!, /subquery não suportada/);
});

test('runQuery: em direct o perfil respeita sampleRows mas o total não', async () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ a: i }));
  const { run } = fakeRunner({ direct: rows });
  const out = await runQuery(QUERY, run, { ...OPTS, sampleRows: 4 });
  assert.equal(out.golden!.rowCount, 10);
  assert.equal(out.golden!.profiledRows, 4);
});

test('runQuery: falha nas duas estratégias devolve erro, não exceção', async () => {
  const { run } = fakeRunner({});
  const out = await runQuery(QUERY, run, OPTS);
  assert.equal(out.ok, false);
  assert.equal(out.golden, undefined);
  assert.match(out.error!, /sem resultado direto/);
  assert.match(out.fallbackFrom!, /subquery não suportada/);
});

test('runQuery: query sem SQL falha sem tocar na fonte', async () => {
  const { run, seen } = fakeRunner({ count: 1 });
  const out = await runQuery({ ...QUERY, sql: null }, run, OPTS);
  assert.equal(out.ok, false);
  assert.match(out.error!, /sem SQL/);
  assert.equal(seen.length, 0);
});

test('runQuery: golden não carrega valor de linha', async () => {
  const { run } = fakeRunner({
    count: 2,
    sample: [
      { CLIENTE: 'Maria Aparecida', CPF: '12345678901', CIDADE: 'Ourinhos' },
      { CLIENTE: 'Joao Pedro', CPF: '10987654321', CIDADE: 'Ourinhos' },
    ],
  });
  const out = await runQuery(QUERY, run, OPTS);
  const json = JSON.stringify(out.golden);
  for (const pii of ['Maria', 'Aparecida', 'Joao', 'Pedro', '12345678901', 'Ourinhos']) {
    assert.ok(!json.includes(pii), `golden vazou "${pii}"`);
  }
  // mas o perfil continua útil
  assert.deepEqual(out.golden!.columns.map((c) => c.name), ['CLIENTE', 'CPF', 'CIDADE']);
  assert.equal(out.golden!.columns[2].distinct, 1);
});

test('runQuery: capturedAt vem do relógio injetado', async () => {
  const { run } = fakeRunner({ count: 1, sample: [{ a: 1 }] });
  const out = await runQuery(QUERY, run, OPTS);
  assert.equal(out.golden!.capturedAt, AT);
});
