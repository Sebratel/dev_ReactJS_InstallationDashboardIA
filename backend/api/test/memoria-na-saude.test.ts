// O bloco `memoria` de `GET /api/saude`: quem gasta a RAM da API, separado por dono.
//
// **Por que existe (16/10/2026).** A API bateu no teto de 3 GB do contêiner e a saúde só
// dizia `rssMB` e `heapUsedMB` da thread principal — nada das colunas fora do heap
// (`arrayBuffers`), nada das workers. Estes testes guardam três coisas:
//
//   1. a versão completa traz processo, workers e caches — e a medida da worker vem de
//      DENTRO dela, não uma cópia da principal;
//   2. o anônimo não vê nada disso, nem paga a pergunta às workers (PLANO-SEGURANCA);
//   3. uma worker que não responde NÃO segura a saúde — que é o healthcheck do
//      contêiner, com prazo de 5 s. Sem este, o defeito seria um contêiner reiniciado
//      em laço por estar ocupado calculando.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CacheEmCamadas } from '../../packages/query-engine/src/cache-camadas.ts';
import { MemoryCache } from '../../packages/query-engine/src/cache-memory.ts';
import type { DashboardSpec } from '../../packages/widget-engine/src/spec.ts';
import { ESCOPO_TODOS } from '../src/escopo-cache.ts';
import { entradasDoCache, type MemoriaDeWorkerNaSaude } from '../src/memoria-da-saude.ts';
import { PiscinaWorkers, configuracaoDaPiscina } from '../src/piscina-workers.ts';
import { Servidor } from '../src/servidor.ts';
import type { MensagemCalculoWorker } from '../src/worker-calculador.ts';
import { ACESSO_LIBERADO } from './fixtures/acesso.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(AQUI, '..', '..', '..');
const RESPONDE = path.join(AQUI, 'fixtures', 'worker-que-responde.ts');
const OCUPADA = path.join(AQUI, 'fixtures', 'worker-memoria-ocupada.ts');
const WEB = fs.mkdtempSync(path.join(os.tmpdir(), 'web-memoria-'));
fs.writeFileSync(path.join(WEB, 'index.html'), '<title>Analytics Platform</title>');

/** Uma tarefa válida em forma; `janela.de` é quanto a worker ocupada segura a thread. */
function tarefa(ocupadaMs: number): Omit<MensagemCalculoWorker, 'idReq'> {
  return {
    snapshotDir: path.join(AQUI, 'nao-existe'),
    specsDir: path.join(AQUI, 'nao-existe'),
    dashboardSpec: { id: 'fixture', name: 'fixture', visuals: [] } as unknown as DashboardSpec,
    janela: { de: ocupadaMs, linhas: 10 },
    clicados: [],
    agoraIso: '2026-10-16T12:00:00.000Z',
    identidade: 'fixture@2026-10-16',
    escopo: ESCOPO_TODOS,
  };
}

/** Conta quantas vezes a saúde perguntou às workers — para provar que o anônimo não pergunta. */
class PiscinaContada extends PiscinaWorkers {
  perguntas = 0;
  override async memoria(prazoMs?: number): Promise<MemoriaDeWorkerNaSaude[]> {
    this.perguntas++;
    return super.memoria(prazoMs);
  }
}

async function sobe(opts: {
  piscina: PiscinaWorkers;
  /** Com login configurado, quem chega sem cookie é anônimo de verdade. */
  comLogin?: boolean;
  /** Finge que o pedido veio de outra máquina — `saudeCompletaPara` lê o socket. */
  enderecoRemoto?: string;
}): Promise<{ busca: (rota: string) => Promise<Response>; fecha: () => Promise<void> }> {
  const inst = new Servidor({
    acesso: ACESSO_LIBERADO,
    root: ROOT,
    snapshotDir: fs.mkdtempSync(path.join(os.tmpdir(), 'api-memoria-')),
    webDir: WEB,
    agora: () => new Date('2026-10-16T12:00:00.000Z'),
    piscinaWorkers: opts.piscina,
    ...(opts.comLogin ? { firebaseProjectId: 'projeto-de-teste' } : { identifica: () => ({ usuario: 'teste', papeis: ['autenticado'] }) }),
  });
  const http: Server = inst.criaHttp();
  if (opts.enderecoRemoto !== undefined) {
    // O teste só alcança a API por 127.0.0.1, que é justamente o endereço que recebe o
    // corpo completo. Sobrescrever `remoteAddress` no socket, antes do pedido ser lido,
    // é o jeito de exercitar o caminho anônimo pela rota de verdade.
    const endereco = opts.enderecoRemoto;
    http.prependListener('connection', (sock) => {
      Object.defineProperty(sock, 'remoteAddress', { value: endereco });
    });
  }
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  return {
    busca: (rota) => fetch(`http://127.0.0.1:${port}${rota}`),
    fecha: () =>
      new Promise<void>((ok) => {
        inst.destroi();
        opts.piscina.destroi();
        http.closeAllConnections?.();
        http.close(() => ok());
      }),
  };
}

