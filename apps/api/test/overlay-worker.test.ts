// O overlay do poller de quase-realtime ATRAVESSANDO a fronteira da worker.
//
// **O buraco que este arquivo fecha, e por que ele passou despercebido.**
//
// Até 08/09/2026 `worker-calculador.ts` chamava `carrega()` **sem** `overlay`.
// Como a piscina é o caminho de produção (`NODE_ENV=production` — e, medido, ela
// também fica ativa sob `npm test`, porque o script não define `NODE_ENV=test`),
// o encadeamento inteiro de near-realtime — poller detecta, cache invalida, SSE
// avisa, navegador refaz o GET — terminava num recálculo de 10–20 s sobre o
// MESMO arquivo em disco, devolvendo o mesmo número. Nada falhava, nada logava:
// o realtime funcionava como transporte e não como atualização.
//
// **E a suíte não pegava porque nenhum teste empurrava um overlay de verdade.**
// `servidorComOverlay` existia em `servidor.test.ts` desde ACHADOS #89 e era
// chamado, nos três testes que o usavam, com `() => new Map()`. Overlay vazio
// passa igual pelos dois caminhos — era exatamente a parte não exercitada.
//
// **Por que as afirmações são sobre `tabelas[].linhas`.** Contagem de linhas por
// tabela prova que a mesclagem aconteceu DENTRO de `carrega()`, sem depender de
// qual visual a `capa` desenha nem de qual número ele mostra. O contrato
// guardado aqui é o do overlay chegar; número é paridade, e paridade tem os seus
// próprios arquivos.
//
// REGRA DE SAÍDA do projeto: nenhum valor de linha real aparece aqui — as linhas
// são de mentira, escritas neste arquivo.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { escreve } from '../../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery, escreveManifesto } from '../../../packages/snapshot/src/manifesto.ts';
import { PiscinaWorkers } from '../src/piscina-workers.ts';
import { Servidor } from '../src/servidor.ts';
import type { OverlayDeTabela } from '../src/overlay-realtime.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WEB = path.join(ROOT, 'apps', 'api', 'web');
const AGORA = new Date('2026-08-07T12:00:00.000Z');

/**
 * Um snapshot com só a `HORA ATUALIZADO` — a tabela da página `capa`, 1 linha e
 * 3 colunas. Mesma montagem de `servidor.test.ts`: pequena o bastante para ser
 * escrita à mão e ainda assim exercitar o caminho inteiro, do arquivo em disco
 * ao JSON da resposta.
 */
async function dirComCapa(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-worker-'));
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
    {
      query: 'hora-atualizado',
      tabelas: cab.tabelas,
      linhas: 1,
      colunas: 3,
      bytes: 200,
      geradoEm: cab.geradoEm,
    },
  ]);
  return dir;
}

async function sobe(
  snapshotDir: string,
  overlayRealtime: () => ReadonlyMap<string, OverlayDeTabela>,
  extras: Record<string, unknown> = {},
): Promise<{
  servidor: Servidor;
  busca: (rota: string, init?: RequestInit) => Promise<Response>;
  fecha: () => Promise<void>;
}> {
  const servidor = new Servidor({
    root: ROOT,
    snapshotDir,
    webDir: WEB,
    agora: () => AGORA,
    identifica: () => ({ usuario: 'teste', papeis: ['autenticado'] }),
    overlayRealtime,
    ...extras,
  });
  const http = servidor.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  return {
    servidor,
    busca: (rota, init) => fetch(`http://127.0.0.1:${port}${rota}`, init),
    fecha: () =>
      new Promise<void>((ok) => {
        servidor.destroi();
        http.closeAllConnections?.();
        http.close(() => ok());
      }),
  };
}

/**
 * Um overlay com UMA linha de chave nova.
 *
 * A chave (`datahora`) é diferente da linha do disco (10:34), então `mescla()` a
 * ACRESCENTA em vez de substituir: 1 linha em disco viram 2. E o `corte` fica no
 * futuro para que nenhuma linha do disco caia por "sumida" (a metade 1 da regra
 * de `mescla()`) — o que se mede aqui é só o acréscimo.
 */
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

