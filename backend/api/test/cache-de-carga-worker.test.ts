// `cacheDeCarga` (worker-calculador.ts): a worker para de reler o snapshot do
// disco a cada mensagem, e passa a reaproveitar o dataset já carregado — a
// MESMA função que `Servidor.carregadas` já cumpre na thread principal.
//
// **O problema que isto resolve, medido ao vivo em 09/09/2026.** VISÃO GERAL,
// clique num técnico do ranking (94 categorias): `calculo_ms_interactive`
// (inteiro dentro da worker) ficava em 1,9–2,5 s, mas `calculaPagina` sozinho
// gasta ~93 ms — o resto era `carrega()` relendo e retipando tabela por
// tabela, sempre do zero, porque cada worker thread tem a SUA PRÓPRIA
// memória e nada nela lembrava do pedido anterior. O filtro muda a cada
// clique; o CONJUNTO DE COLUNAS que a página usa não muda nunca.
//
// **O risco que a cache abre, e que os dois testes abaixo fecham.** Cachear o
// `Carregado` — que já leva o overlay de tempo real mesclado dentro — só é
// seguro se a entrada morrer no INSTANTE em que o dado por trás dela muda:
//
//   1. Ela tem de ser reaproveitada de verdade (senão a cache não existe, só
//      parece existir) — provado apagando o arquivo do disco DEPOIS do 1º
//      pedido: se a worker relesse, o 2º cairia em 409.
//   2. Ela tem de cair quando o poller de quase-realtime detecta a MESMA
//      tabela mudando (`Servidor.aoTabelaMudar`) — senão é o bug de
//      `overlay-worker.test.ts` (F1) de novo, um nível abaixo: o realtime
//      funcionaria como transporte e não como atualização.
//
// REGRA DE SAÍDA do projeto: nenhum valor de linha real aparece aqui — as
// linhas são de mentira, escritas neste arquivo.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { escreve } from '../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery, escreveManifesto, leManifesto } from '../../packages/snapshot/src/manifesto.ts';
import { Servidor } from '../src/servidor.ts';
import type { OverlayDeTabela } from '../src/overlay-realtime.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WEB = path.join(ROOT, 'frontend', 'dist');
const AGORA = new Date('2026-08-07T12:00:00.000Z');