interface BlocoMemoria {
  rssMB: number;
  heapUsedMB: number;
  processo: Record<string, number>;
  workers: MemoriaDeWorkerNaSaude[];
  caches: { respostas: number | null; valoresDistintos: number; paginasCarregadas: number; visuais: { itens: number; mb: number } };
}

test('a saúde completa traz memória do processo, de cada worker (medida nela) e dos caches', async () => {
  // O calculador de verdade: é ele que tem de saber responder a pergunta.
  const piscina = new PiscinaWorkers({ tamanhoPool: 1 });
  const s = await sobe({ piscina });
  try {
    // A worker real leva um tempo para subir (importa o motor inteiro), e a primeira
    // pergunta pode vencer o prazo. A resposta atrasada não se perde: a próxima saúde a
    // publica. Esperar por ela aqui também prova isso.
    let m: BlocoMemoria | undefined;
    const limite = Date.now() + 15_000;
    while (Date.now() < limite) {
      m = ((await (await s.busca('/api/saude')).json()) as { memoria: BlocoMemoria }).memoria;
      if (m.workers[0]?.medida) break;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    assert.ok(m, 'sem bloco memoria');

    // Os dois nomes de sempre continuam no topo: as sondas leem `memoria.rssMB`.
    assert.ok(m.rssMB > 0);
    assert.equal(m.rssMB, m.processo.rssMB);
    for (const k of ['rssMB', 'heapTotalMB', 'heapUsedMB', 'heapLimiteMB', 'externalMB', 'arrayBuffersMB']) {
      assert.ok(Number.isFinite(m.processo[k]), `processo.${k} ausente`);
    }

    assert.equal(m.workers.length, 1);
    const w = m.workers[0]!;
    assert.ok(w.medida, 'a worker de verdade não respondeu em 15 s');
    assert.equal(typeof w.threadId, 'number');
    assert.equal(w.medida.threadId, w.threadId, 'a medida é da própria worker');
    assert.ok(w.medida.heapUsedMB > 0);
    assert.ok(Number.isFinite(w.medida.arrayBuffersMB) && Number.isFinite(w.medida.externalMB));
    assert.ok(!('rssMB' in w.medida), 'RSS dentro da worker é o do processo — não pode sair por worker');
    // O teto medido é o `resourceLimits` da worker, não o heap da principal — prova de que
    // o número saiu de DENTRO dela. A folga cobre as gerações novas, que o V8 soma ao limite.
    assert.ok(
      w.medida.heapLimiteMB <= configuracaoDaPiscina().heapPorWorkerMB + 256,
      `heapLimiteMB ${w.medida.heapLimiteMB} não é o teto de uma worker`,
    );
    assert.equal(w.medida.datasets, 0);
    assert.deepEqual(w.medida.visuais, { itens: 0, mb: 0 });
    assert.ok(w.idadeMs !== null && w.idadeMs >= 0);

    // Sem nada aberto, tudo zero — e `respostas` é número, porque o padrão é `MemoryCache`.
    assert.deepEqual(m.caches, {
      respostas: 0,
      valoresDistintos: 0,
      paginasCarregadas: 0,
      visuais: { itens: 0, mb: 0 },
    });
  } finally {
    await s.fecha();
  }
});

test('anônimo de outra máquina não vê o bloco memoria — nem dispara a pergunta às workers', async () => {
  const piscina = new PiscinaContada({ desativado: true });
  const s = await sobe({ piscina, comLogin: true, enderecoRemoto: '10.1.1.50' });
  try {
    const r = await s.busca('/api/saude');
    assert.equal(r.status, 200);
    const corpo = (await r.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(corpo).sort(), ['degradado', 'ok']);
    assert.equal(piscina.perguntas, 0);
  } finally {
    await s.fecha();
  }

  // O controle: o MESMO arranjo, da própria máquina, recebe o bloco. Sem ele, um
  // `remoteAddress` que não pegasse faria o teste acima passar por outro motivo.
  const controle = new PiscinaContada({ desativado: true });
  const s2 = await sobe({ piscina: controle, comLogin: true });
  try {
    const corpo = (await (await s2.busca('/api/saude')).json()) as { memoria?: BlocoMemoria };
    assert.ok(corpo.memoria?.processo, 'de 127.0.0.1 o corpo é o completo');
    assert.deepEqual(corpo.memoria.workers, [], 'piscina desligada: lista vazia, não erro');
    assert.equal(controle.perguntas, 1);
  } finally {
    await s2.fecha();
  }
});

test('worker que não responde não segura a saúde: sai com medida null, dentro do prazo', async () => {
  // A fixture ignora a pergunta de memória — o mesmo que uma worker presa num cálculo.
  const piscina = new PiscinaWorkers({ tamanhoPool: 1, scriptDaWorker: RESPONDE });
  const s = await sobe({ piscina });
  try {
    const t0 = Date.now();
    const r = await s.busca('/api/saude');
    const ms = Date.now() - t0;
    assert.equal(r.status, 200);
    const { memoria } = (await r.json()) as { memoria: BlocoMemoria };
    assert.equal(memoria.workers.length, 1);
    assert.equal(memoria.workers[0]!.medida, null);
    assert.equal(memoria.workers[0]!.idadeMs, null);
    // O prazo é 250 ms; 3 s de folga para máquina de CI lenta, bem abaixo dos 5 s do healthcheck.
    assert.ok(ms < 3000, `a saúde levou ${ms} ms esperando a worker`);
  } finally {
    await s.fecha();
  }
});

test('worker ocupada sai com a ÚLTIMA medida e a idade dela; a resposta atrasada não se perde', async () => {
  const p = new PiscinaWorkers({ tamanhoPool: 1, scriptDaWorker: OCUPADA });
  try {
    // A fixture sobe rápido, mas não instantâneo: prazo largo na primeira.
    const [primeira] = await p.memoria(5000);
    assert.ok(primeira?.medida, 'a worker ociosa tinha de responder');

    const calculo = p.executa(tarefa(1200));
    // Dá tempo de a tarefa ser despachada e a worker entrar no laço ocupado.
    await new Promise((ok) => setTimeout(ok, 200));

    const t0 = Date.now();
    const [durante] = await p.memoria(100);
    assert.ok(Date.now() - t0 < 1000, 'esperou a worker terminar o cálculo');
    assert.ok(durante?.medida, 'a medida anterior tinha de continuar publicada');
    assert.ok(durante.idadeMs !== null && durante.idadeMs >= 200, `idade ${durante.idadeMs} ms: a medida é a de antes`);

    // Segunda pergunta durante o mesmo cálculo: reaproveita a que está em voo.
    await p.memoria(50);

    await calculo;
    // A worker lê a pergunta pendente assim que solta a thread; a próxima saúde a vê nova.
    const limite = Date.now() + 3000;
    let depois: MemoriaDeWorkerNaSaude | undefined;
    while (Date.now() < limite) {
      [depois] = await p.memoria(500);
      if (depois?.idadeMs !== null && depois!.idadeMs! < 1000) break;
    }
    assert.ok(depois?.idadeMs !== null && depois!.idadeMs! < 1000, 'a resposta atrasada não atualizou a medida');
  } finally {
    p.destroi();
  }
});

test('entradasDoCache: conta a camada que mora no processo, e diz null quando não sabe', async () => {
  const rapida = new MemoryCache();
  const camadas = new CacheEmCamadas({ rapida, duravel: new MemoryCache() });
  await camadas.set('resp:a', 1, 60);
  await camadas.set('resp:b', 1, 60);
  assert.equal(entradasDoCache(camadas), 2);
  assert.equal(entradasDoCache(rapida), 2);
  assert.equal(entradasDoCache({ get: async () => undefined }), null, 'um Redis puro não guarda nada aqui');
});
