import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QueryRegistry } from '../src/registry.ts';
import { MemoryCache } from '../src/cache-memory.ts';
import { FakeConnector, SqlConnector } from '../src/connectors.ts';
import { QueryEngine, cacheKeyFor } from '../src/engine.ts';
import type { CachePolicy, Clock, Connector, EngineEvent, QuerySpec } from '../src/types.ts';

const SPECS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'specs',
);

class FakeClock implements Clock {
  t = 1_000_000;
  now() { return this.t; }
  advanceSeconds(s: number) { this.t += s * 1000; }
}

function spec(over: Partial<QuerySpec> = {}): QuerySpec {
  return {
    id: 'q1', name: 'Q1', origin: 'expression', source_type: 'odbc',
    datasource: 'dbVoalle', sql: 'select 1 from foo', url: null,
    source_tables: ['foo'], ...over,
  };
}

function setup(opts: {
  specs?: QuerySpec[];
  policy?: CachePolicy;
  clock?: Clock;
} = {}) {
  const registry = new QueryRegistry();
  const policy = opts.policy ?? { ttl: 300, realtime: true };
  for (const s of opts.specs ?? [spec()]) registry.add(s, policy);
  const connector = new FakeConnector('dbVoalle');
  const cache = new MemoryCache(opts.clock);
  const events: EngineEvent[] = [];
  const engine = new QueryEngine({
    registry,
    connectors: new Map<string, Connector>([['dbVoalle', connector]]),
    cache,
    clock: opts.clock,
    onEvent: (e) => events.push(e),
  });
  return { registry, connector, cache, engine, events };
}

// ---------- chave de cache ----------

test('cacheKeyFor: estável e independente da ordem dos params', () => {
  assert.equal(cacheKeyFor('q1'), 'q:q1');
  const a = cacheKeyFor('q1', { b: 2, a: 1 });
  const b = cacheKeyFor('q1', { a: 1, b: 2 });
  assert.equal(a, b, 'mesma chave independente da ordem');
  assert.notEqual(a, cacheKeyFor('q1', { a: 1, b: 3 }), 'params diferentes = chaves diferentes');
  assert.match(a, /^q:q1:[0-9a-f]{12}$/);
});

// ---------- execução e cache ----------

test('engine: miss executa no connector e devolve linhas', async () => {
  const { engine, connector } = setup();
  connector.on('q1', [{ id: 1 }, { id: 2 }]);
  const res = await engine.execute('q1');
  assert.deepEqual(res.rows, [{ id: 1 }, { id: 2 }]);
  assert.equal(res.meta.cached, false);
  assert.equal(res.meta.rowCount, 2);
  assert.equal(res.meta.queryId, 'q1');
  assert.equal(res.meta.datasource, 'dbVoalle');
  assert.equal(connector.callCount('q1'), 1);
});

test('engine: segunda chamada vem do cache (não toca o banco)', async () => {
  const { engine, connector } = setup();
  connector.on('q1', [{ id: 1 }]);
  await engine.execute('q1');
  const res = await engine.execute('q1');
  assert.equal(res.meta.cached, true);
  assert.deepEqual(res.rows, [{ id: 1 }]);
  assert.equal(connector.callCount('q1'), 1, 'connector chamado só uma vez');
});

test('engine: cache expira conforme o TTL da policy', async () => {
  const clock = new FakeClock();
  const { engine, connector } = setup({ policy: { ttl: 60, realtime: true }, clock });
  connector.on('q1', [{ id: 1 }]);
  await engine.execute('q1');
  clock.advanceSeconds(59);
  assert.equal((await engine.execute('q1')).meta.cached, true, 'ainda cacheado');
  clock.advanceSeconds(2);
  assert.equal((await engine.execute('q1')).meta.cached, false, 'expirou');
  assert.equal(connector.callCount('q1'), 2);
});

test('engine: ttl 0 nunca cacheia', async () => {
  const { engine, connector } = setup({ policy: { ttl: 0, realtime: false } });
  connector.on('q1', [{ id: 1 }]);
  await engine.execute('q1');
  await engine.execute('q1');
  assert.equal(connector.callCount('q1'), 2);
});

test('engine: forceRefresh ignora o cache de leitura mas regrava', async () => {
  const { engine, connector } = setup();
  connector.on('q1', [{ v: 'antigo' }]);
  await engine.execute('q1');
  connector.on('q1', [{ v: 'novo' }]);
  const forced = await engine.execute('q1', { forceRefresh: true });
  assert.deepEqual(forced.rows, [{ v: 'novo' }]);
  assert.equal(forced.meta.cached, false);
  const after = await engine.execute('q1');
  assert.deepEqual(after.rows, [{ v: 'novo' }], 'cache foi atualizado');
  assert.equal(after.meta.cached, true);
});

