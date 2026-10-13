// A prioridade vista de fora: pela URL, e pelo que `GET /api/saude` publica.
//
// `prioridade-fila.test.ts` cobre a política (quem passa na frente) na piscina.
// Aqui o que está sob teste é o outro lado: um pedido HTTP vira uma classe, a
// classe vira posição de fila, e a espera de cada classe sai medida — que é o
// que torna a decisão sobre fairness uma leitura, e não uma opinião.
//
// A piscina destes testes roda `worker-lento.ts`, que dorme `janela.de` ms antes
// de responder. `?de=` é o começo da janela de paginação, então ele serve às
// duas coisas ao mesmo tempo: controla quanto o "cálculo" custa E entra na chave
// de cache. É o que permite montar fila de verdade sem um snapshot pesado.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { escreve } from '../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery, escreveManifesto } from '../../packages/snapshot/src/manifesto.ts';
import { PiscinaWorkers } from '../src/piscina-workers.ts';
import { Servidor } from '../src/servidor.ts';
import { ACESSO_LIBERADO } from './fixtures/acesso.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(AQUI, '..', '..', '..');
const WEB = path.join(ROOT, 'frontend', 'dist');
const LENTO = path.join(AQUI, 'fixtures', 'worker-lento.ts');
const AGORA = new Date('2026-08-07T12:00:00.000Z');

interface Saude {
  contadores: Record<string, number>;
  duracoes: Record<string, { n: number; mediaMs: number; maxMs: number; p95Ms: number }>;
  piscina: { fila: number; ocupados: number; workers: number; porClasse: number[] };
}

async function dirComCapa(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prioridade-'));
  const linha = {
    datahora: new Date('2026-08-07T10:34:00.000Z'),
    data: new Date('2026-08-07T00:00:00.000Z'),
    hora: new Date('1899-12-30T10:34:00.000Z'),
  };
  const cab = await escreve(
    arquivoDaQuery(dir, 'hora-atualizado'),
    { query: 'hora-atualizado', tabelas: ['HORA ATUALIZADO'], geradoEm: '2026-08-07T11:00:00.000Z' },
    ['datahora', 'data', 'hora'],
    [linha],
  );
  await escreveManifesto(dir, [
    { query: 'hora-atualizado', tabelas: cab.tabelas, linhas: 1, colunas: 3, bytes: 200, geradoEm: cab.geradoEm },
  ]);
  return dir;
}

async function sobe(): Promise<{
  busca: (rota: string) => Promise<Response>;
  metricas: () => Promise<Saude>;
  ate: (cond: (s: Saude) => boolean, oQue: string) => Promise<void>;
  fecha: () => Promise<void>;
}> {
  const piscina = new PiscinaWorkers({ tamanhoPool: 1, scriptDaWorker: LENTO });
  const servidor = new Servidor({
    acesso: ACESSO_LIBERADO,
    root: ROOT,
    snapshotDir: await dirComCapa(),
    webDir: WEB,
    agora: () => AGORA,
    identifica: () => ({ usuario: 'teste', papeis: ['autenticado'] }),
    piscinaWorkers: piscina,
  });
  const http = servidor.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  const busca = (rota: string): Promise<Response> => fetch(`http://127.0.0.1:${port}${rota}`);
  const metricas = async (): Promise<Saude> => (await (await busca('/api/saude')).json()).realtime;
  return {
    busca,
    metricas,
    /** Espera uma condição na própria saúde — sem cronometrar nada por fora. */
    ate: async (cond, oQue) => {
      const limite = Date.now() + 5000;
      for (;;) {
        if (cond(await metricas())) return;
        if (Date.now() > limite) throw new Error(`a condição não se cumpriu: ${oQue}`);
      }
    },
    fecha: () =>
      new Promise<void>((ok) => {
        servidor.destroi();
        piscina.destroi();
        http.closeAllConnections?.();
        http.close(() => ok());
      }),
  };
}

test('um GET normal é interactive, e a espera e o cálculo saem SEPARADOS', async () => {
  // `worker_ms` é a soma; ele não distingue "o cálculo é caro" de "o clique
  // ficou atrás de três aquecimentos", que são problemas com consertos
  // diferentes. É essa separação que a F3 acrescenta.
  const s = await sobe();
  try {
    assert.equal((await s.busca('/api/dashboards/capa?de=30')).status, 200);
    const m = await s.metricas();
    assert.equal(m.contadores.pedidos_interactive, 1);
    assert.equal(m.duracoes.fila_ms_interactive!.n, 1);
    assert.equal(m.duracoes.calculo_ms_interactive!.n, 1);
    assert.ok(
      m.duracoes.calculo_ms_interactive!.maxMs >= 25,
      'o cálculo tem de aparecer no lado do cálculo, não no da fila',
    );
    assert.equal(m.duracoes.fila_ms_prefetch, undefined, 'ninguém declarou prefetch');
    assert.equal(m.duracoes.fila_ms_warmup, undefined);
  } finally {
    await s.fecha();
  }
});

