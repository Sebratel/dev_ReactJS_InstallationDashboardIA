// A coleta da worker OCIOSA (fase 4, docs/DECISAO-AO-VIVO.md § Memória).
//
// **O defeito.** Uma worker parada não coleta — o V8 só coleta quando aloca —, e o pico
// do último cálculo ficava retido até a próxima página chegar a ela. Pior: mesmo depois de
// uma coleta comum, o V8 guarda as páginas liberadas num reservatório do processo, e o
// contêiner não as vê voltar. Medido em 27/10/2026 na imagem de produção
// (`npm run probe:memoria-workers`): API ociosa com 1.252 MB sem a coleta, 653 MB com a de
// último recurso.
//
// Este teste guarda o mecanismo com a worker de VERDADE: depois de uma tarefa, passado o
// prazo, a worker coletou — e a saúde o diz (`coletaOciosa`).

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { DashboardSpec } from '../../packages/widget-engine/src/spec.ts';
import { ESCOPO_TODOS } from '../src/escopo-cache.ts';
import { PiscinaWorkers } from '../src/piscina-workers.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

/** Uma tarefa que a worker recusa na hora (snapshot que não existe) — basta para marcar a coleta. */
const tarefa = {
  snapshotDir: path.join(AQUI, 'nao-existe'),
  specsDir: path.join(AQUI, 'nao-existe'),
  dashboardSpec: { id: 'fixture', name: 'fixture', visuals: [] } as unknown as DashboardSpec,
  janela: { de: 0, linhas: 10 },
  clicados: [],
  agoraIso: '2026-10-27T12:00:00.000Z',
  identidade: 'fixture@2026-10-27',
  escopo: ESCOPO_TODOS,
};

async function piscinaCom(coletaMs: string): Promise<PiscinaWorkers> {
  // A worker herda o ambiente do processo quando nasce.
  const antes = process.env.API_WORKER_COLETA_OCIOSA_MS;
  process.env.API_WORKER_COLETA_OCIOSA_MS = coletaMs;
  try {
    return new PiscinaWorkers({ tamanhoPool: 1 });
  } finally {
    if (antes === undefined) delete process.env.API_WORKER_COLETA_OCIOSA_MS;
    else process.env.API_WORKER_COLETA_OCIOSA_MS = antes;
  }
}

async function medida(piscina: PiscinaWorkers) {
  const limite = Date.now() + 15_000;
  while (Date.now() < limite) {
    const [w] = await piscina.memoria(2000);
    if (w?.medida) return w.medida;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  throw new Error('a worker de verdade não respondeu em 15 s');
}

test('depois de uma tarefa, a worker ociosa coleta — e a saúde conta', async () => {
  const piscina = await piscinaCom('50');
  try {
    await piscina.executa(tarefa).catch(() => undefined);
    let m = await medida(piscina);
    for (let i = 0; i < 50 && (m.coletaOciosa?.vezes ?? 0) === 0; i++) {
      await new Promise((ok) => setTimeout(ok, 100));
      m = await medida(piscina);
    }
    assert.ok(m.coletaOciosa, 'a medida não traz a coleta ociosa');
    assert.ok(m.coletaOciosa.vezes >= 1, 'a worker parada não coletou');
    assert.ok(m.coletaOciosa.maiorMs >= m.coletaOciosa.ultimaMs);
  } finally {
    piscina.destroi();
  }
});

test('API_WORKER_COLETA_OCIOSA_MS=0 desliga, e a saúde não finge que há coleta', async () => {
  const piscina = await piscinaCom('0');
  try {
    await piscina.executa(tarefa).catch(() => undefined);
    await new Promise((ok) => setTimeout(ok, 300));
    const m = await medida(piscina);
    assert.equal(m.coletaOciosa, undefined);
  } finally {
    piscina.destroi();
  }
});
