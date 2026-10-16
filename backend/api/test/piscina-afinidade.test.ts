// Afinidade página → worker: cada página tem uma worker dona, e a tarefa ESPERA a dona.
//
// **O defeito que estes testes guardam (16/10/2026).** A worker era escolhida por LIFO
// entre as livres, e nada mandava a mesma página para a mesma worker. Cada worker guarda
// o seu próprio `cacheDeCarga` (`worker-calculador.ts`), e um dataset de página pesada
// ocupa 250 MB–1 GB, boa parte FORA do heap da worker. Medido no teste de carga:
// `agendamento-field` carregado 4 + 2 vezes nas duas workers, `protocolos-detalhados`
// 4 + 3 — a mesma página em duas cópias, o dobro da memória, e a principal causa que
// restava do pico de curto prazo.
//
// O que não pode se perder junto:
//   - quem clica não espera aquecimento (a reserva de ACHADOS #163) → o clique DESVIA
//     da dona ocupada com fundo;
//   - quem clica não fica parado para sempre atrás de outro clique → desvia depois de
//     `esperaLongaMs`, e a piscina acorda sozinha para isso;
//   - a morte da dona não pendura quem a esperava → a página passa à que sobrou, e
//     volta para a reposta, que nasce na mesma vaga.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESPERA_LONGA_PADRAO_MS, PiscinaWorkers, rankDeVagas } from '../src/piscina-workers.ts';
import { prioridadeDe } from '../src/metricas.ts';
import { ESCOPO_TODOS } from '../src/escopo-cache.ts';
import type { MensagemCalculoWorker, RespostaCalculoWorker } from '../src/worker-calculador.ts';
import type { DashboardSpec } from '../../packages/widget-engine/src/spec.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const QUEM = path.join(AQUI, 'fixtures', 'worker-que-diz-quem-e.ts');

const INTERACTIVE = prioridadeDe('interactive');
const PREFETCH = prioridadeDe('prefetch');
const WARMUP = prioridadeDe('warmup');

/** Uma tarefa da página `pagina`; `demoraMs` é quanto a fixture segura a worker. */
function tarefa(
  pagina: string | undefined,
  demoraMs = 0,
  identidade = 'fixture@2026-10-16',
): Omit<MensagemCalculoWorker, 'idReq'> {
  return {
    snapshotDir: path.join(AQUI, 'nao-existe'),
    specsDir: path.join(AQUI, 'nao-existe'),
    dashboardSpec: { id: pagina, name: 'fixture', visuals: [] } as unknown as DashboardSpec,
    janela: { de: demoraMs, linhas: 10 },
    clicados: [],
    agoraIso: '2026-10-16T12:00:00.000Z',
    identidade,
    escopo: ESCOPO_TODOS,
  };
}

const quem = (r: RespostaCalculoWorker): number => (r.pagina as { threadId: number }).threadId;

/** Uma página cuja dona, num pool de `alvo`, é a vaga `vaga`. Achada, não chutada. */
function paginaNaVaga(vaga: number, alvo = 2, prefixo = 'pagina'): string {
  const vagas = Array.from({ length: alvo }, (_, i) => i);
  for (let i = 0; i < 1000; i++) {
    const p = `${prefixo}-${i}`;
    if (rankDeVagas(p, vagas)[0] === vaga) return p;
  }
  throw new Error(`nenhuma página cai na vaga ${vaga}`);
}

const A = paginaNaVaga(0);
const B = paginaNaVaga(1);

/**
 * Sobe a piscina e põe as duas workers de pé ANTES de medir — nascer e carregar o script
 * passa de 250 ms com a suíte inteira em paralelo (ACHADOS #203). Devolve quem é a dona
 * de A e de B, que são sempre workers diferentes.
 */
async function sobe(opts: ConstructorParameters<typeof PiscinaWorkers>[0] = {}) {
  const p = new PiscinaWorkers({ tamanhoPool: 2, scriptDaWorker: QUEM, ...opts });
  const [ra, rb] = await Promise.all([p.executa(tarefa(A)), p.executa(tarefa(B))]);
  const donaA = quem(ra);
  const donaB = quem(rb);
  assert.notEqual(donaA, donaB, 'A e B estão em vagas diferentes: as donas têm de ser workers diferentes');
  return { p, donaA, donaB };
}