test('?origem= classifica o pedido, e cada classe é medida em separado', async () => {
  const s = await sobe();
  try {
    await s.busca('/api/dashboards/capa?de=20&linhas=1&origem=prefetch');
    await s.busca('/api/dashboards/capa?de=20&linhas=2&origem=warmup');
    const m = await s.metricas();
    assert.equal(m.contadores.pedidos_prefetch, 1);
    assert.equal(m.contadores.pedidos_warmup, 1);
    assert.equal(m.duracoes.fila_ms_prefetch!.n, 1);
    assert.equal(m.duracoes.fila_ms_warmup!.n, 1);
    assert.equal(m.duracoes.fila_ms_interactive, undefined, 'nenhum destes dois era clique');
  } finally {
    await s.fecha();
  }
});

test('com a fila cheia, o CLIQUE espera menos que os aquecimentos', async () => {
  // O cenário do plano, com uma worker e quatro chaves diferentes: a primeira é
  // despachada na hora e as outras três disputam a vez. Sob FIFO, o clique
  // esperaria os três aquecimentos.
  const s = await sobe();
  try {
    await Promise.all([
      s.busca('/api/dashboards/capa?de=120&linhas=1&origem=warmup'),
      s.busca('/api/dashboards/capa?de=120&linhas=2&origem=warmup'),
      s.busca('/api/dashboards/capa?de=120&linhas=3&origem=warmup'),
      s.busca('/api/dashboards/capa?de=120&linhas=4'),
    ]);
    const m = await s.metricas();
    assert.equal(m.duracoes.fila_ms_warmup!.n, 3);
    assert.equal(m.duracoes.fila_ms_interactive!.n, 1);
    assert.ok(
      m.duracoes.fila_ms_interactive!.maxMs < m.duracoes.fila_ms_warmup!.maxMs,
      `o clique esperou ${m.duracoes.fila_ms_interactive!.maxMs} ms e o pior aquecimento ` +
        `${m.duracoes.fila_ms_warmup!.maxMs} ms — a prioridade não chegou até a fila`,
    );
    // As quatro chaves são quatro cálculos: a dedupe da F2 é por chave, e
    // recortes diferentes continuam sendo trabalho diferente.
    assert.equal(m.contadores.fila_entradas_warmup, 3);
    assert.equal(m.contadores.fila_entradas_interactive, 1);
  } finally {
    await s.fecha();
  }
});

test('quanto da fila era trabalho DUPLICADO: 6 pedidos, 1 entrada na fila', async () => {
  // A segunda pergunta da F3. Antes da F2, seis pedidos iguais enchiam a fila
  // com seis cálculos idênticos — a fila estava cheia de trabalho que não
  // precisava existir, e reordená-la teria sido otimizar a duplicação. Comparar
  // `pedidos_<origem>` com `fila_entradas_<origem>` é o que separa uma coisa da
  // outra, e o número diz que 5 dos 6 eram duplicação.
  const s = await sobe();
  try {
    await Promise.all(
      Array.from({ length: 6 }, () => s.busca('/api/dashboards/capa?de=60')),
    );
    const m = await s.metricas();
    assert.equal(m.contadores.pedidos_interactive, 6);
    assert.equal(m.contadores.fila_entradas_interactive, 1);
    assert.equal(m.contadores.singleflight_coalescidos, 5);
    assert.equal(m.duracoes.calculo_ms_interactive!.n, 1);
  } finally {
    await s.fecha();
  }
});

test('o clique que pega carona num AQUECIMENTO herda a fila dele — e isso é contado', async () => {
  // O buraco que a F2 e a F3 abrem juntas. A prioridade é a de quem INICIOU o
  // voo: se um aquecimento já está calculando esta chave, o clique que chega
  // depois pega carona e herda a posição de fila dele, em vez de furar. Não
  // custa um cálculo a mais — custa espera.
  //
  // Promover a tarefa em voo seria possível, e é justamente o mecanismo que a
  // decisão desta fase manda NÃO escrever antes de haver número. Este contador
  // é o número.
  const s = await sobe();
  try {
    const doAquecedor = s.busca('/api/dashboards/capa?de=400&origem=warmup');
    await s.ate((m) => m.piscina.ocupados === 1, 'o aquecimento entrar na worker');
    const doClique = s.busca('/api/dashboards/capa?de=400');
    await Promise.all([doAquecedor, doClique]);

    const m = await s.metricas();
    assert.equal(m.contadores.voo_herdou_prioridade_pior_interactive, 1);
    assert.equal(m.contadores.singleflight_coalescidos, 1, 'o clique pegou carona, não recalculou');
    assert.equal(m.contadores.fila_entradas_warmup, 1);
    assert.equal(m.contadores.fila_entradas_interactive, undefined, 'o clique não gerou tarefa');
  } finally {
    await s.fecha();
  }
});

test('a saúde diz a fila POR CLASSE — uma fila de 6 não diz se alguém está clicando', async () => {
  const s = await sobe();
  try {
    const emVoo = [
      s.busca('/api/dashboards/capa?de=400&linhas=1&origem=warmup'),
      s.busca('/api/dashboards/capa?de=400&linhas=2&origem=warmup'),
      s.busca('/api/dashboards/capa?de=400&linhas=3&origem=warmup'),
    ];
    await s.ate((m) => m.piscina.fila >= 2, 'a fila encher');
    const m = await s.metricas();
    assert.deepEqual(m.piscina.porClasse.length, 3);
    assert.equal(m.piscina.porClasse[0], 0, 'nenhum clique esperando');
    assert.ok(m.piscina.porClasse[2]! >= 2, 'os aquecimentos é que estão na fila');
    await Promise.all(emVoo);
  } finally {
    await s.fecha();
  }
});
