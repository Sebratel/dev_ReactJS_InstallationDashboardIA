// Os tetos do que a API guarda em memória (16/10/2026, `memoria-limitada.ts`).
//
// O defeito que eles fecham não dá erro nem deixa teste vermelho: a memória só
// cresce, carimbo após carimbo, até o contêiner morrer. Por isso os testes afirmam a
// PODA — o que sai, e em que ordem — e não apenas que o valor volta.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  leTetoDaResposta,
  MapaLru,
  memoriaDaResposta,
  TETO_RESPOSTA_PADRAO_MB,
  TETO_VALORES_PADRAO,
} from '../src/memoria-limitada.ts';
import { estimaBytes } from '../src/cache-visual.ts';
import type { CacheDeResposta } from '../src/cache-resposta.ts';
import { Servidor } from '../src/servidor.ts';
import { ACESSO_LIBERADO } from './fixtures/acesso.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Um corpo de resposta de ~`kb` KB pela conta de `estimaBytes`. */
function corpoDe(kb: number): { texto: string } {
  return { texto: 'x'.repeat(Math.floor((kb * 1024) / 2)) };
}

// ------------------------------------------------------------ CACHE_RESPOSTA_MB

test('CACHE_RESPOSTA_MB: ausente ou vazia vale o padrão, sem aviso', () => {
  assert.deepEqual(leTetoDaResposta(undefined), { mb: TETO_RESPOSTA_PADRAO_MB });
  assert.deepEqual(leTetoDaResposta('  '), { mb: TETO_RESPOSTA_PADRAO_MB });
});

test('CACHE_RESPOSTA_MB: número positivo vale', () => {
  assert.deepEqual(leTetoDaResposta('64'), { mb: 64 });
  assert.deepEqual(leTetoDaResposta('0.5'), { mb: 0.5 });
});

test('CACHE_RESPOSTA_MB: zero, negativo ou lixo NÃO desliga — vira o padrão, com aviso', () => {
  for (const bruto of ['0', '-1', 'muito', 'NaN', 'Infinity']) {
    const r = leTetoDaResposta(bruto);
    assert.equal(r.mb, TETO_RESPOSTA_PADRAO_MB, bruto);
    assert.match(r.aviso ?? '', /CACHE_RESPOSTA_MB/, bruto);
  }
});

// ------------------------------------------------------------ memória da resposta

test('memoriaDaResposta: mede com estimaBytes e despeja a menos usada ao passar do teto', async () => {
  const c = memoriaDaResposta(1); // 1 MB estimado
  await c.set('p1', corpoDe(400), 60);
  await c.set('p2', corpoDe(400), 60);
  await c.get('p1'); // p2 vira a menos usada
  await c.set('p3', corpoDe(400), 60);
  assert.ok(c.bytes <= 1024 * 1024, `ficou em ${c.bytes} bytes`);
  assert.notEqual(await c.get('p1'), undefined);
  assert.equal(await c.get('p2'), undefined);
  assert.notEqual(await c.get('p3'), undefined);
  assert.ok(c.bytes >= 2 * estimaBytes(corpoDe(400)), 'a conta usa o medidor da API');
});

test('Servidor sem cache de fora: a memória padrão tem teto', async () => {
  // Sem Redis, o `Servidor` monta a própria memória — e era ali que o `Map` sem
  // limite crescia no `npm run api`. 1 MB de teto, três corpos de 400 KB: o
  // primeiro tem de sair.
  const servidor = new Servidor({
    acesso: ACESSO_LIBERADO,
    root: ROOT,
    snapshotDir: fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-limitada-')),
    webDir: path.join(ROOT, 'frontend', 'dist'),
    tetoDoCacheDeRespostaMB: 1,
  });
  try {
    const cache = (servidor as unknown as { cache: CacheDeResposta }).cache;
    await cache.guarda('resp:a', corpoDe(400), 60);
    await cache.guarda('resp:b', corpoDe(400), 60);
    await cache.guarda('resp:c', corpoDe(400), 60);
    assert.equal(await cache.le('resp:a'), undefined);
    assert.notEqual(await cache.le('resp:c'), undefined);

    const valores = (servidor as unknown as { cacheValoresDistintos: Map<string, unknown> }).cacheValoresDistintos;
    assert.ok(valores instanceof MapaLru, 'cacheValoresDistintos tem de ter teto');
    assert.equal((valores as MapaLru<string, unknown>).teto, TETO_VALORES_PADRAO);
  } finally {
    servidor.destroi();
  }
});

// ------------------------------------------------------------ MapaLru

test('MapaLru: passa do teto, sai a menos usada', () => {
  const m = new MapaLru<string, number>(2);
  m.set('a', 1).set('b', 2).set('c', 3);
  assert.equal(m.size, 2);
  assert.equal(m.has('a'), false);
  assert.deepEqual([...m.keys()], ['b', 'c']);
});

test('MapaLru: get promove; has não', () => {
  const m = new MapaLru<string, number>(2);
  m.set('a', 1);
  m.set('b', 2);
  assert.equal(m.get('a'), 1); // 'b' vira a menos usada
  m.set('c', 3);
  assert.deepEqual([...m.keys()].sort(), ['a', 'c']);
  assert.equal(m.get('nao-existe'), undefined);
});

test('MapaLru: regravar a mesma chave não ocupa duas vagas', () => {
  const m = new MapaLru<string, number>(2);
  m.set('a', 1);
  m.set('b', 2);
  m.set('a', 10);
  assert.equal(m.size, 2);
  assert.equal(m.get('a'), 10);
  assert.equal(m.get('b'), 2);
});

test('MapaLru: a limpeza por página de `esqueceAPagina` (keys + delete) continua funcionando', () => {
  const m = new MapaLru<string, number>(10);
  m.set('pag1\u0000t\u0000c', 1);
  m.set('pag2\u0000t\u0000c', 2);
  for (const k of [...m.keys()]) if (k.startsWith('pag1\u0000')) m.delete(k);
  assert.deepEqual([...m.keys()], ['pag2\u0000t\u0000c']);
});