test('engine: params diferentes são cacheados separadamente', async () => {
  const { engine, connector } = setup();
  connector.on('q1', (_q, p) => [{ cidade: p?.cidade }]);
  const a = await engine.execute('q1', { params: { cidade: 'Canoas' } });
  const b = await engine.execute('q1', { params: { cidade: 'Esteio' } });
  assert.deepEqual(a.rows, [{ cidade: 'Canoas' }]);
  assert.deepEqual(b.rows, [{ cidade: 'Esteio' }]);
  assert.equal(connector.callCount('q1'), 2);
  // e cada um bate no próprio cache
  assert.equal((await engine.execute('q1', { params: { cidade: 'Canoas' } })).meta.cached, true);
  assert.equal(connector.callCount('q1'), 2);
});

// ---------- single-flight ----------

test('engine: single-flight — 20 widgets simultâneos = 1 query no banco', async () => {
  const { engine, connector } = setup();
  connector.on('q1', [{ id: 1 }]);
  connector.delayMs = 20;
  const results = await Promise.all(
    Array.from({ length: 20 }, () => engine.execute('q1')),
  );
  assert.equal(connector.callCount('q1'), 1, 'thundering herd evitado');
  for (const r of results) assert.deepEqual(r.rows, [{ id: 1 }]);
});

test('engine: single-flight libera a chave após erro (não envenena)', async () => {
  const { engine, connector } = setup();
  connector.failOn('q1', new Error('banco fora'));
  await assert.rejects(() => engine.execute('q1'), /banco fora/);
  // agora funciona
  const c2 = new FakeConnector('dbVoalle').on('q1', [{ ok: true }]);
  const { engine: e2 } = (() => {
    const registry = new QueryRegistry();
    registry.add(spec(), { ttl: 300, realtime: true });
    return {
      engine: new QueryEngine({
        registry,
        connectors: new Map<string, Connector>([['dbVoalle', c2]]),
        cache: new MemoryCache(),
      }),
    };
  })();
  assert.deepEqual((await e2.execute('q1')).rows, [{ ok: true }]);
});

// ---------- invalidação (realtime) ----------

test('engine: invalidateByTable limpa só as queries dependentes', async () => {
  const { engine, connector, registry } = setup({
    specs: [
      spec({ id: 'contratos', source_tables: ['contracts', 'people'] }),
      spec({ id: 'protocolos', source_tables: ['assignments'] }),
    ],
  });
  connector.on('contratos', [{ a: 1 }]).on('protocolos', [{ b: 1 }]);
  await engine.execute('contratos');
  await engine.execute('protocolos');

  const affected = await engine.invalidateByTable('contracts');
  assert.deepEqual(affected, ['contratos']);
  assert.equal((await engine.execute('contratos')).meta.cached, false, 'contratos invalidado');
  assert.equal((await engine.execute('protocolos')).meta.cached, true, 'protocolos intacto');
  assert.ok(registry.queriesForTable('contracts').includes('contratos'));
});

test('engine: invalidateByTable respeita realtime=false', async () => {
  const registry = new QueryRegistry();
  registry.add(spec({ id: 'viva', source_tables: ['foo'] }), { ttl: 300, realtime: true });
  registry.add(spec({ id: 'estatica', source_tables: ['foo'] }), { ttl: 300, realtime: false });
  const connector = new FakeConnector('dbVoalle').on('viva', [{ a: 1 }]).on('estatica', [{ b: 1 }]);
  const engine = new QueryEngine({
    registry,
    connectors: new Map<string, Connector>([['dbVoalle', connector]]),
    cache: new MemoryCache(),
  });
  await engine.execute('viva');
  await engine.execute('estatica');
  const affected = await engine.invalidateByTable('foo');
  assert.deepEqual(affected, ['viva'], 'só a query realtime é invalidada');
  assert.equal((await engine.execute('estatica')).meta.cached, true);
});

test('engine: invalidação remove todas as variantes por parâmetro', async () => {
  const { engine, connector } = setup();
  connector.on('q1', (_q, p) => [{ c: p?.cidade }]);
  await engine.execute('q1', { params: { cidade: 'Canoas' } });
  await engine.execute('q1', { params: { cidade: 'Esteio' } });
  await engine.execute('q1');
  const removed = await engine.invalidateQuery('q1');
  assert.equal(removed, 3, 'chave base + 2 variantes');
});

