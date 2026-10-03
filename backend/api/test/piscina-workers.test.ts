// O contrato de MEMÓRIA da API, e por que ele merece teste próprio.
//
// Uma worker thread não obedece ao `--max-old-space-size` do processo pai: ela
// carrega o seu próprio `resourceLimits.maxOldGenerationSizeMb`. Até 04/09/2026
// esse número era o literal `8192` escrito dentro do laço que cria as workers,
// e o tamanho da piscina era `min(4, cpus)` — ou seja, sob o pai de 10240 MB do
// Dockerfile, o processo estava **autorizado a pedir 42 GB** numa máquina de 16.
//
// Medido no mesmo dia: 6.625 MB de RSS depois de abrir as 14 páginas, com o pai
// retendo 33 MB — o heap era todo das workers, crescido e não devolvido ao SO.
//
// O defeito não era o número ser alto. Era ele ser IMPLÍCITO: `mem_limit` do
// compose (e o dimensionamento da máquina no Portainer) tem de ser derivado
// desses dois valores, e não se deriva de um literal escondido. Estes testes
// falham se ele voltar a ser um.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PADRAO_HEAP_POR_WORKER_MB,
  PADRAO_TAMANHO_POOL,
  configuracaoDaPiscina,
} from '../src/piscina-workers.ts';

test('sem variável de ambiente, o par (workers, heap) vem dos padrões nomeados', () => {
  const c = configuracaoDaPiscina({}, 16);
  assert.equal(c.tamanhoPool, PADRAO_TAMANHO_POOL);
  assert.equal(c.heapPorWorkerMB, PADRAO_HEAP_POR_WORKER_MB);
});

/**
 * O teto do container, em MB. É o `mem_limit` de `docker-compose.prod.yml`, e
 * está repetido aqui de propósito: um número que vive só no YAML não tem quem o
 * defenda quando alguém dobra `API_WORKERS` "só para testar".
 */
const MEM_LIMIT_CONTAINER_MB = 6144; // mem_limit: 6g
const TETO_PAI_MB = 3072; // --max-old-space-size do Dockerfile

test('o heap autorizado pelos padrões cabe dentro do mem_limit do container', () => {
  // O guarda que faltava, e a conta que ele guarda:
  //
  //   pai 3072 + 2 workers × 768 = 4608 MB de heap autorizado
  //   mem_limit 6144 MB           = 1536 MB de folga para o que NÃO é heap
  //                                 (buffers do .jsonl.gz, runtime do Node,
  //                                  overhead do V8, pilha das threads)
  //
  // RSS pico medido nessa faixa: 3137–3622 MB (`probe:memoria-api`, 04/09/2026).
  //
  // Se alguém subir um dos padrões sem mexer no outro, o container passa a ser
  // morto pelo OOM killer do host — falha que aparece como "a página às vezes
  // não abre", não como erro de configuração. Este teste falha antes.
  const c = configuracaoDaPiscina({}, 16);
  const totalAutorizadoMB = TETO_PAI_MB + c.tamanhoPool * c.heapPorWorkerMB;

  assert.ok(
    totalAutorizadoMB <= MEM_LIMIT_CONTAINER_MB,
    `os padrões autorizam ${totalAutorizadoMB} MB de heap e o mem_limit é ` +
      `${MEM_LIMIT_CONTAINER_MB} MB. Mexeu em API_WORKERS ou API_WORKER_HEAP_MB? ` +
      `Ajuste mem_limit (docker-compose.prod.yml), o --max-old-space-size do ` +
      `Dockerfile e MEM_LIMIT_CONTAINER_MB aqui, no mesmo commit.`,
  );

  // E a folga tem de sobrar: heap autorizado igual ao mem_limit significa
  // container morto no primeiro buffer fora do heap.
  const folgaMB = MEM_LIMIT_CONTAINER_MB - totalAutorizadoMB;
  assert.ok(
    folgaMB >= 1024,
    `sobram só ${folgaMB} MB para o que não é heap (buffers, runtime, V8). ` +
      `O piso é 1024 MB — medido: o RSS chega a 3622 MB com 4608 autorizado.`,
  );
});

test('o piso do processo pai é conhecido, e 2048 MB não basta', () => {
  // Medido em 04/09/2026 (`probe:memoria-api --pai=1024,1536,2048 --heap=768`):
  // as três estouram o heap na PRIMEIRA página, com `RSS pico` colado no teto
  // do pai (1198 / 1730 / 2270 MB). Com 3072 as 10 páginas passam.
  //
  // Este teste não mede nada — ele guarda o número contra a tentação de
  // "apertar mais um pouco" sem rodar a sonda. Se alguém baixar TETO_PAI_MB,
  // tem de baixar aqui também, e aí lê o porquê.
  assert.ok(
    TETO_PAI_MB >= 3072,
    `2048 MB de heap no pai estoura na primeira página (medido). ` +
      `Rode 'npm run probe:memoria-api --pai=<novo>' antes de baixar isto.`,
  );
});

test('API_WORKERS e API_WORKER_HEAP_MB sobrepõem os padrões', () => {
  const c = configuracaoDaPiscina({ API_WORKERS: '3', API_WORKER_HEAP_MB: '1536' }, 16);
  assert.equal(c.tamanhoPool, 3);
  assert.equal(c.heapPorWorkerMB, 1536);
});

test('o nº de workers nunca passa do nº de CPUs', () => {
  // Pedir 8 workers numa máquina de 2 vCPU (o caso do container no Portainer)
  // não acelera nada e multiplica o heap autorizado por 4.
  assert.equal(configuracaoDaPiscina({ API_WORKERS: '8' }, 2).tamanhoPool, 2);
});

test('valor inválido cai no padrão em vez de virar NaN ou zero', () => {
  // `API_WORKERS=` vazio é o caso real de um `.env` copiado do exemplo com a
  // linha presente e sem valor. Zero workers desativaria a piscina em silêncio
  // e toda página passaria a ser calculada na thread do servidor.
  for (const bruto of ['', '   ', '0', '-4', 'quatro', 'NaN']) {
    const c = configuracaoDaPiscina({ API_WORKERS: bruto, API_WORKER_HEAP_MB: bruto }, 16);
    assert.equal(c.tamanhoPool, PADRAO_TAMANHO_POOL, `API_WORKERS=${JSON.stringify(bruto)}`);
    assert.equal(
      c.heapPorWorkerMB,
      PADRAO_HEAP_POR_WORKER_MB,
      `API_WORKER_HEAP_MB=${JSON.stringify(bruto)}`,
    );
  }
});

test('lê de process.env quando nenhum ambiente é passado', () => {
  // A sobrecarga com valor-padrão é o que a piscina usa de verdade no
  // construtor; se ela deixar de ler o ambiente, a configuração do Portainer
  // passa a ser ignorada sem erro nenhum.
  const antes = process.env.API_WORKERS;
  try {
    process.env.API_WORKERS = '1';
    assert.equal(configuracaoDaPiscina().tamanhoPool, 1);
  } finally {
    if (antes === undefined) delete process.env.API_WORKERS;
    else process.env.API_WORKERS = antes;
  }
});
