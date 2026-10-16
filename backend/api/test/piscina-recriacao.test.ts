// A piscina REPÕE a worker que morre sozinha — com freio.
//
// **O defeito que estes testes guardam (16/10/2026).** A worker era criada só
// no construtor. Morta por estouro de heap numa página grande, saía da lista e
// nunca voltava; morrendo as duas, `ativa` virava falso e todo cálculo passava a
// rodar em linha na thread principal, sem limite de concorrência — o caminho
// mais curto para o contêiner de 3 GB estourar com vários usuários.
//
// E as três proteções que a recriação não pode perder:
//   1. `destroi()` não recria (o `'exit'` do próprio `terminate()` não é morte);
//   2. worker morrendo em laço PARA no teto, e o fallback em linha assume;
//   3. a tarefa da worker morta é rejeitada, não reenviada à nova.
//
// Os tempos da política vêm encolhidos (`recriacao`) para a suíte não esperar
// 1 s de backoff nem 10 min de janela; a lógica é a mesma de produção.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { POLITICA_DE_RECRIACAO, PiscinaWorkers } from '../src/piscina-workers.ts';
import { ESCOPO_TODOS } from '../src/escopo-cache.ts';
import type { MensagemCalculoWorker } from '../src/worker-calculador.ts';
import type { DashboardSpec } from '../../packages/widget-engine/src/spec.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SOB_COMANDO = path.join(AQUI, 'fixtures', 'worker-que-morre-sob-comando.ts');
const AO_NASCER = path.join(AQUI, 'fixtures', 'worker-que-morre-ao-nascer.ts');
const MORRE = path.join(AQUI, 'fixtures', 'worker-que-morre.ts');
const RESPONDE = path.join(AQUI, 'fixtures', 'worker-que-responde.ts');
const ESTOURA = path.join(AQUI, 'fixtures', 'worker-que-estoura.ts');

function tarefa(identidade = 'fixture@2026-10-16'): Omit<MensagemCalculoWorker, 'idReq'> {
  return {
    snapshotDir: path.join(AQUI, 'nao-existe'),
    specsDir: path.join(AQUI, 'nao-existe'),
    dashboardSpec: { id: 'fixture', name: 'fixture', visuals: [] } as unknown as DashboardSpec,
    janela: { de: 0, linhas: 10 },
    clicados: [],
    agoraIso: '2026-10-16T12:00:00.000Z',
    identidade,
    escopo: ESCOPO_TODOS,
  };
}

/** Rápido o bastante para a suíte; a janela longa deixa o teto valer o teste inteiro. */
const RAPIDA = { esperaInicialMs: 10, esperaMaximaMs: 40, tetoNaJanela: 3, janelaMs: 60_000 };

/** Espera uma condição virar verdadeira, sem `setTimeout` chutado. */
async function ate(cond: () => boolean, oQue: string, ms = 5000): Promise<void> {
  const limite = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > limite) throw new Error(`${oQue}: não aconteceu em ${ms} ms`);
    await new Promise((ok) => setTimeout(ok, 5));
  }
}

const pausa = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

test('a política de produção: backoff de 1 s a 30 s, teto de 6 em 10 min', () => {
  // Fixado em teste porque é a conta que decide quanto churn de thread (e de
  // heap de worker enchendo antes de cair) a API aceita num laço de OOM.
  assert.deepEqual({ ...POLITICA_DE_RECRIACAO }, {
    esperaInicialMs: 1_000,
    esperaMaximaMs: 30_000,
    tetoNaJanela: 6,
    janelaMs: 600_000,
  });
});

test('worker que morre é REPOSTA: a piscina volta a ter N e volta a calcular', async () => {
  const p = new PiscinaWorkers({ tamanhoPool: 2, scriptDaWorker: SOB_COMANDO, recriacao: RAPIDA });
  try {
    assert.equal(p.estado.workers, 2);
    // A tarefa da worker morta continua REJEITADA (é o que manda o pedido para
    // o cálculo em linha) — a recriação não a reenvia para a nova.
    await assert.rejects(() => p.executa(tarefa('morre')), /terminou com código 7/);
    assert.equal(p.recriacao.mortes, 1);
    assert.match(p.recriacao.ultimaMorte?.motivo ?? '', /código 7/);

    await ate(() => p.estado.workers === 2, 'a reposição');
    assert.equal(p.recriacao.workersRecriadas, 1);
    assert.equal(p.recriacao.suspensa, false);
    assert.equal(p.recriacao.proximaReposicaoEm, null);

    // Contagem de volta a 2 não basta: a reposta tem de pegar trabalho. Duas
    // tarefas ao mesmo tempo ocupam as duas workers.
    const duas = await Promise.all([p.executa(tarefa()), p.executa(tarefa())]);
    for (const r of duas) assert.equal(r.ok, true);
    // Nenhuma tarefa da worker morta foi reexecutada às escondidas.
    assert.equal(p.recriacao.mortes, 1);
  } finally {
    p.destroi();
  }
});