/** Espera uma condição virar verdadeira, sem `setTimeout` chutado. */
async function ate(cond: () => boolean, oQue: string, ms = 5000): Promise<void> {
  const limite = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > limite) throw new Error(`${oQue}: não aconteceu em ${ms} ms`);
    await new Promise((ok) => setTimeout(ok, 5));
  }
}

// ------------------------------------------------------------- o ranking sozinho

test('rankDeVagas: determinístico, uma permutação das vagas, e indiferente à ordem de entrada', () => {
  for (const p of ['agendamento-field', 'capa', A, B]) {
    const r = rankDeVagas(p, [0, 1, 2, 3]);
    assert.deepEqual([...r].sort(), [0, 1, 2, 3]);
    assert.deepEqual(rankDeVagas(p, [0, 1, 2, 3]), r, 'a mesma página tem de dar o mesmo ranking');
    assert.deepEqual(rankDeVagas(p, [3, 1, 0, 2]), r, 'a ordem das vagas não pode mudar a dona');
  }
});

test('rankDeVagas: tirar uma vaga do jogo só move as páginas DELA', () => {
  // A propriedade que fez a escolha ser rendezvous e não `hash % vivas`: com o módulo,
  // a morte de uma worker trocaria a dona de quase todas as páginas, e cada troca é um
  // dataset recarregado e uma cópia a mais até o despejo.
  const paginas = Array.from({ length: 200 }, (_, i) => `p-${i}`);
  const todas = [0, 1, 2, 3];
  const semA2 = [0, 1, 3];
  for (const p of paginas) {
    const antes = rankDeVagas(p, todas);
    const depois = rankDeVagas(p, semA2)[0];
    if (antes[0] !== 2) assert.equal(depois, antes[0], `${p} não era da vaga 2 e mudou de dona`);
    else assert.equal(depois, antes[1], `${p} era da vaga 2 e não foi para a segunda do ranking dela`);
  }
});

test('com o pool padrão de 2, as duas páginas mais pesadas NÃO dividem a mesma worker', () => {
  // `agendamento-field` e `protocolos-detalhados` são os maiores datasets medidos em
  // 16/10. Na mesma dona, uma worker seguraria os dois e serializaria quem abre as duas.
  // Um hash novo que as junte tem de ser decisão — e este teste é onde ela aparece.
  const vagas = [0, 1];
  assert.notEqual(
    rankDeVagas('agendamento-field', vagas)[0],
    rankDeVagas('protocolos-detalhados', vagas)[0],
  );
});

// ------------------------------------------------------- a piscina de verdade

test('a mesma página vai SEMPRE à mesma worker — em sequência, em rajada e no fundo', async () => {
  const { p, donaA, donaB } = await sobe({ esperaLongaMs: 60_000 });
  try {
    // Em sequência: com o LIFO isto já dava certo; o que muda é a rajada abaixo.
    for (let i = 0; i < 3; i++) assert.equal(quem(await p.executa(tarefa(A))), donaA);

    // Em rajada, com a outra worker LIVRE ao lado: antes, a segunda tarefa caía nela e a
    // página ganhava uma segunda cópia. Agora as quatro esperam a dona.
    const rajada = await Promise.all([1, 2, 3, 4].map(() => p.executa(tarefa(A, 30), INTERACTIVE)));
    assert.deepEqual(rajada.map(quem), [donaA, donaA, donaA, donaA]);

    // O fundo idem — é o aquecimento que mais semeava cópias.
    const fundo = await Promise.all([
      p.executa(tarefa(B, 20), WARMUP),
      p.executa(tarefa(B, 20), PREFETCH),
      p.executa(tarefa(B, 20), WARMUP),
    ]);
    assert.deepEqual(fundo.map(quem), [donaB, donaB, donaB]);

    const a = p.afinidade;
    assert.equal(a.desviosPorFundo + a.desviosPorEspera, 0, 'ninguém podia ter desviado');
    assert.equal(a.naDona, 2 + 3 + 4 + 3);
    assert.ok(a.esperaramADona >= 3, `as da rajada esperaram a dona com a outra livre (${a.esperaramADona})`);
  } finally {
    p.destroi();
  }
});

