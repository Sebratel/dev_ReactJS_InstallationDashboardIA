// `CacheDeCarga` (cache-de-carga.ts) — a ordem de soltar e carregar dataset numa worker.
//
// **O que este arquivo guarda.** Até 16/10/2026 a poda do `cacheDeCarga` acontecia
// DEPOIS de a carga nova começar, e nenhuma worker chamava o coletor: durante a carga
// ficavam o vivo, o que montava e o descartado esperando o V8 — 3 datasets de
// 250 MB–1 GB por worker, parte fora do heap. Os testes provam, com cargas de mentira:
// que no instante em que uma carga começa nunca há mais que `teto` datasets vivos
// (contando o descartado ainda não coletado); que o coletor roda antes da carga e só
// quando houve descarte; e que um dataset que um cálculo em curso lê nunca é podado.
//
// "Vivo" aqui = guardado no cache, ou descartado e ainda não coletado. É a conta que a
// memória do container faz; o tamanho do `Map` sozinho não a enxerga.

import assert from 'node:assert/strict';
import test from 'node:test';
import { CacheDeCarga, coletorDaWorker } from '../src/cache-de-carga.ts';

/**
 * Um cache com teto `teto` e a conta de datasets VIVOS no sentido acima: a carga anota
 * quantos estavam vivos no instante em que começou, e a coleta de mentira mata tudo o
 * que o cache já não guarda (o cache só a chama quando ninguém está lendo dataset).
 */
function montagem(teto: number): {
  cache: CacheDeCarga<string>;
  pede: (chave: string) => Promise<void>;
  vivosNoInicio: number[];
  coletas: () => number;
} {
  const vivos = new Set<string>();
  const vivosNoInicio: number[] = [];
  let coletas = 0;
  const cache: CacheDeCarga<string> = new CacheDeCarga<string>({
    teto,
    coleta: () => {
      coletas += 1;
      const guardadas = new Set(cache.chaves());
      for (const v of [...vivos]) if (!guardadas.has(v)) vivos.delete(v);
    },
  });
  return {
    cache,
    pede: async (chave) => {
      const uso = cache.usa(chave, () => {
        vivosNoInicio.push(vivos.size);
        vivos.add(chave);
        return Promise.resolve(chave);
      });
      await uso.promessa;
      uso.solta();
    },
    vivosNoInicio,
    coletas: () => coletas,
  };
}

test('a poda vem ANTES da carga: com teto 2 nunca há 3 datasets vivos', async () => {
  const m = montagem(2);
  // Páginas se alternando como num aquecimento: A, B, C, A, D…
  for (const k of ['A', 'B', 'C', 'A', 'D', 'B', 'C']) await m.pede(k);
  assert.equal(m.cache.tamanho, 2);
  // Toda carga começa com no máximo `teto - 1` vivos: a nova cabe sem passar do teto.
  // Na ordem antiga (carrega, grava, poda) a 3ª carga começava com 2 vivos — e mais o
  // descartado esperando o V8, que esta conta (sem coletor) também enxergaria.
  assert.deepEqual(m.vivosNoInicio, [0, 1, 1, 1, 1, 1, 1], 'uma carga começou com o descartado ainda vivo');
  assert.equal(m.coletas(), 5, 'um descarte, uma coleta — cinco cargas acima do teto');
});

test('o coletor não roda em acerto do cache nem sem descarte', async () => {
  let coletas = 0;
  const cache = new CacheDeCarga<string>({ teto: 2, coleta: () => (coletas += 1) });
  for (const k of ['A', 'B', 'A', 'B', 'A']) {
    const uso = cache.usa(k, () => Promise.resolve(k));
    await uso.promessa;
    uso.solta();
  }
  assert.equal(coletas, 0, 'o coletor rodou sem nenhum dataset descartado');
  assert.equal(cache.tamanho, 2);
});

