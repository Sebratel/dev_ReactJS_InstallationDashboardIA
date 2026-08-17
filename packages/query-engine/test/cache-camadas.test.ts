// Cache em duas camadas: memória na frente, Redis atrás.
//
// **O que estes testes guardam.** Primeiro, que ligar o Redis não deixa a API mais
// lenta: o acerto local não pode sair do processo. Segundo, que o Redis caindo tira o
// acerto e nunca a resposta — uma otimização que vira ponto único de falha é pior que
// não ter otimização.

import assert from 'node:assert/strict';
import test from 'node:test';
import { CacheEmCamadas } from '../src/cache-camadas.ts';
import { MemoryCache } from '../src/cache-memory.ts';
import type { Cache } from '../src/types.ts';

/** Um Redis de mentira que anota o que pediram. */
class Espiao implements Cache {
  readonly dentro = new Map<string, unknown>();
  readonly chamadas: string[] = [];

  async get<T>(key: string): Promise<T | undefined> {
    this.chamadas.push(`get ${key}`);
    return this.dentro.get(key) as T | undefined;
  }
  async set<T>(key: string, value: T, ttl: number): Promise<void> {
    this.chamadas.push(`set ${key}`);
    if (ttl > 0) this.dentro.set(key, value);
  }
  async del(key: string): Promise<void> {
    this.chamadas.push(`del ${key}`);
    this.dentro.delete(key);
  }
  async delMany(keys: string[]): Promise<number> {
    this.chamadas.push(`delMany ${keys.length}`);
    let n = 0;
    for (const k of keys) if (this.dentro.delete(k)) n++;
    return n;
  }
  async keys(prefix: string): Promise<string[]> {
    this.chamadas.push(`keys ${prefix}`);
    return [...this.dentro.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}

/** Um Redis que só sabe cair. */
const QUEBRADO: Cache = {
  async get() {
    throw new Error('ECONNREFUSED');
  },
  async set() {
    throw new Error('ECONNREFUSED');
  },
  async del() {
    throw new Error('ECONNREFUSED');
  },
  async delMany(): Promise<number> {
    throw new Error('ECONNREFUSED');
  },
  async keys(): Promise<string[]> {
    throw new Error('ECONNREFUSED');
  },
};

/**
 * O motivo de existir da classe. Antes dela, `REDIS_URL` **substituía** a memória, e
 * ligar o Redis teria feito cada acerto pagar rede mais `JSON.parse` de até 172 KB.
 */
test('o acerto local não vai ao Redis', async () => {
  const redis = new Espiao();
  const c = new CacheEmCamadas({ rapida: new MemoryCache(), duravel: redis });

  await c.set('k', { a: 1 }, 60);
  redis.chamadas.length = 0;

  assert.deepEqual(await c.get('k'), { a: 1 });
  assert.deepEqual(await c.get('k'), { a: 1 });
  assert.deepEqual(redis.chamadas, [], 'nenhuma ida à rede quando a memória já tem');
});

test('escreve nas duas: o cache sobrevive ao restart', async () => {
  const redis = new Espiao();
  const c = new CacheEmCamadas({ rapida: new MemoryCache(), duravel: redis });

  await c.set('k', { a: 1 }, 60);
  assert.deepEqual(redis.dentro.get('k'), { a: 1 }, 'a camada durável tem de ter recebido');
});

/**
 * O que acontece depois de um restart: a memória está vazia e o Redis não.
 */
test('miss local busca no Redis e promove para a memória', async () => {
  const redis = new Espiao();
  redis.dentro.set('k', { a: 1 });
  const memoria = new MemoryCache();
  const c = new CacheEmCamadas({ rapida: memoria, duravel: redis });

  assert.deepEqual(await c.get('k'), { a: 1 }, 'veio do Redis');
  assert.equal(memoria.size, 1, 'e ficou na memória');

  redis.chamadas.length = 0;
  assert.deepEqual(await c.get('k'), { a: 1 });
  assert.deepEqual(redis.chamadas, [], 'a segunda leitura já é local');
});

/**
 * **A regra que não pode cair.** O cache não participa do *valor* da resposta, só do
 * tempo dela: um Redis fora do ar que derrubasse o pedido transformaria uma
 * otimização em ponto único de falha.
 */
test('Redis fora do ar: a memória continua servindo, e a falha aparece', async () => {
  const falhas: string[] = [];
  const memoria = new MemoryCache();
  const c = new CacheEmCamadas({
    rapida: memoria,
    duravel: QUEBRADO,
    aoFalhar: (op) => falhas.push(op),
  });

  await c.set('k', { a: 1 }, 60);
  assert.deepEqual(await c.get('k'), { a: 1 }, 'a memória guardou mesmo com o Redis caído');
  assert.equal(await c.get('nao-existe'), undefined, 'miss é miss, não exceção');

  await c.del('k');
  assert.equal(await c.get('k'), undefined);
  assert.deepEqual(await c.keys('n'), [], 'keys degrada para o que a memória sabe');
  assert.equal(await c.delMany(['x']), 0);

  assert.ok(falhas.includes('get'), 'nenhuma das falhas some calada');
  assert.ok(falhas.includes('set'));
  assert.ok(falhas.includes('del'));
});

test('ttl 0 não grava em camada nenhuma', async () => {
  const redis = new Espiao();
  const memoria = new MemoryCache();
  const c = new CacheEmCamadas({ rapida: memoria, duravel: redis });

  await c.set('k', { a: 1 }, 0);
  assert.equal(memoria.size, 0);
  assert.equal(redis.dentro.size, 0);
  assert.deepEqual(redis.chamadas, [], 'nem chegou a tentar');
});

test('keys junta as duas camadas sem repetir', async () => {
  const redis = new Espiao();
  redis.dentro.set('resp:a', 1);
  redis.dentro.set('resp:b', 1);
  const memoria = new MemoryCache();
  await memoria.set('resp:b', 1, 60);
  await memoria.set('resp:c', 1, 60);

  const c = new CacheEmCamadas({ rapida: memoria, duravel: redis });
  assert.deepEqual(await c.keys('resp:'), ['resp:a', 'resp:b', 'resp:c']);
});

test('o nome diz que o Redis entrou ATRÁS da memória, não no lugar dela', async () => {
  const c = new CacheEmCamadas({ rapida: new MemoryCache(), duravel: new Espiao() });
  assert.equal(c.nome, 'MemoryCache+Espiao');
});