test('dona ocupada com FUNDO + clique na página dela → o clique DESVIA na hora', async () => {
  // A reserva de #163 sob a afinidade: sem o desvio, a worker reservada ficaria livre e o
  // clique parado atrás do aquecimento na dona — o que a reserva existe para impedir.
  const { p, donaA, donaB } = await sobe({ esperaLongaMs: 60_000 });
  try {
    const aquecimento = p.executa(tarefa(A, 600), WARMUP);
    await ate(() => p.estado.ocupados === 1, 'o aquecimento na dona');
    const t0 = Date.now();
    const r = await p.executa(tarefa(A, 10), INTERACTIVE);
    const espera = Date.now() - t0;
    assert.equal(quem(r), donaB, 'o clique tinha de ir para a outra worker');
    assert.ok(espera < 400, `o clique esperou ${espera} ms — ficou atrás do aquecimento`);
    assert.equal(quem(await aquecimento), donaA);
    assert.equal(p.afinidade.desviosPorFundo, 1);
  } finally {
    p.destroi();
  }
});

test('dona ocupada com outro CLIQUE → o segundo clique ESPERA a dona', async () => {
  const { p, donaA } = await sobe({ esperaLongaMs: 60_000 });
  try {
    const primeiro = p.executa(tarefa(A, 300), INTERACTIVE);
    await ate(() => p.estado.ocupados === 1, 'o primeiro clique na dona');
    const t0 = Date.now();
    const r = await p.executa(tarefa(A, 10), INTERACTIVE);
    const espera = Date.now() - t0;
    assert.equal(quem(r), donaA, 'o segundo clique tinha de esperar a dona, com o dataset quente');
    assert.ok(espera >= 200, `o segundo clique saiu em ${espera} ms — não esperou a dona`);
    assert.equal(quem(await primeiro), donaA);
    assert.equal(p.afinidade.desviosPorEspera + p.afinidade.desviosPorFundo, 0);
    assert.equal(p.afinidade.esperaramADona, 1);
  } finally {
    p.destroi();
  }
});

test('espera LONGA: o clique parado na dona desvia sozinho, sem precisar de outra tarefa', async () => {
  // Nada entra nem sai durante a espera: quem acorda a fila é o temporizador do desvio.
  // Sem ele, o segundo clique ficaria os 1500 ms inteiros atrás do primeiro.
  const { p, donaA, donaB } = await sobe({ esperaLongaMs: 150 });
  try {
    const primeiro = p.executa(tarefa(A, 1500), INTERACTIVE);
    await ate(() => p.estado.ocupados === 1, 'o primeiro clique na dona');
    const t0 = Date.now();
    const r = await p.executa(tarefa(A, 10), INTERACTIVE);
    const espera = Date.now() - t0;
    assert.equal(quem(r), donaB);
    assert.ok(espera >= 140, `desviou em ${espera} ms — antes do limite de 150`);
    assert.ok(espera < 1000, `esperou ${espera} ms — o desvio por espera longa não disparou`);
    assert.equal(p.afinidade.desviosPorEspera, 1);
    assert.equal(quem(await primeiro), donaA);
  } finally {
    p.destroi();
  }
});

test('espera longa NÃO vale para fundo: o aquecimento espera a dona o tempo que for', async () => {
  const { p, donaA } = await sobe({ esperaLongaMs: 50 });
  try {
    const clique = p.executa(tarefa(A, 400), INTERACTIVE);
    await ate(() => p.estado.ocupados === 1, 'o clique na dona');
    const r = await p.executa(tarefa(A, 10), WARMUP);
    assert.equal(quem(r), donaA);
    await clique;
    assert.equal(p.afinidade.desviosPorEspera + p.afinidade.desviosPorFundo, 0);
  } finally {
    p.destroi();
  }
});