/** Quantas linhas a resposta diz que a tabela tinha. `-1` se ela não aparecer. */
function linhasDaTabela(corpo: unknown, nome: string): number {
  const tabelas = (corpo as { tabelas?: { nome: string; linhas: number }[] }).tabelas ?? [];
  return tabelas.find((t) => t.nome === nome)?.linhas ?? -1;
}

test('com a piscina LIGADA (o caminho de produção), o overlay chega ao cálculo', async () => {
  const s = await sobe(await dirComCapa(), overlayDeUmaLinhaNova);
  try {
    assert.equal(s.servidor.piscinaAtiva, true, 'este teste só vale alguma coisa com a piscina ligada');
    const corpo = await (await s.busca('/api/dashboards/capa')).json();
    assert.equal(
      linhasDaTabela(corpo, 'HORA ATUALIZADO'),
      2,
      'o overlay do poller não chegou ao cálculo — a worker está lendo só o disco',
    );
  } finally {
    await s.fecha();
  }
});

test('piscina LIGADA e DESLIGADA têm de dar o MESMO número', async () => {
  // O par existe porque a DIVERGÊNCIA entre os dois caminhos foi o defeito. Um
  // teste só do caminho da worker provaria que ela mescla; não provaria que ela
  // mescla IGUAL — e "o número muda conforme a piscina está ligada" é o modo de
  // falha que ninguém consegue reproduzir depois.
  const comPiscina = await sobe(await dirComCapa(), overlayDeUmaLinhaNova);
  const semPiscina = await sobe(await dirComCapa(), overlayDeUmaLinhaNova, {
    piscinaWorkers: new PiscinaWorkers({ desativado: true }),
  });
  try {
    const a = await (await comPiscina.busca('/api/dashboards/capa')).json();
    const b = await (await semPiscina.busca('/api/dashboards/capa')).json();
    assert.equal(
      linhasDaTabela(a, 'HORA ATUALIZADO'),
      linhasDaTabela(b, 'HORA ATUALIZADO'),
      'a piscina mudou o resultado — os dois caminhos não estão mesclando igual',
    );
    assert.equal(linhasDaTabela(a, 'HORA ATUALIZADO'), 2);
  } finally {
    await comPiscina.fecha();
    await semPiscina.fecha();
  }
});

test('sem overlay nada muda — a correção não pode mexer no caso comum', async () => {
  // O caso comum é overlay vazio: nenhuma das tabelas vigiadas mudou desde o
  // último refresh. Ele tem de continuar não pagando serialização nenhuma e
  // devolvendo o disco cru.
  const s = await sobe(await dirComCapa(), () => new Map());
  try {
    const corpo = await (await s.busca('/api/dashboards/capa')).json();
    assert.equal(linhasDaTabela(corpo, 'HORA ATUALIZADO'), 1);
  } finally {
    await s.fecha();
  }
});

test('o overlay é RECORTADO para as tabelas da página', async () => {
  // Uma tabela que a `capa` não usa não pode viajar para a worker: com 7 tabelas
  // vigiadas e páginas que usam uma, o custo do `postMessage` passaria a ser
  // proporcional ao que o poller viu, e não ao que a página lê.
  const comIntrusa = new Map(overlayDeUmaLinhaNova());
  comIntrusa.set('protocolos auxiliares', {
    linhas: [{ solicitacao: 'X-1' }],
    corte: new Date('2099-01-01T00:00:00.000Z'),
    chave: ['solicitacao'],
    marca: ['solicitacao'],
  });
  const s = await sobe(await dirComCapa(), () => comIntrusa);
  try {
    const corpo = await (await s.busca('/api/dashboards/capa')).json();
    // A `capa` continua mesclando a SUA tabela...
    assert.equal(linhasDaTabela(corpo, 'HORA ATUALIZADO'), 2);
    // ...e a intrusa não aparece: ela nem chegou a atravessar a fronteira.
    assert.equal(linhasDaTabela(corpo, 'PROTOCOLOS AUXILIARES'), -1);
  } finally {
    await s.fecha();
  }
});

