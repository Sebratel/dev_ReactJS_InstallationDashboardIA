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

  assert.ok(falhas.length >= 1, 'a falha não some calada');
  // Uma linha por pausa, e não uma por operação: depois da primeira falha o disjuntor
  // abre e as operações seguintes nem tentam. Ver `#desliga`.
  assert.equal(falhas[0], 'set', 'a primeira operação a bater no Redis caído é a que aparece');
});

/**
 * **O que este teste guarda vale 15 s por miss, medidos.** Com
 * `REDIS_URL=redis://localhost:6379/0` no `.env` e nada escutando nessa porta, cada
 * miss de cache da API custava 15 a 20 s — o `ioredis` reconectando no `get` e de novo
 * no `set`. A falha era engolida e a resposta saía certa; só saía muito depois, e a
 * única pista era uma linha de log que ninguém olhando um dashboard lê.
 */
test('camada durável lenta não segura o pedido: passou do teto, é miss', async () => {
  const falhas: string[] = [];
  /** Um Redis que nunca responde. */
  const LERDO: Cache = {
    get: () => new Promise(() => {}),
    set: () => new Promise(() => {}),
    del: () => new Promise(() => {}),
    delMany: () => new Promise(() => {}),
    keys: () => new Promise(() => {}),
  };

  const c = new CacheEmCamadas({
    rapida: new MemoryCache(),
    duravel: LERDO,
    tempoLimiteMs: 20,
    aoFalhar: (op, err) => falhas.push(`${op}: ${err instanceof Error ? err.message : ''}`),
  });

  const t0 = Date.now();
  await c.set('k', { a: 1 }, 60);
  assert.ok(Date.now() - t0 < 1_000, 'a escrita não esperou o Redis que nunca responde');
  assert.deepEqual(await c.get('k'), { a: 1 }, 'e o valor está lá, vindo da memória');
  assert.ok(falhas[0]?.includes('20 ms'), `a falha diz que foi o teto: ${falhas[0]}`);
});

test('o disjuntor tira o Redis de circulação e o devolve sozinho', async () => {
  let relogio = 1_000;
  const falhas: string[] = [];
  let quedas = 3;
  const chamadas: string[] = [];
  /** Cai as três primeiras vezes; depois volta a funcionar. */
  const INTERMITENTE: Cache = {
    async get<T>(k: string): Promise<T | undefined> {
      chamadas.push(`get ${k}`);
      if (quedas-- > 0) throw new Error('ECONNREFUSED');
      return undefined;
    },
    async set(): Promise<void> {},
    async del(): Promise<void> {},
    async delMany(): Promise<number> {
      return 0;
    },
    async keys(): Promise<string[]> {
      return [];
    },
  };

  const c = new CacheEmCamadas({
    rapida: new MemoryCache(),
    duravel: INTERMITENTE,
    pausaMs: 5_000,
    aoFalhar: (op) => falhas.push(op),
    agora: () => relogio,
  });

  await c.get('a');
  assert.deepEqual(chamadas, ['get a'], 'a primeira tentou');
  assert.equal(c.nome, 'MemoryCache+Object (pausado)', 'a saúde diz que ele está de fora');

  // Dentro da pausa: nem tenta. É isto que impede o teto de ser cobrado por pedido.
  relogio += 4_000;
  await c.get('b');
  await c.get('c');
  assert.deepEqual(chamadas, ['get a'], 'dentro da pausa, nenhuma ida ao Redis');
  assert.equal(falhas.length, 1, 'e nenhuma linha de log repetida');

  // Passada a pausa, tenta de novo — e cai de novo, o que renova a pausa.
  relogio += 2_000;
  await c.get('d');
  assert.deepEqual(chamadas, ['get a', 'get d']);
  assert.equal(falhas.length, 2);

  // Terceira queda, e depois o Redis volta. Ninguém religou nada.
  relogio += 6_000;
  await c.get('e');
  relogio += 6_000;
  await c.get('f');
  assert.equal(c.pausada, false, 'o sucesso fechou o disjuntor');
  assert.equal(c.nome, 'MemoryCache+Object', 'e a saúde volta a dizer que ele serve');

  relogio += 1;
  await c.get('g');
  assert.deepEqual(chamadas, ['get a', 'get d', 'get e', 'get f', 'get g'], 'sem pausa, todas passam');
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