test('a espera pela dona não trava a fila: a página B passa enquanto A espera', async () => {
  // Sem varrer a fila (`tiraPrimeira`), a tarefa de A na frente, esperando a dona,
  // seguraria a de B — cuja dona está livre — até A ser atendida.
  const { p, donaB } = await sobe({ esperaLongaMs: 60_000 });
  try {
    const longo = p.executa(tarefa(A, 500), INTERACTIVE);
    await ate(() => p.estado.ocupados === 1, 'A na dona');
    const esperandoA = p.executa(tarefa(A, 10), INTERACTIVE); // entra antes, na mesma classe
    const t0 = Date.now();
    const rb = await p.executa(tarefa(B, 10), INTERACTIVE);
    assert.equal(quem(rb), donaB);
    assert.ok(Date.now() - t0 < 300, 'B ficou presa atrás de A');
    await Promise.all([longo, esperandoA]);
  } finally {
    p.destroi();
  }
});

test('dona MORRE: a página passa à que sobrou e VOLTA para a reposta, na mesma vaga', async () => {
  const { p, donaA, donaB } = await sobe({
    esperaLongaMs: 60_000,
    recriacao: { esperaInicialMs: 400, esperaMaximaMs: 400, tetoNaJanela: 3, janelaMs: 60_000 },
  });
  try {
    await assert.rejects(() => p.executa(tarefa(A, 0, 'morre')), /código 9/);
    assert.equal(p.estado.workers, 1);

    // No backoff (400 ms), A é atendida pela que sobrou — a substituta determinística —
    // e B, que já era dela, continua onde estava.
    assert.equal(quem(await p.executa(tarefa(A))), donaB);
    assert.equal(quem(await p.executa(tarefa(B))), donaB);
    assert.equal(p.afinidade.remapeadas, 1);

    await ate(() => p.estado.workers === 2, 'a reposição');
    const novaA = quem(await p.executa(tarefa(A)));
    assert.notEqual(novaA, donaA, 'a dona antiga morreu: quem atende é outra thread');
    assert.notEqual(novaA, donaB, 'a reposta nasce na vaga da morta e recebe de volta as páginas dela');
    // E B não foi reembaralhada pela volta.
    assert.equal(quem(await p.executa(tarefa(B))), donaB);
  } finally {
    p.destroi();
  }
});

test('quem ESPERAVA a dona que morreu vai para a que sobrou na hora, não depois da reposição', async () => {
  // As duas no mesmo tick: a primeira é despachada à dona e a mata; a segunda, da mesma
  // página, está na fila esperando a dona com a outra worker livre. Sem a varredura na
  // morte, ela esperaria a reposição (2 s de backoff aqui).
  const { p, donaB } = await sobe({
    esperaLongaMs: 60_000,
    recriacao: { esperaInicialMs: 2000, esperaMaximaMs: 2000, tetoNaJanela: 3, janelaMs: 60_000 },
  });
  try {
    const t0 = Date.now();
    const [morta, esperando] = await Promise.allSettled([
      p.executa(tarefa(A, 0, 'morre'), INTERACTIVE),
      p.executa(tarefa(A, 0), INTERACTIVE),
    ]);
    assert.equal(morta.status, 'rejected');
    assert.equal(esperando.status, 'fulfilled');
    assert.equal(quem((esperando as PromiseFulfilledResult<RespostaCalculoWorker>).value), donaB);
    const espera = Date.now() - t0;
    assert.ok(espera < 1500, `a tarefa esperou ${espera} ms — ficou presa na dona morta até a reposição`);
  } finally {
    p.destroi();
  }
});

test('tarefa sem página segue o caminho de antes e é contada à parte', async () => {
  const { p } = await sobe();
  try {
    const r = await p.executa(tarefa(undefined));
    assert.equal(r.ok, true);
    assert.equal(p.afinidade.semPagina, 1);
  } finally {
    p.destroi();
  }
});

test('o getter: limite padrão em produção, e uma cópia que quem lê não consegue alterar', () => {
  const p = new PiscinaWorkers({ desativado: true });
  const a = p.afinidade;
  assert.equal(a.esperaLongaMs, ESPERA_LONGA_PADRAO_MS);
  assert.deepEqual(
    { ...a, esperaLongaMs: 0 },
    { naDona: 0, remapeadas: 0, desviosPorFundo: 0, desviosPorEspera: 0, semPagina: 0, esperaramADona: 0, esperaLongaMs: 0 },
  );
  a.naDona = 99;
  assert.equal(p.afinidade.naDona, 0);
});