// ---------------------------------------------------------------------------
// F0 — os contadores, embutidos na F1 em vez de uma fase só para medir
// ---------------------------------------------------------------------------

test('/api/saude publica os contadores que as fases seguintes vão usar', async () => {
  const s = await sobe(await dirComCapa(), overlayDeUmaLinhaNova);
  try {
    await s.busca('/api/dashboards/capa');
    await s.busca('/api/dashboards/capa'); // o segundo é acerto de cache
    const saude = await (await s.busca('/api/saude')).json();
    const rt = saude.realtime;

    assert.equal(rt.contadores.cache_misses, 1, 'o primeiro pedido tem de contar como miss');
    assert.equal(rt.contadores.cache_hits, 1, 'o segundo tem de contar como hit');
    assert.equal(rt.contadores.pedidos_interactive, 2, 'sem rótulo, o pedido é do usuário');
    assert.equal(rt.contadores.overlay_linhas_max, 1, 'o pico de linhas do overlay tem de sair');
    assert.equal(rt.contadores.calculos_com_overlay, 1);
    assert.equal(rt.sseAbertas, 0);
    assert.equal(rt.overlayTabelas, 1);
    // A duração do GET é medida em `criaHttp`, que cobre TODA saída — inclusive
    // as que nunca chegam a calcular. Por isso `>=` e não `===`: o que importa é
    // que nenhum caminho de resposta escape da medição.
    assert.ok(rt.duracoes.get_pagina_ms.n >= 2, 'as duas páginas têm de estar medidas');
  } finally {
    await s.fecha();
  }
});

test('o Aquecedor é classificado como warmup, e o hover como prefetch', async () => {
  // Esta é a classificação que a fase da fila com prioridade vai consumir. Ela é
  // medida ANTES de mudar prioridade nenhuma, de propósito: sem saber quanto do
  // trabalho é de fundo, escolher a política seria escolher pelo palpite.
  const s = await sobe(await dirComCapa(), () => new Map());
  try {
    await s.busca('/api/dashboards/capa', {
      headers: { 'x-aquecedor-interno': s.servidor.segredoInterno() },
    });
    await s.busca('/api/dashboards/capa?origem=prefetch');
    await s.busca('/api/dashboards/capa');
    const rt = (await (await s.busca('/api/saude')).json()).realtime;
    assert.equal(rt.contadores.pedidos_warmup, 1);
    assert.equal(rt.contadores.pedidos_prefetch, 1);
    assert.equal(rt.contadores.pedidos_interactive, 1);
  } finally {
    await s.fecha();
  }
});

test('dois pedidos iguais em MISS ainda geram DOIS cálculos — e o contador diz isso', async () => {
  // **Este teste afirma o defeito, não a correção.** O single-flight é a fase
  // seguinte; o que existe hoje é a MEDIDA dele. Quando a fase entrar, é este
  // teste que muda de sentido — e é melhor que ele exista agora, errado de
  // propósito e dizendo por quê, do que a fase seguinte começar sem uma linha de
  // base para comparar.
  //
  // `recalcula=1` pula a leitura do cache dos dois lados, que é exatamente o que
  // uma rajada pós-SSE faz: todos chegam depois de a entrada ter sido apagada.
  const s = await sobe(await dirComCapa(), () => new Map());
  try {
    await Promise.all([
      s.busca('/api/dashboards/capa?recalcula=1'),
      s.busca('/api/dashboards/capa?recalcula=1'),
    ]);
    const rt = (await (await s.busca('/api/saude')).json()).realtime;
    assert.equal(
      rt.contadores.concorrentes_mesma_chave_max,
      2,
      'os dois pedidos tinham de ter sido vistos como concorrentes na mesma chave',
    );
    assert.equal(rt.contadores.calculos_duplicados, 1);
  } finally {
    await s.fecha();
  }
});