/** Mesma montagem de `overlay-worker.test.ts`: a página `capa`, 1 linha, 3 colunas. */
async function dirComCapa(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-carga-worker-'));
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

/** Mesma linha de `overlay-worker.test.ts`: uma chave nova, corte no futuro. */
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

/** Quantas linhas a resposta diz que a tabela tinha. `-1` se ela não aparecer
 *  (é o caso de um 409 — a resposta de erro não tem `tabelas`). */
function linhasDaTabela(corpo: unknown, nome: string): number {
  const tabelas = (corpo as { tabelas?: { nome: string; linhas: number }[] }).tabelas ?? [];
  return tabelas.find((t) => t.nome === nome)?.linhas ?? -1;
}

test('a worker reaproveita o dataset — apagar o arquivo depois do 1º pedido não quebra o 2º', async () => {
  const dir = await dirComCapa();
  const s = await sobe(dir, () => new Map());
  try {
    assert.equal(s.servidor.piscinaAtiva, true, 'este teste só vale alguma coisa com a piscina ligada');

    // `recalcula=1` para os dois pedidos: sem isto o 2º seria um acerto do
    // CACHE DE RESPOSTA (`CacheDeResposta`), que já é testado em outro lugar
    // (`overlay-worker.test.ts`) e não provaria nada sobre a worker.
    const a = await (await s.busca('/api/dashboards/capa?recalcula=1')).json();
    assert.equal(linhasDaTabela(a, 'HORA ATUALIZADO'), 1);

    // Se a worker for reler do disco, o 2º pedido cai em 409 "Snapshot incompleto".
    fs.rmSync(arquivoDaQuery(dir, 'hora-atualizado'));

    const b = await (await s.busca('/api/dashboards/capa?recalcula=1')).json();
    assert.equal(
      linhasDaTabela(b, 'HORA ATUALIZADO'),
      1,
      'a worker releu o disco em vez de reaproveitar o dataset já carregado',
    );
  } finally {
    await s.fecha();
  }
});

test('aoTabelaMudar invalida o cache da worker — o próximo pedido enxerga o overlay novo', async () => {
  const dir = await dirComCapa();
  let overlayAtual: ReadonlyMap<string, OverlayDeTabela> = new Map();
  const s = await sobe(dir, () => overlayAtual);
  try {
    const a = await (await s.busca('/api/dashboards/capa?recalcula=1')).json();
    assert.equal(linhasDaTabela(a, 'HORA ATUALIZADO'), 1, 'sem overlay, só a linha do disco');

    // O poller "viu" a tabela mudar: o overlay tem uma linha nova...
    overlayAtual = overlayDeUmaLinhaNova();
    // ...e avisa a API, do jeito que `poller-realtime.ts` faz de verdade.
    s.servidor.aoTabelaMudar('HORA ATUALIZADO', 'hora-atualizado');

    const b = await (await s.busca('/api/dashboards/capa?recalcula=1')).json();
    assert.equal(
      linhasDaTabela(b, 'HORA ATUALIZADO'),
      2,
      'aoTabelaMudar tem de derrubar o cache da worker, não só o da thread principal — ' +
        'senão o realtime vira transporte sem atualização (o bug de overlay-worker.test.ts, um nível abaixo)',
    );
  } finally {
    await s.fecha();
  }
});

test('sem aoTabelaMudar, um dataset já carregado continua servindo o mesmo overlay (o contrato que sustenta o cache)', async () => {
  // O par do teste anterior: prova que a cache REALMENTE está segurando o
  // dataset entre pedidos (e não só, por acidente, recarregando toda vez com
  // o mesmo resultado). Muda o overlay SEM avisar `aoTabelaMudar` — o 2º
  // pedido tem de continuar vendo a versão antiga, porque essa é exatamente a
  // garantia que permite pular o disco quando nada mudou.
  const dir = await dirComCapa();
  let overlayAtual: ReadonlyMap<string, OverlayDeTabela> = new Map();
  const s = await sobe(dir, () => overlayAtual);
  try {
    const a = await (await s.busca('/api/dashboards/capa?recalcula=1')).json();
    assert.equal(linhasDaTabela(a, 'HORA ATUALIZADO'), 1);

    overlayAtual = overlayDeUmaLinhaNova();
    // (nenhum aoTabelaMudar aqui, de propósito)

    const b = await (await s.busca('/api/dashboards/capa?recalcula=1')).json();
    assert.equal(
      linhasDaTabela(b, 'HORA ATUALIZADO'),
      1,
      'a cache não estava realmente segurando o dataset — se o número mudou sem invalidação, o "cache" está sempre recarregando',
    );
  } finally {
    await s.fecha();
  }
});

// --------------------------------------------------------------------------
// O ESCOPO DA INVALIDAÇÃO (21/09/2026)
//
// A chave do cache de RESPOSTA é escopada por página desde 09/09
// (`carimboDaPagina`): um refresh de tabela que a página não lê não a invalida.
// O DATASET não tinha acompanhado — `identidadeAtual()`, global, ia para a
// worker, e lá `cacheDeCarga.clear()` derrubava TODAS as páginas de TODAS as
// threads. Amostrado na API no ar, sem ninguém na tela: 4 mudanças de carimbo
// em 6 minutos, uma a cada 1,5 min.
//
// O preço não era o recálculo, era a RELEITURA DO DISCO. Medido em
// `visao-geral`: 2 ms do cache, 219 ms recalculada com as tabelas em memória,
// 2250 ms recalculada tendo de relê-las.
//
// Os dois testes abaixo são um par, e só valem juntos: o primeiro prova que o
// escopo existe, o segundo que ele não virou "nunca invalida". Sem o segundo,
// apagar a invalidação inteira passaria no primeiro.

/** Rematerializa `clima-tempo` — uma query que `capa` NÃO lê — mexendo só no
 *  manifesto. É o que um `npm run refresh` de outro grupo faz ao carimbo. */
async function rematerializaQueryAlheia(dir: string): Promise<void> {
  const m = leManifesto(dir);
  assert.ok(m, 'o manifesto tem de existir para este teste dizer alguma coisa');
  await escreveManifesto(dir, [
    ...m.tabelas,
    {
      query: 'clima-tempo',
      tabelas: ['Clima/ Tempo'],
      linhas: 3,
      colunas: 2,
      bytes: 100,
      geradoEm: '2026-08-07T11:30:00.000Z',
    },
  ]);
}

test('refresh de tabela que a página NÃO lê deixa o dataset dela de pé', async () => {
  const dir = await dirComCapa();
  const s = await sobe(dir, () => new Map());
  try {
    assert.equal(s.servidor.piscinaAtiva, true, 'este teste só vale alguma coisa com a piscina ligada');

    const a = await (await s.busca('/api/dashboards/capa?recalcula=1')).json();
    assert.equal(linhasDaTabela(a, 'HORA ATUALIZADO'), 1);

    // O carimbo GLOBAL muda aqui. O de `capa` — só `hora-atualizado` — não.
    await rematerializaQueryAlheia(dir);

    // Mesma prova dos testes acima: se a worker relesse o disco, cairia em 409.
    fs.rmSync(arquivoDaQuery(dir, 'hora-atualizado'));

    const b = await (await s.busca('/api/dashboards/capa?recalcula=1')).json();
    assert.equal(
      linhasDaTabela(b, 'HORA ATUALIZADO'),
      1,
      'o dataset de `capa` caiu por causa de um refresh de `clima-tempo`, que ela não lê — ' +
        'é a invalidação global de volta, e com ela ~2 s de releitura de disco por página alcançada',
    );
  } finally {
    await s.fecha();
  }
});

test('refresh de tabela que a página LÊ derruba o dataset dela — o escopo não é "nunca invalida"', async () => {
  const dir = await dirComCapa();
  const s = await sobe(dir, () => new Map());
  try {
    const a = await (await s.busca('/api/dashboards/capa?recalcula=1')).json();
    assert.equal(linhasDaTabela(a, 'HORA ATUALIZADO'), 1);

    // Agora a própria tabela de `capa` foi rematerializada — `geradoEm` novo é o
    // que o carimbo mede, e é o que TEM de alcançá-la.
    const m = leManifesto(dir);
    assert.ok(m);
    await escreveManifesto(
      dir,
      m.tabelas.map((t) => ({ ...t, geradoEm: '2026-08-07T11:59:00.000Z' })),
    );

    fs.rmSync(arquivoDaQuery(dir, 'hora-atualizado'));

    const r = await s.busca('/api/dashboards/capa?recalcula=1');
    assert.equal(
      r.status,
      409,
      'o dataset sobreviveu a um refresh da tabela que a própria página lê — ' +
        'o escopo por página virou "nunca invalida", e a tela serviria o número de antes do refresh',
    );
  } finally {
    await s.fecha();
  }
});