test('com a piscina toda morta, ela fica INATIVA no backoff e depois volta a ATIVA', async () => {
  // O buraco entre a morte e a reposição é coberto pelo fallback de sempre:
  // `ativa` falso manda o pedido para o cálculo em linha, sem esperar.
  //
  // Uma worker só, de propósito. Com duas, "a piscina chegou a zero" depende
  // de as duas morrerem dentro do mesmo backoff — e sob a suíte inteira rodando
  // em paralelo uma worker chegou a demorar mais de 1,5 s para subir e receber
  // a mensagem (medido: a primeira já estava reposta quando a segunda morreu).
  const p = new PiscinaWorkers({
    tamanhoPool: 1,
    scriptDaWorker: SOB_COMANDO,
    recriacao: { ...RAPIDA, esperaInicialMs: 300 },
  });
  try {
    await assert.rejects(() => p.executa(tarefa('morre')), /terminou com código 7/);
    // Sem `ate`: a rejeição chega no mesmo handler de `'exit'` que agenda a
    // reposição, então aqui o temporizador de 300 ms ainda nem começou a contar.
    assert.equal(p.ativa, false);
    await assert.rejects(() => p.executa(tarefa()), /desativada ou indisponível/);
    assert.notEqual(p.recriacao.proximaReposicaoEm, null, 'a reposição tinha de estar agendada');

    await ate(() => p.ativa, 'a reposição');
    assert.equal(p.recriacao.workersRecriadas, 1);
    assert.equal((await p.executa(tarefa())).ok, true);
  } finally {
    p.destroi();
  }
});

test('destroi() NÃO recria: nem a worker que ele termina, nem a reposição já agendada', async () => {
  const viva = new PiscinaWorkers({ tamanhoPool: 2, scriptDaWorker: RESPONDE, recriacao: RAPIDA });
  viva.destroi();

  // Uma morte de verdade com a reposição agendada, e o encerramento chegando
  // ANTES do temporizador: o agendado tem de ser cancelado.
  const morta = new PiscinaWorkers({
    tamanhoPool: 1,
    scriptDaWorker: MORRE,
    recriacao: { ...RAPIDA, esperaInicialMs: 100 },
  });
  await assert.rejects(() => morta.executa(tarefa()));
  assert.notEqual(morta.recriacao.proximaReposicaoEm, null);
  morta.destroi();

  // Bem depois do backoff (100 ms) e do `'exit'` dos `terminate()`.
  await pausa(300);
  for (const p of [viva, morta]) {
    assert.equal(p.estado.workers, 0);
    assert.equal(p.recriacao.workersRecriadas, 0);
    assert.equal(p.recriacao.proximaReposicaoEm, null);
    assert.equal(p.ativa, false);
  }
  assert.equal(viva.recriacao.mortes, 0, 'o terminate() do encerramento não é morte');
});

test('worker morrendo em LAÇO: a reposição para no teto e a piscina fica com o fallback', async () => {
  // Cada worker reposta morre ao nascer. Sem teto, isto giraria para sempre
  // criando threads; com teto 3, são 3 recriações e a reposição se suspende.
  const p = new PiscinaWorkers({ tamanhoPool: 1, scriptDaWorker: AO_NASCER, recriacao: RAPIDA });
  try {
    await ate(() => p.recriacao.suspensa, 'a suspensão da reposição');
    assert.equal(p.recriacao.workersRecriadas, RAPIDA.tetoNaJanela);
    // A original + as 3 repostas.
    assert.equal(p.recriacao.mortes, RAPIDA.tetoNaJanela + 1);

    // Bem mais que o backoff máximo (40 ms): nada mais pode ter sido criado.
    await pausa(250);
    assert.equal(p.recriacao.workersRecriadas, RAPIDA.tetoNaJanela);
    assert.equal(p.estado.workers, 0);
    assert.equal(p.ativa, false, 'sem worker, quem atende é o cálculo em linha');
    // A janela é deslizante: a próxima tentativa fica marcada para quando a
    // recriação mais antiga sair dela (60 s), não para já.
    const proxima = Date.parse(p.recriacao.proximaReposicaoEm ?? '');
    assert.ok(proxima - Date.now() > 50_000, 'a retomada tinha de esperar a janela');
  } finally {
    p.destroi();
  }
});

test('teto 0 desliga a reposição: o comportamento de antes, sem temporizador pendurado', async () => {
  const p = new PiscinaWorkers({
    tamanhoPool: 1,
    scriptDaWorker: MORRE,
    recriacao: { ...RAPIDA, tetoNaJanela: 0 },
  });
  try {
    await assert.rejects(() => p.executa(tarefa()));
    await pausa(100);
    assert.equal(p.recriacao.suspensa, true);
    assert.equal(p.recriacao.proximaReposicaoEm, null);
    assert.equal(p.recriacao.workersRecriadas, 0);
    assert.equal(p.ativa, false);
  } finally {
    p.destroi();
  }
});

test('estouro de heap (ERR_WORKER_OUT_OF_MEMORY) conta UMA morte, com o código no motivo', async () => {
  // A morte de produção: `'error'` com o código e DEPOIS `'exit'`. As duas
  // notícias não podem virar duas mortes nem duas reposições.
  const p = new PiscinaWorkers({
    tamanhoPool: 1,
    heapPorWorkerMB: 32,
    scriptDaWorker: ESTOURA,
    recriacao: { ...RAPIDA, esperaInicialMs: 50 },
  });
  try {
    await assert.rejects(() => p.executa(tarefa()), /memory|memória/i);
    assert.match(p.recriacao.ultimaMorte?.motivo ?? '', /ERR_WORKER_OUT_OF_MEMORY/);
    await ate(() => p.estado.workers === 1, 'a reposição depois do OOM');
    await pausa(100);
    assert.equal(p.recriacao.mortes, 1);
    assert.equal(p.recriacao.workersRecriadas, 1);
  } finally {
    p.destroi();
  }
});
