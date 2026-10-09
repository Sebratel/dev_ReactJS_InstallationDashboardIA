// Os valores de segmentação calculados NA WORKER, e não na thread que atende.
//
// **O que este arquivo guarda.** Até 05/10/2026 `GET .../valores` chamava
// `Servidor.carrega()` na thread principal, e cada mudança do tempo real derrubava o
// dataset da página: 57 cargas em ~23 min, cada uma segurando o laço por centenas de
// ms (ACHADOS #175). Agora a lista sai da piscina. Os testes provam três coisas:
// a worker devolve a lista com o overlay do poller mesclado; a rota manda o cálculo
// para a piscina e não carrega nada aqui; e uma lista calculada sobre o dado de ANTES
// de um evento não fica gravada como se fosse a de depois.
//
// REGRA DE SAÍDA do projeto: nenhum valor de linha real aparece aqui — as linhas
// são de mentira, escritas neste arquivo.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { escreve } from '../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery, escreveManifesto } from '../../packages/snapshot/src/manifesto.ts';
import { loadDashboards } from '../../packages/widget-engine/src/spec.ts';
import { PiscinaWorkers } from '../src/piscina-workers.ts';
import { Servidor } from '../src/servidor.ts';
import type { OverlayDeTabela } from '../src/overlay-realtime.ts';
import type { MensagemCalculoWorker, RespostaCalculoWorker } from '../src/worker-calculador.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SPECS = path.join(ROOT, 'backend', 'specs');
const WEB = path.join(ROOT, 'frontend', 'dist');
const AGORA = new Date('2026-08-07T12:00:00.000Z');

/** A `HORA ATUALIZADO` com uma linha: a tabela da `capa`, pequena o bastante para escrever à mão. */
async function dirComCapa(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'valores-worker-'));
  const cab = await escreve(
    arquivoDaQuery(dir, 'hora-atualizado'),
    { query: 'hora-atualizado', tabelas: ['HORA ATUALIZADO'], geradoEm: '2026-08-07T11:00:00.000Z' },
    ['datahora', 'data', 'hora'],
    [
      {
        datahora: new Date('2026-08-07T10:34:00.000Z'),
        data: new Date('2026-08-07T00:00:00.000Z'),
        hora: new Date('1899-12-30T10:34:00.000Z'),
      },
    ],
  );
  await escreveManifesto(dir, [
    { query: 'hora-atualizado', tabelas: cab.tabelas, linhas: 1, colunas: 3, bytes: 200, geradoEm: cab.geradoEm },
  ]);
  return dir;
}

/** Uma linha de chave nova, que `mescla()` acrescenta: 1 valor distinto vira 2. */
function overlayDeUmaLinhaNova(): Map<string, OverlayDeTabela> {
  return new Map([
    [
      'hora atualizado',
      {
        linhas: [
          {
            datahora: new Date('2026-08-07T11:47:00.000Z'),
            data: new Date('2026-08-07T00:00:00.000Z'),
            hora: new Date('1899-12-30T11:47:00.000Z'),
          },
        ],
        corte: new Date('2099-01-01T00:00:00.000Z'),
        chave: ['datahora'],
        marca: ['datahora'],
      } satisfies OverlayDeTabela,
    ],
  ]);
}

function pedidoDeValores(
  snapshotDir: string,
  extras: Partial<MensagemCalculoWorker> = {},
): Omit<MensagemCalculoWorker, 'idReq'> {
  const capa = loadDashboards(SPECS).find((d) => d.id === 'capa')!;
  return {
    snapshotDir,
    specsDir: SPECS,
    dashboardSpec: capa,
    janela: { de: 0, linhas: 0 },
    clicados: [],
    liberaSobDemanda: [],
    precisaFormaCompleta: [],
    agoraIso: AGORA.toISOString(),
    identidade: 'teste@2026-08-07',
    escopo: 'teste',
    valores: { tabela: 'HORA ATUALIZADO', coluna: 'Hora', nivel: null },
    ...extras,
  };
}

