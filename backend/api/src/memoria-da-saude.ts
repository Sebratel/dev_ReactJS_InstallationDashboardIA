// A memória da API, separada por DONO, para o bloco `memoria` de `GET /api/saude`.
//
// **Por que existe (16/10/2026).** A API chegou ao teto do contêiner (3 GB: heap do
// processo principal em 1536 MB, 2 workers com `maxOldGenerationSizeMb` 512) e a saúde
// só dizia `rssMB` e `heapUsedMB` do processo. Os dois juntos não respondem a única
// pergunta que importava naquela hora — QUEM encheu:
//
//   - o RSS é a soma de tudo e não diz de quem;
//   - o `heapUsed` da thread principal não enxerga as colunas dos datasets, que são
//     `Int32Array`/`Float64Array` e moram FORA do heap (`external`/`arrayBuffers`);
//   - e não enxerga nada das workers: cada worker é uma isolate própria, com heap e
//     buffers próprios, invisíveis para `process.memoryUsage()` chamado na principal.
//
// Este arquivo dá os números de uma isolate (`medeIsolate`, chamado na principal E dentro
// de cada worker) e o protocolo da pergunta que a principal faz à worker. Fica num arquivo
// próprio, e não dentro de `servidor.ts`/`worker-calculador.ts`, porque os dois lados
// precisam do MESMO tipo — e os dois arquivos grandes são onde mais gente mexe ao mesmo
// tempo.

import type { MessagePort } from 'node:worker_threads';
import v8 from 'node:v8';

/** Bytes → MB inteiro, a mesma unidade que `rssMB`/`heapUsedMB` sempre usaram na saúde. */
export function mb(bytes: number): number {
  return Math.round(bytes / 1048576);
}

/**
 * O que uma isolate gasta, medido DENTRO dela.
 *
 * **Sem `rss` de propósito.** Worker thread não é processo: `process.memoryUsage().rss`
 * chamado dentro de uma worker devolve o RSS do PROCESSO INTEIRO, igual ao da principal.
 * Publicá-lo por worker faria a soma "principal + workers" contar o processo três vezes.
 * Os outros quatro números são da isolate que mede: `heapUsed`/`heapTotal` vêm do heap
 * V8 dela, `external` da memória externa que ela registrou, e `arrayBuffers` do alocador
 * de `ArrayBuffer` dela — o Node dá um alocador por isolate, e é ali que caem as colunas
 * do snapshot que a worker carregou.
 *
 * `heapLimiteMB` é o teto do heap (`--max-old-space-size` na principal,
 * `resourceLimits.maxOldGenerationSizeMb` na worker, mais as gerações novas). Vem junto
 * porque `heapUsedMB: 480` só assusta ao lado de `heapLimiteMB: 560`.
 */
export interface MemoriaDaIsolate {
  heapUsedMB: number;
  heapTotalMB: number;
  heapLimiteMB: number;
  externalMB: number;
  arrayBuffersMB: number;
}

export function medeIsolate(): MemoriaDaIsolate {
  const m = process.memoryUsage();
  return {
    heapUsedMB: mb(m.heapUsed),
    heapTotalMB: mb(m.heapTotal),
    heapLimiteMB: mb(v8.getHeapStatistics().heap_size_limit),
    externalMB: mb(m.external),
    arrayBuffersMB: mb(m.arrayBuffers),
  };
}

/** A principal pode publicar o RSS: nela ele é, de fato, o do processo. */
export interface MemoriaDoProcesso extends MemoriaDaIsolate {
  rssMB: number;
}

export function medeProcesso(): MemoriaDoProcesso {
  return { rssMB: mb(process.memoryUsage().rss), ...medeIsolate() };
}

/**
 * A pergunta da principal a uma worker: "quanto você está gastando?".
 *
 * **A resposta volta pela `porta`, não pelo `parentPort`.** O `parentPort` é o canal dos
 * cálculos, e `PiscinaWorkers` trata QUALQUER mensagem que chega por ele como a resposta
 * da tarefa em curso daquela worker. Uma medida de memória que voltasse por ali resolveria
 * o pedido de página de alguém com um objeto que não é página. Com um `MessageChannel`
 * por pergunta, o canal dos cálculos não muda uma linha.
 */
export interface MensagemDeMemoria {
  tipo: 'memoria';
  porta: MessagePort;
}

/** O que a worker responde pela `porta`. */
export interface MedidaDaWorker extends MemoriaDaIsolate {
  /** `threadId` da worker — o mesmo que já sai em `carga.worker` nas respostas de cálculo. */
  threadId: number;
  /** Datasets guardados no `cacheDeCarga` desta worker (as colunas que pesam). */
  datasets: number;
  /** O `CacheDeVisual` desta worker — o orçamento dela, separado do da principal. */
  visuais: { itens: number; mb: number };
}

/**
 * Uma worker vista pela saúde: a última medida que ela mandou e há quanto tempo.
 *
 * `medida: null` = esta worker nunca respondeu (acabou de nascer, ou está num cálculo
 * desde antes da primeira pergunta). `idadeMs` grande = ela está ocupada AGORA e o
 * número é de antes — que é exatamente o caso em que a memória sobe, por isso a medida
 * velha é publicada com a idade em vez de sumir.
 */
export interface MemoriaDeWorkerNaSaude {
  threadId: number;
  idadeMs: number | null;
  medida: MedidaDaWorker | null;
}

/**
 * Quantas entradas o cache de respostas guarda NESTE processo, ou `null` quando o
 * adapter não sabe dizer (um Redis puro: as entradas não moram aqui).
 *
 * Por pato, e não por `instanceof`: `MemoryCache` tem `size`, e `CacheEmCamadas` expõe
 * o `size` da camada rápida em `entradasNaMemoria` — o que conta para a RAM da API é
 * só a camada que mora no processo.
 */
export function entradasDoCache(adapter: unknown): number | null {
  const a = adapter as { size?: unknown; entradasNaMemoria?: unknown } | null;
  if (typeof a?.size === 'number') return a.size;
  if (typeof a?.entradasNaMemoria === 'number') return a.entradasNaMemoria;
  return null;
}