test('engine: invalidação não vaza para queries de prefixo parecido', async () => {
  const { engine, connector } = setup({
    specs: [spec({ id: 'proto' }), spec({ id: 'proto-detalhado' })],
  });
  connector.on('proto', [{ a: 1 }]).on('proto-detalhado', [{ b: 1 }]);
  await engine.execute('proto');
  await engine.execute('proto-detalhado');
  await engine.invalidateQuery('proto');
  assert.equal((await engine.execute('proto')).meta.cached, false);
  assert.equal(
    (await engine.execute('proto-detalhado')).meta.cached,
    true,
    'prefixo parecido não pode ser afetado',
  );
});

// ---------- erros ----------

test('engine: erro claro quando falta connector para o datasource', async () => {
  const registry = new QueryRegistry();
  registry.add(spec({ datasource: 'dbFantasma' }));
  const engine = new QueryEngine({
    registry, connectors: new Map(), cache: new MemoryCache(),
  });
  await assert.rejects(() => engine.execute('q1'), /Sem connector para datasource "dbFantasma"/);
});

test('engine: erro claro para query não registrada', async () => {
  const { engine } = setup();
  await assert.rejects(() => engine.execute('nao-existe'), /não registrada/);
});

// ---------- observabilidade ----------

test('engine: emite eventos para o Observability Engine', async () => {
  const { engine, connector, events } = setup();
  connector.on('q1', [{ id: 1 }]);
  await engine.execute('q1');
  await engine.execute('q1');
  await engine.invalidateByTable('foo');
  const types = events.map((e) => e.type);
  assert.deepEqual(types, ['cache_miss', 'executed', 'cache_hit', 'invalidated']);
  const executed = events.find((e) => e.type === 'executed');
  assert.equal(executed?.rowCount, 1);
});

// ---------- SqlConnector ----------

test('SqlConnector: repassa o SQL da spec para o driver injetado', async () => {
  const seen: string[] = [];
  const connector = new SqlConnector('dbVoalle', async (sql) => {
    seen.push(sql);
    return [{ ok: 1 }];
  });
  const registry = new QueryRegistry();
  registry.add(spec({ sql: 'select 42 from bar' }));
  const engine = new QueryEngine({
    registry,
    connectors: new Map<string, Connector>([['dbVoalle', connector]]),
    cache: new MemoryCache(),
  });
  const res = await engine.execute('q1');
  assert.deepEqual(res.rows, [{ ok: 1 }]);
  assert.deepEqual(seen, ['select 42 from bar']);
});

// ---------- integração com as specs reais ----------

test('engine: roda contra o Query Registry real das specs do PBIP', async () => {
  const registry = QueryRegistry.fromSpecsDir(SPECS_DIR);
  const voalle = new FakeConnector('dbVoalle').on('contratos', [
    { CLIENTE: 'Ana', 'NUMERO CONTRATO': 1001 },
  ]);
  const engine = new QueryEngine({
    registry,
    connectors: new Map<string, Connector>([['dbVoalle', voalle]]),
    cache: new MemoryCache(),
  });

  const res = await engine.execute('contratos');
  assert.equal(res.meta.rowCount, 1);
  assert.equal(res.meta.datasource, 'dbVoalle');
  assert.equal((await engine.execute('contratos')).meta.cached, true);

  // um evento CDC em `contracts` deve invalidar `contratos` — e mais nada indevido
  const affected = await engine.invalidateByTable('contracts');
  assert.ok(affected.includes('contratos'), 'contratos invalidado por contracts');
  assert.equal((await engine.execute('contratos')).meta.cached, false);
});

test('engine: TTL real de protocolos-geral vem do cache-policies (60s)', async () => {
  const clock = new FakeClock();
  const registry = QueryRegistry.fromSpecsDir(SPECS_DIR);
  const voalle = new FakeConnector('dbVoalle').on('protocolos-geral', [{ x: 1 }]);
  const engine = new QueryEngine({
    registry,
    connectors: new Map<string, Connector>([['dbVoalle', voalle]]),
    cache: new MemoryCache(clock),
    clock,
  });
  await engine.execute('protocolos-geral');
  clock.advanceSeconds(59);
  assert.equal((await engine.execute('protocolos-geral')).meta.cached, true);
  clock.advanceSeconds(2);
  assert.equal((await engine.execute('protocolos-geral')).meta.cached, false);
});
