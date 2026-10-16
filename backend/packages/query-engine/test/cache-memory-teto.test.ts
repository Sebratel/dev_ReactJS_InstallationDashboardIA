// O teto opcional do `MemoryCache` (16/10/2026). O contrato de sempre continua em
// `cache.test.ts`; aqui fica o que o teto muda — e a prova de que, SEM opções, ele
// não muda nada (`tools/snapshot` e `tools/mrun` dependem disso).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCache } from '../src/cache-memory.ts';
import type { Clock } from '../src/types.ts';

class FakeClock implements Clock {
  #t = 1_000_000;
  now() {
    return this.#t;
  }
  advanceSeconds(s: number) {
    this.#t += s * 1000;
  }
}

/** Medidor de brinquedo: o valor É o tamanho. Deixa a conta do teto legível no teste. */
const tamanhoDe = (v: unknown): number => (typeof v === 'number' ? v : 100);
/** O que o cache soma por chave além do valor (`16 + 2 × caracteres`). Chaves de 1 caractere. */
const CHAVE = 18;

test('sem opções: não poda nada, nem com milhares de entradas', async () => {
  const c = new MemoryCache();
  for (let i = 0; i < 5000; i++) await c.set(`k${i}`, { i }, 60);
  assert.equal(c.size, 5000);
  assert.equal(c.despejadas, 0);
  assert.equal(c.bytes, 0, 'sem teto não mede — não paga o medidor');
  assert.deepEqual(await c.get('k0'), { i: 0 });
});

test('tetoBytes sem tamanhoDe: erra alto na construção', () => {
  assert.throws(() => new MemoryCache(undefined, { tetoBytes: 1000 }), /tamanhoDe/);
});

test('tetoEntradas: sai a menos usada recentemente', async () => {
  const c = new MemoryCache(undefined, { tetoEntradas: 2 });
  await c.set('a', 1, 60);
  await c.set('b', 2, 60);
  await c.set('c', 3, 60);
  assert.equal(c.size, 2);
  assert.equal(await c.get('a'), undefined, 'a, a mais antiga, saiu');
  assert.equal(await c.get('b'), 2);
  assert.equal(await c.get('c'), 3);
  assert.equal(c.despejadas, 1);
});

test('get promove: a lida há pouco sobrevive à poda, a esquecida sai', async () => {
  const c = new MemoryCache(undefined, { tetoEntradas: 2 });
  await c.set('a', 1, 60);
  await c.set('b', 2, 60);
  await c.get('a'); // agora 'b' é a menos usada
  await c.set('c', 3, 60);
  assert.equal(await c.get('a'), 1);
  assert.equal(await c.get('b'), undefined);
  assert.equal(await c.get('c'), 3);
});

test('tetoBytes: poda pela conta de bytes, e a conta acompanha set/del/sobrescrita', async () => {
  const c = new MemoryCache(undefined, { tetoBytes: 3 * (100 + CHAVE), tamanhoDe });
  await c.set('a', 100, 60);
  await c.set('b', 100, 60);
  await c.set('c', 100, 60);
  assert.equal(c.size, 3);
  assert.equal(c.bytes, 3 * (100 + CHAVE));

  await c.set('d', 100, 60);
  assert.equal(c.size, 3);
  assert.equal(await c.get('a'), undefined);

  // Sobrescrever não conta duas vezes a mesma chave.
  await c.set('d', 50, 60);
  assert.equal(c.bytes, 2 * (100 + CHAVE) + 50 + CHAVE);

  await c.del('b');
  await c.delMany(['c', 'nao-existe']);
  assert.equal(c.bytes, 50 + CHAVE);
  assert.equal(c.size, 1);
});

test('valor maior que o teto inteiro não entra — e não deixa a versão antiga no lugar', async () => {
  const c = new MemoryCache(undefined, { tetoBytes: 200, tamanhoDe });
  await c.set('a', 50, 60);
  await c.set('x', 10, 60);
  await c.set('x', 1000, 60);
  assert.equal(await c.get('x'), undefined);
  assert.equal(await c.get('a'), 50, 'quem já estava não paga pela recusada');
  assert.equal(c.bytes, 50 + CHAVE);
});

test('vencidas saem primeiro: a poda não despeja válida enquanto houver vencida', async () => {
  const clock = new FakeClock();
  const c = new MemoryCache(clock, { tetoEntradas: 2 });
  await c.set('velha-valida', 1, 3600);
  await c.set('vai-vencer', 2, 10);
  clock.advanceSeconds(11);
  // 'velha-valida' é a menos usada, mas 'vai-vencer' já venceu: sai esta.
  await c.set('nova', 3, 60);
  assert.equal(c.size, 2);
  assert.equal(await c.get('velha-valida'), 1);
  assert.equal(await c.get('nova'), 3);
  assert.equal(c.despejadas, 0, 'vencida não conta como despejo');
});

test('vencida sai da conta de bytes também no get e no keys', async () => {
  const clock = new FakeClock();
  const c = new MemoryCache(clock, { tetoBytes: 10_000, tamanhoDe });
  await c.set('a', 100, 10);
  await c.set('b', 100, 10);
  clock.advanceSeconds(11);
  assert.equal(await c.get('a'), undefined);
  assert.equal(c.bytes, 100 + CHAVE);
  assert.deepEqual(await c.keys(''), []);
  assert.equal(c.bytes, 0);
});

test('o mesmo objeto em duas chaves é medido uma vez só (e contado duas)', async () => {
  let medidas = 0;
  const c = new MemoryCache(undefined, {
    tetoBytes: 10_000,
    tamanhoDe: () => {
      medidas++;
      return 100;
    },
  });
  const corpo = { linhas: [1, 2, 3] };
  await c.set('a', corpo, 60);
  await c.set('b', corpo, 3600);
  assert.equal(medidas, 1);
  assert.equal(c.bytes, 2 * (100 + CHAVE), 'conservador: cada chave paga o objeto inteiro');
});