test('dataset em uso nunca é podado: o próximo pedido da mesma página não carrega outra cópia', async () => {
  const cargas: string[] = [];
  const cache = new CacheDeCarga<string>({ teto: 2 });
  const carga = (k: string) => () => {
    cargas.push(k);
    return Promise.resolve(k);
  };
  const usoA = cache.usa('A', carga('A')); // em uso até o fim do teste
  await usoA.promessa;
  const usoB = cache.usa('B', carga('B'));
  await usoB.promessa;
  usoB.solta();

  // C erra o cache: a mais antiga é A, mas A está sendo lida — sai B.
  const usoC = cache.usa('C', carga('C'));
  await usoC.promessa;
  usoC.solta();

  // A continua guardada: pedir A de novo NÃO é uma carga nova.
  const usoA2 = cache.usa('A', carga('A'));
  assert.equal(usoA2.nova, false, 'A foi podada em uso e o pedido seguinte carregou outra cópia');
  assert.equal(usoA2.promessa, usoA.promessa);
  usoA2.solta();
  usoA.solta();
  assert.deepEqual(cargas, ['A', 'B', 'C']);
  assert.equal(cache.tamanho, 2);
});

test('tudo em uso: o teto cede durante o cálculo e volta quando ele solta, com coleta', async () => {
  let coletas = 0;
  const cache = new CacheDeCarga<string>({ teto: 1, coleta: () => (coletas += 1) });
  const usoA = cache.usa('A', () => Promise.resolve('A'));
  const usoB = cache.usa('B', () => Promise.resolve('B'));
  await Promise.all([usoA.promessa, usoB.promessa]);
  assert.equal(cache.tamanho, 2, 'A em uso não podia sair para B entrar');
  assert.equal(coletas, 0, 'o coletor não roda com cálculo lendo dataset');
  usoA.solta();
  assert.equal(cache.tamanho, 1, 'soltar A tem de devolver o cache ao teto');
  assert.equal(coletas, 0, 'B ainda está em uso: coletar agora pararia o cálculo dele');
  usoB.solta();
  assert.equal(coletas, 1, 'com ninguém lendo, o descarte de A é coletado');
});

test('invalidação em uso: a entrada sai na hora, a coleta espera o cálculo soltar', async () => {
  let coletas = 0;
  const cache = new CacheDeCarga<string>({ teto: 2, coleta: () => (coletas += 1) });
  const velho = cache.usa('pagina v', () => Promise.resolve('velho'));
  await velho.promessa;

  assert.equal(cache.esquece((k) => k.startsWith('pagina ')), 1);
  assert.equal(cache.tamanho, 0, 'a entrada invalidada não pode servir o pedido seguinte');
  assert.equal(coletas, 0, 'o cálculo em curso ainda segura o dado: coletar agora não colhe nada');

  // Um pedido novo da MESMA chave carrega de novo, e soltar o uso velho não mexe nele.
  const novo = cache.usa('pagina v', () => Promise.resolve('novo'));
  assert.equal(novo.nova, true);
  assert.equal(await novo.promessa, 'novo');
  velho.solta();
  assert.equal(coletas, 0, 'o pedido novo ainda está lendo');
  assert.equal(cache.emUso, 1, 'soltar o uso da promessa velha baixou a contagem da nova');
  novo.solta();
  assert.equal(coletas, 1);
  assert.equal(cache.tamanho, 1);
});

test('carga que falhou sai do cache, e uma invalidação no meio não apaga a carga seguinte', async () => {
  const cache = new CacheDeCarga<string>({ teto: 2 });
  let rejeita!: (e: Error) => void;
  const falha = cache.usa('A', () => new Promise<string>((_, nao) => (rejeita = nao)));
  cache.esquece(() => true);
  const outra = cache.usa('A', () => Promise.resolve('A2'));
  rejeita(new Error('disco'));
  await assert.rejects(falha.promessa, /disco/);
  falha.solta();
  await outra.promessa;
  outra.solta();
  const de_novo = cache.usa('A', () => Promise.resolve('A3'));
  assert.equal(de_novo.nova, false, 'a falha da carga velha apagou a entrada da carga nova');
  de_novo.solta();

  const s = new CacheDeCarga<string>({ teto: 2 });
  const f = s.usa('B', () => Promise.reject(new Error('x')));
  await assert.rejects(f.promessa);
  f.solta();
  assert.equal(s.tamanho, 0, 'a carga que falhou ficou presa no cache');
});

test('coletorDaWorker: só existe com --expose-gc no processo', () => {
  const temGc = typeof (globalThis as { gc?: unknown }).gc === 'function';
  assert.equal(coletorDaWorker() !== null, temGc);
});