test('a worker devolve os valores da segmentação, com o overlay do poller mesclado', async () => {
  const dir = await dirComCapa();
  const piscina = new PiscinaWorkers({ tamanhoPool: 1 });
  try {
    assert.equal(piscina.ativa, true, 'este teste só vale alguma coisa com a piscina ligada');
    const semOverlay = await piscina.executa(pedidoDeValores(dir));
    assert.equal(semOverlay.pagina, undefined, 'pedido de valores não calcula a página');
    assert.equal(semOverlay.valores?.length, 1);

    const comOverlay = await piscina.executa(
      pedidoDeValores(dir, { overlays: overlayDeUmaLinhaNova(), identidade: 'teste-2@2026-08-07' }),
    );
    assert.equal(comOverlay.valores?.length, 2, 'a linha do tempo real não entrou na lista');
  } finally {
    piscina.destroi();
  }
});

test('nível que a projeção não conhece volta como erro DO PEDIDO, não como falha da worker', async () => {
  // Falha da worker cai no cálculo em linha, que recarregaria o dataset na thread
  // que atende só para errar igual. Erro do pedido tem de virar 400 direto.
  const dir = await dirComCapa();
  const piscina = new PiscinaWorkers({ tamanhoPool: 1 });
  try {
    const r = await piscina.executa(
      pedidoDeValores(dir, { valores: { tabela: 'HORA ATUALIZADO', coluna: 'Hora', nivel: 'Inventado' } }),
    );
    assert.equal(r.ok, true);
    assert.equal(typeof r.erroDoPedido, 'string');
    assert.equal(r.valores, undefined);
  } finally {
    piscina.destroi();
  }
});

/**
 * Uma piscina de mentira: registra cada pedido e responde quando o teste mandar.
 * É o que deixa provar a ORDEM — um evento no meio do cálculo — sem depender de
 * tempo de worker.
 */
function piscinaFalsa(): {
  piscina: PiscinaWorkers;
  pedidos: Omit<MensagemCalculoWorker, 'idReq'>[];
  respondeTodos: (valores: unknown[]) => void;
} {
  const pedidos: Omit<MensagemCalculoWorker, 'idReq'>[] = [];
  const pendentes: ((r: RespostaCalculoWorker) => void)[] = [];
  const falsa = {
    ativa: true,
    estado: { fila: 0, ocupados: 0, workers: 1, porClasse: [0, 0, 0] },
    executa(msg: Omit<MensagemCalculoWorker, 'idReq'>): Promise<RespostaCalculoWorker> {
      pedidos.push(msg);
      return new Promise((ok) => pendentes.push(ok));
    },
    invalidaPagina(): void {},
    medeCom(): void {},
    destroi(): void {},
  };
  return {
    piscina: falsa as unknown as PiscinaWorkers,
    pedidos,
    respondeTodos: (valores) => {
      for (const ok of pendentes.splice(0)) ok({ idReq: 'x', ok: true, valores: valores as never });
    },
  };
}

async function sobe(piscina: PiscinaWorkers): Promise<{
  servidor: Servidor;
  busca: (rota: string) => Promise<Response>;
  fecha: () => Promise<void>;
}> {
  const servidor = new Servidor({
    root: ROOT,
    snapshotDir: fs.mkdtempSync(path.join(os.tmpdir(), 'valores-worker-vazio-')),
    webDir: WEB,
    agora: () => AGORA,
    identifica: () => ({ usuario: 'teste', papeis: ['autenticado'] }),
    piscinaWorkers: piscina,
  });
  const http = servidor.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  return {
    servidor,
    busca: (rota) => fetch(`http://127.0.0.1:${port}${rota}`),
    fecha: () =>
      new Promise<void>((ok) => {
        servidor.destroi();
        http.closeAllConnections?.();
        http.close(() => ok());
      }),
  };
}

const ROTA = '/api/dashboards/visao-geral/valores?tabela=PROTOCOLOS GERAL&coluna=STATUS';

/** Espera a rota chegar na piscina (o pedido HTTP é assíncrono até lá). */
async function ate(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(cond(), 'a condição não chegou a valer');
}

