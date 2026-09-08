// O carimbo no `Servidor` de verdade — com disco de verdade e `fs.watch` de verdade.
//
// `carimbo-vigiado.test.ts` cobre a política com o observador na mão. Aqui o que
// está sob teste é a fiação: que o `Servidor` liga o observador no diretório
// certo, que `GET /api/saude` publica a procedência, e — o que mais importa —
// que **a conferida periódica é a segunda garantia de verdade**, e não só no
// papel.
//
// O caso decisivo é o último: com o observador morto, o `Aquecedor` tem de
// continuar notando um snapshot novo sozinho. Antes da F5 ele não notava, porque
// `identidadeAtual()` devolvia o memo — e o comentário de topo de `aquecedor.ts`
// dizia, o tempo todo, que ele trabalha "conferindo o carimbo do snapshot de
// tempos em tempos".
//
// REGRA DE SAÍDA: nada aqui imprime valor de linha.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { escreve } from '../../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery, escreveManifesto } from '../../../packages/snapshot/src/manifesto.ts';
import { Servidor } from '../src/servidor.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(AQUI, '..', '..', '..');
const WEB = path.join(ROOT, 'apps', 'api', 'web');

/** Grava um snapshot mínimo com a hora pedida — trocar a hora troca o carimbo. */
async function grava(dir: string, minuto: number): Promise<void> {
  const iso = `2026-08-07T10:${String(minuto).padStart(2, '0')}:00.000Z`;
  const cab = await escreve(
    arquivoDaQuery(dir, 'hora-atualizado'),
    { query: 'hora-atualizado', tabelas: ['HORA ATUALIZADO'], geradoEm: iso },
    ['datahora', 'data', 'hora'],
    [
      {
        datahora: new Date(iso),
        data: new Date('2026-08-07T00:00:00.000Z'),
        hora: new Date('1899-12-30T10:34:00.000Z'),
      },
    ],
  );
  await escreveManifesto(dir, [
    { query: 'hora-atualizado', tabelas: cab.tabelas, linhas: 1, colunas: 3, bytes: 200, geradoEm: cab.geradoEm },
  ]);
}

interface Estado {
  valor: string | null;
  fonte: string;
  watch: { status: string; motivo?: string };
  ultimaMudanca: string | null;
  ultimoCheck: string | null;
  checagens: number;
  mudancas: number;
  divergencias: number;
}

async function sobe(dir: string): Promise<{
  servidor: Servidor;
  carimbo: () => Promise<Estado>;
  fecha: () => Promise<void>;
}> {
  const servidor = new Servidor({
    root: ROOT,
    snapshotDir: dir,
    webDir: WEB,
    identifica: () => ({ usuario: 'teste', papeis: ['autenticado'] }),
  });
  const http = servidor.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  return {
    servidor,
    carimbo: async () =>
      (await (await fetch(`http://127.0.0.1:${port}/api/saude`)).json()).carimbo as Estado,
    fecha: () =>
      new Promise<void>((ok) => {
        servidor.destroi();
        http.close(() => ok());
        http.closeAllConnections();
      }),
  };
}

test('GET /api/saude responde POR QUE a API acredita neste snapshot', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carimbo-e2e-'));
  await grava(dir, 34);
  const s = await sobe(dir);
  try {
    const e = await s.carimbo();
    assert.ok(e.valor, 'o carimbo tem de estar publicado');
    assert.equal(e.watch.status, 'ativo', 'o observador subiu no diretório que existe');
    assert.equal(e.divergencias, 0);
    assert.ok(e.ultimoCheck, 'quando o disco foi lido pela última vez');
    assert.ok(e.ultimaMudanca, 'quando o valor mudou pela última vez');
    assert.ok(e.checagens >= 1);
  } finally {
    await s.fecha();
  }
});

test('sem diretório de snapshot, a saúde não acusa observador quebrado', async () => {
  const dir = path.join(os.tmpdir(), `carimbo-vazio-${Date.now()}`);
  const s = await sobe(dir);
  try {
    const e = await s.carimbo();
    assert.equal(e.watch.status, 'nao-tentado', 'não há o que observar — não é defeito');
  } finally {
    await s.fecha();
  }
});

test('o snapshot muda em disco e a CONFERIDA pega, mesmo sem o observador', async () => {
  // A segunda garantia, fim a fim. `destroi()` fecha o observador — do lado de
  // dentro, é indistinguível de um `fs.watch` que nunca entregou evento (mount
  // que sumiu, limite de inotify, diretório trocado por fora).
  //
  // ANTES DA F5 este teste não passava: `identidadeAtual()` devolvia o memo, e o
  // Aquecedor — que é quem chama essa função a cada 5 s — nunca teria notado.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carimbo-cego-'));
  await grava(dir, 34);
  const s = await sobe(dir);
  try {
    const antes = s.servidor.identidadeAtual();

    // Mata o observador, mas mantém o servidor de pé.
    s.servidor.destroi();
    await grava(dir, 59);

    const depois = s.servidor.identidadeAtual();
    assert.notEqual(
      depois,
      antes,
      'com o observador morto, a conferida periódica é a única coisa entre a API e ' +
        'servir o snapshot antigo para sempre',
    );

    const e = await s.carimbo();
    assert.ok(e.divergencias >= 1, 'e a divergência tem de aparecer na saúde');
    assert.equal(e.watch.status, 'morreu');
  } finally {
    await s.fecha();
  }
});

test('`identidadeAtual` lê o DISCO — é o que devolve os olhos ao Aquecedor', async () => {
  // O `Aquecedor` decide se há o que aquecer comparando `identidadeAtual()` com
  // o que ele já aqueceu. Se essa função devolvesse memo, um snapshot novo com o
  // watch mudo deixaria o aquecimento parado — e o sintoma seria "a primeira
  // pessoa da manhã espera 2 min", que é justamente o que o Aquecedor existe
  // para evitar.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carimbo-aquec-'));
  await grava(dir, 34);
  const s = await sobe(dir);
  try {
    const a = s.servidor.identidadeAtual();
    const checagensAntes = (await s.carimbo()).checagens;
    s.servidor.identidadeAtual();
    assert.ok(
      (await s.carimbo()).checagens > checagensAntes,
      'cada chamada tem de ser uma leitura de disco de verdade',
    );
    assert.equal(s.servidor.identidadeAtual(), a, 'e o valor não pode oscilar sem o disco mudar');
  } finally {
    await s.fecha();
  }
});
