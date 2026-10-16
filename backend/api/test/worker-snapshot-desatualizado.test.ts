// Recusa "Snapshot desatualizado" da worker: espera o recongelamento quando é
// passageira, e nunca cai para o cálculo em linha (a thread principal lê o mesmo
// disco e recusaria igual, depois de carregar a página inteira). Medido em
// 16/10/2026: 9 quedas em 6 h, todas terminando em HTTP 409.

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
const AGORA = new Date('2026-08-07T12:00:00.000Z');

const PASSAGEIRA =
  "Snapshot desatualizado: 'CALENDARIO CRIADO' foi congelada em 2026-10-16T16:52:26.799Z, antes da " +
  "materialização mais recente de 'PROTOCOLOS GERAL', de que ela nasce (2026-10-16T17:09:36.670Z).";
const PERMANENTE =
  "Snapshot desatualizado: o DAX de 'CALENDARIO CRIADO'[PESO] mudou desde a materialização (a -> b).";

async function dirComCapa(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-desatualizado-'));
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

/** A piscina de verdade, com as primeiras `falhas` tarefas recusadas por `motivo`. */
function piscinaQueRecusa(motivo: string, falhas: number): { piscina: PiscinaWorkers; pedidos: () => number } {
  const piscina = new PiscinaWorkers({ tamanhoPool: 1 });
  const original = piscina.executa.bind(piscina);
  let n = 0;
  piscina.executa = ((...args: Parameters<PiscinaWorkers['executa']>) => {
    n += 1;
    return n <= falhas ? Promise.reject(new Error(motivo)) : original(...args);
  }) as PiscinaWorkers['executa'];
  return { piscina, pedidos: () => n };
}

async function sobe(snapshotDir: string, piscina: PiscinaWorkers) {
  const servidor = new Servidor({
    acesso: ACESSO_LIBERADO,
    root: ROOT,
    snapshotDir,
    webDir: WEB,
    agora: () => AGORA,
    identifica: () => ({ usuario: 'teste', papeis: ['autenticado'] }),
    piscinaWorkers: piscina,
  });
  const http = servidor.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  const busca = (rota: string): Promise<Response> => fetch(`http://127.0.0.1:${port}${rota}`);
  return {
    busca,
    contadores: async (): Promise<Record<string, number>> =>
      (await (await busca('/api/saude')).json()).realtime.contadores,
    fecha: () =>
      new Promise<void>((ok) => {
        servidor.destroi();
        http.closeAllConnections?.();
        http.close(() => ok());
      }),
  };
}

test('refresh recongelando: o pedido espera e recebe a página, sem cálculo em linha', async () => {
  const { piscina, pedidos } = piscinaQueRecusa(PASSAGEIRA, 2);
  const s = await sobe(await dirComCapa(), piscina);
  try {
    const r = await s.busca('/api/dashboards/capa');
    assert.equal(r.status, 200, 'a janela do recongelamento não pode virar erro na tela');
    assert.equal(pedidos(), 3, 'duas recusas e a terceira tentativa');
    const c = await s.contadores();
    assert.equal(c.worker_espera_recongelamento, 2);
    assert.equal(c.worker_fallback ?? 0, 0, 'a thread principal não carregou nada');
  } finally {
    await s.fecha();
    piscina.destroi();
  }
});

test('recusa permanente: 409 na hora, sem esperar e sem carregar a página na thread principal', async () => {
  // Antes de 16/10/2026 este pedido saía 200: a thread principal recalculava em linha.
  // Aqui ela aceitaria (o disco do teste é íntegro); em produção, recusaria igual —
  // e só depois de carregar a página inteira.
  const { piscina, pedidos } = piscinaQueRecusa(PERMANENTE, Infinity);
  const s = await sobe(await dirComCapa(), piscina);
  try {
    const r = await s.busca('/api/dashboards/capa');
    assert.equal(r.status, 409);
    assert.match((await r.json()).erro, /o DAX de 'CALENDARIO CRIADO'/);
    assert.equal(pedidos(), 1, 'esperar não conserta DAX mudado');
    const c = await s.contadores();
    assert.equal(c.worker_snapshot_desatualizado, 1);
    assert.equal(c.worker_fallback ?? 0, 0);
  } finally {
    await s.fecha();
    piscina.destroi();
  }
});