test('a rota de valores calcula na piscina, e pedidos iguais simultâneos viram UMA tarefa', async () => {
  const f = piscinaFalsa();
  const s = await sobe(f.piscina);
  try {
    const a = s.busca(ROTA);
    const b = s.busca(ROTA);
    await ate(() => f.pedidos.length >= 1);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(f.pedidos.length, 1, 'dois pedidos iguais viraram duas tarefas na piscina');
    assert.deepEqual(f.pedidos[0]!.valores, { tabela: 'PROTOCOLOS GERAL', coluna: 'STATUS', nivel: null });
    f.respondeTodos(['ABERTO', 'FECHADO']);
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra.status, 200);
    assert.equal(rb.status, 200);
    assert.deepEqual((await ra.json()).valores.map((v: { valor: unknown }) => v.valor), ['ABERTO', 'FECHADO']);
    await rb.arrayBuffer();

    // Guardada: o terceiro pedido não vai à piscina.
    const rc = await s.busca(ROTA);
    assert.equal(rc.status, 200);
    await rc.arrayBuffer();
    assert.equal(f.pedidos.length, 1);
  } finally {
    await s.fecha();
  }
});

test('a lista de uma coluna-gatilho vem da forma completa, a mesma que os visuais da página usam', async () => {
  // `ClassificacaoRelato` é coluna-gatilho do grão reduzido da FIELD AGENDA
  // (`projecao.yaml`). Carregada sem nenhum visual amarrado, a lista caía no grão
  // reduzido: medido em 05/10/2026, 14 de 36 valores (ACHADOS #175).
  const f = piscinaFalsa();
  const s = await sobe(f.piscina);
  try {
    const r = s.busca('/api/dashboards/agendamento-field/valores?tabela=FIELD AGENDA&coluna=ClassificacaoRelato');
    await ate(() => f.pedidos.length === 1);
    assert.ok(
      (f.pedidos[0]!.precisaFormaCompleta ?? []).includes('FIELD AGENDA'),
      `forma completa pedida: ${JSON.stringify(f.pedidos[0]!.precisaFormaCompleta)}`,
    );
    f.respondeTodos([]);
    await (await r).arrayBuffer();
  } finally {
    await s.fecha();
  }
});

test('lista calculada sobre o dado de ANTES de um evento não fica gravada como a de depois', async () => {
  const f = piscinaFalsa();
  const s = await sobe(f.piscina);
  try {
    const a = s.busca(ROTA);
    await ate(() => f.pedidos.length === 1);
    // O poller viu a tabela mudar enquanto a lista estava sendo calculada.
    s.servidor.aoTabelaMudar('PROTOCOLOS GERAL', 'protocolos-geral');
    f.respondeTodos(['VELHO']);
    assert.equal((await a).status, 200, 'quem pediu antes do evento recebe a resposta que pediu');

    // Quem pede depois do evento tem de ir à piscina de novo, e não receber 'VELHO'.
    const b = s.busca(ROTA);
    await ate(() => f.pedidos.length === 2);
    f.respondeTodos(['NOVO']);
    const rb = await b;
    assert.deepEqual((await rb.json()).valores.map((v: { valor: unknown }) => v.valor), ['NOVO']);
  } finally {
    await s.fecha();
  }
});

test('?visual= da VISÃO PRODUTIVA leva as fontes do recálculo ao vivo na forma completa', async () => {
  // ACHADOS #194. O visual não lê a FIELD AGENDA direto: sem isto ela vinha no grão
  // reduzido, a tradução nativa de Status Protocolo Dia recusava por falta de colunas, e
  // o visual voltava como erro em 3–8 s, medido na stack em 09/10/2026.
  const f = piscinaFalsa();
  const s = await sobe(f.piscina);
  try {
    void s.busca('/api/dashboards/agendamento-field?visual=04979b00e5329b67f349').catch(() => undefined);
    await ate(() => f.pedidos.length === 1);
    const forma = f.pedidos[0]!.precisaFormaCompleta ?? [];
    assert.ok(forma.includes('FIELD AGENDA') && forma.includes('PROTOCOLOS GERAL'), `forma completa: ${JSON.stringify(forma)}`);
  } finally {
    await s.fecha();
  }
});
