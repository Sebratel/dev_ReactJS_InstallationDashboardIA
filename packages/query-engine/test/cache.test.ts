// Testes de contrato do Cache: qualquer adapter (memória, Redis) deve passar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCache } from '../src/cache-memory.ts';
import { RedisCache, type RedisLike } from '../src/cache-redis.ts';
import type { Cache, Clock } from '../src/types.ts';

class FakeClock implements Clock {
  #t = 1_000_000;
  now() {
    return this.#t;
  }
  advanceSeconds(s: number) {
    this.#t += s * 1000;
  }
}

/** Redis falso, in-process, para exercitar o adapter sem infra. */
class FakeRedis implements RedisLike {
  store = new Map<string, string>();
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string, _mode: 'EX', _ttl: number) {
    this.store.set(key, value);
    return 'OK';
  }
  async del(...keys: string[]) {
    let n = 0;
    for (const k of keys) if (this.store.delete(k)) n++;
    return n;
  }
  async scan(cursor: string, ...args: (string | number)[]): Promise<[string, string[]]> {
    const matchIdx = args.findIndex((a) => String(a).toUpperCase() === 'MATCH');
    const pattern = String(args[matchIdx + 1] ?? '*').replace(/\*$/, '');
    const all = [...this.store.keys()].filter((k) => k.startsWith(pattern));
    // devolve em 2 páginas para exercitar o loop do SCAN
    const start = Number(cursor);
    const page = all.slice(start, start + 2);
    const next = start + 2 >= all.length ? '0' : String(start + 2);
    return [next, page];
  }
  async quit() {
    return 'OK';
  }
}

function contractTests(name: string, make: () => Cache) {
  test(`${name}: set/get/del`, async () => {
    const c = make();
    assert.equal(await c.get('a'), undefined);
    await c.set('a', { x: 1 }, 60);
    assert.deepEqual(await c.get('a'), { x: 1 });
    await c.del('a');
    assert.equal(await c.get('a'), undefined);
  });

  test(`${name}: ttl<=0 não cacheia`, async () => {
    const c = make();
    await c.set('a', 1, 0);
    assert.equal(await c.get('a'), undefined);
  });

  test(`${name}: delMany retorna quantas existiam`, async () => {
    const c = make();
    await c.set('a', 1, 60);
    await c.set('b', 2, 60);
    assert.equal(await c.delMany(['a', 'b', 'inexistente']), 2);
  });

  test(`${name}: keys filtra por prefixo`, async () => {
    const c = make();
    await c.set('q:um', 1, 60);
    await c.set('q:um:abc', 2, 60);
    await c.set('q:dois', 3, 60);
    await c.set('outro', 4, 60);
    assert.deepEqual(await c.keys('q:um'), ['q:um', 'q:um:abc']);
    assert.deepEqual(await c.keys('q:'), ['q:dois', 'q:um', 'q:um:abc']);
  });

  test(`${name}: preserva arrays de linhas`, async () => {
    const c = make();
    const rows = [{ id: 1, nome: 'Ana' }, { id: 2, nome: 'João' }];
    await c.set('rows', rows, 60);
    assert.deepEqual(await c.get('rows'), rows);
  });
}

contractTests('MemoryCache', () => new MemoryCache());
contractTests('RedisCache(fake)', () => new RedisCache(new FakeRedis()));

// Específico de memória: expiração determinística com relógio falso
test('MemoryCache: expira após o TTL', async () => {
  const clock = new FakeClock();
  const c = new MemoryCache(clock);
  await c.set('a', 'v', 30);
  clock.advanceSeconds(29);
  assert.equal(await c.get('a'), 'v', 'ainda válido em 29s');
  clock.advanceSeconds(2);
  assert.equal(await c.get('a'), undefined, 'expirado em 31s');
});

test('MemoryCache: keys não retorna chave expirada', async () => {
  const clock = new FakeClock();
  const c = new MemoryCache(clock);
  await c.set('q:a', 1, 10);
  await c.set('q:b', 1, 100);
  clock.advanceSeconds(20);
  assert.deepEqual(await c.keys('q:'), ['q:b']);
});

test('RedisCache: valor corrompido é tratado como miss (não derruba a query)', async () => {
  const fake = new FakeRedis();
  fake.store.set('ruim', '{json quebrado');
  const c = new RedisCache(fake);
  assert.equal(await c.get('ruim'), undefined);
  assert.equal(fake.store.has('ruim'), false, 'chave corrompida é removida');
});

test('RedisCache: SCAN pagina até o cursor voltar a 0', async () => {
  const fake = new FakeRedis();
  const c = new RedisCache(fake);
  for (let i = 0; i < 5; i++) await c.set(`q:k${i}`, i, 60);
  const keys = await c.keys('q:');
  assert.equal(keys.length, 5, 'todas as chaves vieram, apesar da paginação');
});
