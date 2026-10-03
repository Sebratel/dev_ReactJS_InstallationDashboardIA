// O disjuntor do cache durável — ver o cabeçalho de src/cache-disjuntor.ts.
//
// **O defeito que estes testes guardam.** Um Redis inalcançável não derrubava a
// API: cada operação falhava e a memória servia. Só que falhar custava o
// `connectTimeout` do ioredis (10 s por padrão), em toda operação de todo
// pedido — trocar um filtro passava de 1,6 s para 13–20 s, com `/api/saude`
// dizendo `ok` o tempo inteiro.
//
// O que precisa ficar guardado: com o circuito aberto, o Redis NÃO é tocado; a
// resposta é miss na hora; e ele volta sozinho quando o Redis volta.

import assert from 'node:assert/strict';
import test from 'node:test';
import { CacheComDisjuntor } from '../src/cache-disjuntor.ts';
import type { Cache } from '../src/types.ts';

/** Um Redis de mentira que erra enquanto `quebrado` for true, e conta as visitas. */
function redisDeMentira(): { cache: Cache; visitas: () => number; conserta: () => void; quebra: () => void } {
  let quebrado = true;
  let visitas = 0;
  const bate = async <T>(valor: T): Promise<T> => {
    visitas += 1;
    if (quebrado) throw new Error('ECONNREFUSED');
    return valor;
  };
  return {
    visitas: () => visitas,
    conserta: () => {
      quebrado = false;
    },
    quebra: () => {
      quebrado = true;
    },
    cache: {
      get: async <T>() => bate<T | undefined>(undefined),
      set: async () => bate<void>(undefined),
      del: async () => bate<void>(undefined),
      delMany: async () => bate(0),
      keys: async () => bate<string[]>([]),
    },
  };
}

test('o circuito abre depois do limite, e as operações seguintes NÃO tocam o Redis', async () => {
  // O TESTE QUE MAIS IMPORTA: sem isto, cada pedido paga o tempo de espera do
  // ioredis de novo — foram 11 s por pedido, medidos.
  const r = redisDeMentira();
  const linhas: string[] = [];
  const c = new CacheComDisjuntor(r.cache, { limite: 3, janelaMs: 10_000, anuncia: (l) => linhas.push(l) });

  for (let i = 0; i < 3; i++) await c.get('k').catch(() => {});
  assert.equal(r.visitas(), 3, 'as três primeiras tinham de tentar de verdade');
  assert.equal(c.estado().estado, 'aberto');

  for (let i = 0; i < 20; i++) assert.equal(await c.get('k'), undefined);
  assert.equal(r.visitas(), 3, `o Redis foi tocado ${r.visitas()} vezes — com o circuito aberto, tem de ser 3`);
  assert.equal(c.estado().desviadas, 20);
  assert.equal(linhas.length, 1, 'uma linha por abertura, não uma por falha');
  assert.match(linhas[0]!, /desligado do caminho/);
});

test('com o circuito aberto, cada operação devolve o vazio do seu tipo', async () => {
  // Miss é seguro: este é cache de leitura, então custa recálculo e nunca número
  // errado. O que não pode é lançar e derrubar o pedido.
  const r = redisDeMentira();
  const c = new CacheComDisjuntor(r.cache, { limite: 1, anuncia: () => {} });
  await c.get('k').catch(() => {});

  assert.equal(await c.get('k'), undefined);
  assert.equal(await c.set('k', 1, 60), undefined);
  assert.equal(await c.del('k'), undefined);
  assert.equal(await c.delMany(['a', 'b']), 0);
  assert.deepEqual(await c.keys('p'), []);
});

test('passada a janela, UMA operação sonda — e o Redis que voltou fecha o circuito', async () => {
  const r = redisDeMentira();
  const linhas: string[] = [];
  let agora = 1000;
  const c = new CacheComDisjuntor(r.cache, {
    limite: 2,
    janelaMs: 5000,
    agora: () => agora,
    anuncia: (l) => linhas.push(l),
  });

  await c.get('k').catch(() => {});
  await c.get('k').catch(() => {});
  assert.equal(c.estado().estado, 'aberto');
  await c.get('k');
  assert.equal(r.visitas(), 2, 'dentro da janela ninguém bate no Redis');

  agora += 5000; // a janela passou
  r.conserta();
  assert.equal(await c.get('k'), undefined);
  assert.equal(r.visitas(), 3, 'a sonda TEM de bater de verdade');
  assert.equal(c.estado().estado, 'fechado');
  assert.equal(c.estado().falhasSeguidas, 0);
  assert.match(linhas.at(-1)!, /voltou a responder/);

  await c.get('k');
  assert.equal(r.visitas(), 4, 'fechado, tudo volta a passar');
});

test('a sonda que falha de novo REABRE, sem enxurrada de linha', async () => {
  const r = redisDeMentira();
  const linhas: string[] = [];
  let agora = 0;
  const c = new CacheComDisjuntor(r.cache, {
    limite: 2,
    janelaMs: 1000,
    agora: () => agora,
    anuncia: (l) => linhas.push(l),
  });

  for (let volta = 0; volta < 4; volta++) {
    agora += 1000;
    await c.get('k').catch(() => {});
    await c.get('k').catch(() => {});
  }
  assert.ok(c.estado().aberturas >= 2, 'reabriu a cada janela');
  assert.equal(
    linhas.length,
    c.estado().aberturas,
    `${linhas.length} linhas para ${c.estado().aberturas} aberturas — uma por abertura`,
  );
});

test('sucesso desde o começo não abre nada, e não custa nada', async () => {
  const r = redisDeMentira();
  r.conserta();
  const c = new CacheComDisjuntor(r.cache, { limite: 2, anuncia: () => {} });
  for (let i = 0; i < 10; i++) await c.get('k');
  const e = c.estado();
  assert.equal(e.estado, 'fechado');
  assert.equal(e.aberturas, 0);
  assert.equal(e.desviadas, 0);
  assert.equal(r.visitas(), 10);
});

test('a falha ainda SOBE enquanto o circuito está fechado — quem envolve é que decide engolir', async () => {
  // `CacheDeResposta` já trata erro como miss e registra na saúde do Redis. Se o
  // disjuntor engolisse por conta própria, aquele caminho pararia de contar
  // falha e `/api/saude` voltaria a dizer que está tudo bem.
  const r = redisDeMentira();
  const c = new CacheComDisjuntor(r.cache, { limite: 99, anuncia: () => {} });
  await assert.rejects(() => c.get('k'), /ECONNREFUSED/);
});
