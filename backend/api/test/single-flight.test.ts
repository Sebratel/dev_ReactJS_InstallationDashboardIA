// O single-flight ponta a ponta: HTTP, chave de cache real, worker de verdade.
//
// **O cenário que estes testes reproduzem foi MEDIDO antes de existirem.** Na API
// real, com `snapshot/` de produção e 2 workers, 6 GET idênticos e simultâneos em
// MISS contra `diario-instalacao`:
//
//     req1..req4 ..... 15,5 s
//     req5, req6 ..... 25,7 s
//     worker_ms ...... média 10,3 s, pico 17,5 s
//     concorrentes_mesma_chave_max = 4   calculos_duplicados = 4
//
// Seis pedidos pela mesma resposta, seis cálculos, numa piscina de duas workers.
//
// **E o SSE fabrica essa rajada de propósito.** É o `test('a rajada que o SSE
// provoca…')` lá embaixo: o poller invalida a página, todos os navegadores com
// ela aberta acordam no mesmo instante e pedem a MESMA chave, logo depois de a
// entrada ter sido apagada. Antes desta peça, cada evento de realtime custava um
// cálculo por espectador.
//
// A afirmação central é sempre `duracoes.worker_ms.n` — quantas vezes o cálculo
// REALMENTE rodou. Contar respostas provaria só que o servidor respondeu; o que
// está em jogo é o trabalho que ele deixou de fazer.

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

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(AQUI, '..', '..', '..');
const WEB = path.join(ROOT, 'frontend', 'dist');
const AGORA = new Date('2026-08-07T12:00:00.000Z');
/** Ver `backend/api/test/fixtures/worker-que-morre.ts` e `piscina-ciclo-de-vida.test.ts`. */
const WORKER_QUE_MORRE = path.join(AQUI, 'fixtures', 'worker-que-morre.ts');

/** Falha com mensagem legível em vez de pendurar a suíte. */
function comPrazo<T>(p: Promise<T>, ms: number, oQue: string): Promise<T> {
  let t: NodeJS.Timeout;
  const prazo = new Promise<never>((_, erro) => {
    t = setTimeout(
      () => erro(new Error(`${oQue}: nada aconteceu em ${ms} ms — os pedidos ficaram PENDENTES`)),
      ms,
    );
  });
  return Promise.race([p, prazo]).finally(() => clearTimeout(t));
}

async function dirComCapa(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'single-flight-'));
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

async function sobe(snapshotDir: string, piscina?: PiscinaWorkers): Promise<{
  servidor: Servidor;
  busca: (rota: string, init?: RequestInit) => Promise<Response>;
  metricas: () => Promise<{
    contadores: Record<string, number>;
    duracoes: Record<string, { n: number; mediaMs: number; maxMs: number }>;
  }>;
  fecha: () => Promise<void>;
}> {
  const servidor = new Servidor({
    root: ROOT,
    snapshotDir,
    webDir: WEB,
    agora: () => AGORA,
    identifica: () => ({ usuario: 'teste', papeis: ['autenticado'] }),
    ...(piscina ? { piscinaWorkers: piscina } : {}),
  });
  const http = servidor.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  const busca = (rota: string, init?: RequestInit): Promise<Response> =>
    fetch(`http://127.0.0.1:${port}${rota}`, init);
  return {
    servidor,
    busca,
    metricas: async () => (await (await busca('/api/saude')).json()).realtime,
    fecha: () =>
      new Promise<void>((ok) => {
        servidor.destroi();
        http.closeAllConnections?.();
        http.close(() => ok());
      }),
  };
}

/** Quantas vezes o cálculo rodou de verdade nesta subida. */
function calculos(m: { duracoes: Record<string, { n: number }> }): number {
  return m.duracoes.worker_ms?.n ?? 0;
}

test('seis GET idênticos e simultâneos em MISS geram UM cálculo', async () => {
  const s = await sobe(await dirComCapa());
  try {
    const respostas = await Promise.all(
      Array.from({ length: 6 }, () => s.busca('/api/dashboards/capa')),
    );
    const corpos = await Promise.all(respostas.map((r) => r.json()));

    for (const r of respostas) assert.equal(r.status, 200, 'todos têm de ser atendidos');

    const m = await s.metricas();
    assert.equal(calculos(m), 1, `esperava 1 cálculo para 6 pedidos iguais, houve ${calculos(m)}`);
    assert.equal(m.contadores.singleflight_iniciados, 1);
    assert.equal(m.contadores.singleflight_coalescidos, 5);
    // A rajada continua existindo — ela só parou de custar. É por isso que o
    // contador da rajada e o do single-flight são números diferentes.
    assert.equal(m.contadores.concorrentes_mesma_chave_max, 6);

    // Os seis corpos são o MESMO resultado: um cálculo servindo seis respostas
    // não pode entregar seis números.
    const primeiro = JSON.stringify({ ...corpos[0], cache: undefined });
    for (const c of corpos) assert.equal(JSON.stringify({ ...c, cache: undefined }), primeiro);

    // Um iniciou (`miss`), cinco pegaram carona (`coalescido`). É o que torna o
    // ganho visível de fora, sem cronômetro.
    const estados = corpos.map((c) => c.cache).sort();
    assert.deepEqual(estados, ['coalescido', 'coalescido', 'coalescido', 'coalescido', 'coalescido', 'miss']);
  } finally {
    await s.fecha();
  }
});

test('pedidos de RECORTES diferentes não se fundem — cada um calcula o seu', async () => {
  // A dedupe é por chave de cálculo, não por página. Fundir por página serviria o
  // número de um filtro para quem pediu outro, que é o pior resultado possível
  // deste projeto — pior que calcular duas vezes.
  const s = await sobe(await dirComCapa());
  try {
    await Promise.all([
      s.busca('/api/dashboards/capa'),
      s.busca('/api/dashboards/capa?linhas=10'),
      s.busca('/api/dashboards/capa?linhas=20'),
    ]);
    const m = await s.metricas();
    assert.equal(calculos(m), 3, 'três janelas diferentes são três cálculos diferentes');
    assert.equal(m.contadores.singleflight_coalescidos, undefined, 'nada deveria ter pegado carona');
  } finally {
    await s.fecha();
  }
});

test('a rajada que o SSE provoca: invalidou, todos acordam, UM cálculo', async () => {
  // O caminho completo do near-realtime, sem o navegador:
  //   poller acha mudança -> aoTabelaMudar invalida a página e emite o evento
  //   -> N clientes acordam e pedem a MESMA chave, com o cache já apagado.
  // Antes do single-flight, isso custava um cálculo por espectador — e o evento
  // pode repetir a cada 12 s, que é o intervalo do poller.
  const s = await sobe(await dirComCapa());
  try {
    // Página quente, como estaria com gente olhando.
    assert.equal((await (await s.busca('/api/dashboards/capa')).json()).cache, 'miss');
    assert.equal((await (await s.busca('/api/dashboards/capa')).json()).cache, 'hit');
    const metricasAntes = await s.metricas();
    const antes = calculos(metricasAntes);
    const hitsAntes = metricasAntes.contadores.cache_hits ?? 0;

    // O poller acha mudança na query que a `capa` usa.
    s.servidor.aoTabelaMudar('HORA ATUALIZADO', 'hora-atualizado');

    // Vinte navegadores acordam ao mesmo tempo.
    const respostas = await Promise.all(
      Array.from({ length: 20 }, () => s.busca('/api/dashboards/capa')),
    );
    for (const r of respostas) assert.equal(r.status, 200);

    const m = await s.metricas();
    assert.equal(
      calculos(m) - antes,
      1,
      `20 clientes acordados pelo SSE geraram ${calculos(m) - antes} cálculos; esperava 1`,
    );
    // Não necessariamente 19 `coalescido` puros: com o cálculo carregando o
    // dataset já quente na worker (09/09/2026, `cacheDeCarga` em
    // `worker-calculador.ts`), o PRIMEIRO dos vinte pode terminar — e já ter
    // gravado a resposta em `CacheDeResposta` — antes de o VIGÉSIMO sequer
    // entrar no `vooUnico`. Esse chega como `hit` comum, não como carona no
    // voo, mas prova exatamente a mesma coisa que `coalescido` prova: não
    // disparou cálculo novo. A soma dos dois é que não pode variar — é ela,
    // não o rótulo de qual dos dois, que fecha com `calculos(m) - antes === 1`.
    const hitsNaRajada = (m.contadores.cache_hits ?? 0) - hitsAntes;
    assert.equal(
      (m.contadores.singleflight_coalescidos ?? 0) + hitsNaRajada,
      19,
      `19 dos 20 pedidos tinham de aproveitar o cálculo único, via voo ou via cache — ` +
        `${m.contadores.singleflight_coalescidos ?? 0} coalescidos + ${hitsNaRajada} hits = ` +
        `${(m.contadores.singleflight_coalescidos ?? 0) + hitsNaRajada}`,
    );
  } finally {
    await s.fecha();
  }
});

test('o voo NÃO sobrevive à mudança do snapshot: carimbo novo é chave nova', async () => {
  // A garantia do requisito 18, e ela sai de graça porque a chave do voo é a
  // chave do cache, que já carrega o carimbo. O que este teste guarda é que
  // ninguém troque a chave do voo por algo "mais barato" (o id da página, por
  // exemplo) — aí um pedido feito depois do refresh entraria no voo iniciado
  // sobre o dado velho e receberia o número de antes, sem nada dizendo que era.
  const dir = await dirComCapa();
  const s = await sobe(dir);
  try {
    assert.equal((await (await s.busca('/api/dashboards/capa')).json()).cache, 'miss');
    assert.equal((await (await s.busca('/api/dashboards/capa')).json()).cache, 'hit');

    // Um refresh: mesma query, `geradoEm` novo. O carimbo muda, e com ele a
    // chave — de resposta e de voo.
    const manifesto = JSON.parse(fs.readFileSync(path.join(dir, 'manifesto.json'), 'utf8'));
    manifesto.tabelas[0].geradoEm = '2026-08-07T11:30:00.000Z';
    fs.writeFileSync(path.join(dir, 'manifesto.json'), JSON.stringify(manifesto));

    // Desde 28/09/2026 (ACHADOS #164) o primeiro pedido depois do refresh sai com a
    // versão ANTERIOR, dita como tal — e o recálculo é um voo NOVO, na chave nova. Se a
    // chave do voo não levasse o carimbo, ele entraria no voo velho e a resposta
    // seguinte seria `anterior` para sempre.
    const antes = calculos(await s.metricas());
    const depois = await (await s.busca('/api/dashboards/capa')).json();
    assert.equal(depois.cache, 'anterior', 'a tela recebe a versão pronta, dita como anterior');
    let seguinte = depois;
    for (let i = 0; i < 500 && seguinte.cache === 'anterior'; i++) {
      await new Promise((r) => setTimeout(r, 20));
      seguinte = await (await s.busca('/api/dashboards/capa')).json();
    }
    assert.equal(seguinte.cache, 'hit', 'o recálculo de fundo chegou, na chave do snapshot novo');
    assert.equal(calculos(await s.metricas()) - antes, 1, 'um cálculo novo, e só um');
  } finally {
    await s.fecha();
  }
});

test('o cache continua sendo preenchido UMA vez, e o pedido seguinte acerta', async () => {
  // "Cache preenchido durante o voo não deixa estado inconsistente": a gravação
  // mora DENTRO do voo, então ela acontece uma vez, e não uma por carona. O que
  // se afirma aqui é o efeito observável disso — depois da rajada, o cache está
  // quente e o próximo pedido é `hit`, não `miss`.
  const s = await sobe(await dirComCapa());
  try {
    await Promise.all(Array.from({ length: 4 }, () => s.busca('/api/dashboards/capa')));
    const seguinte = await (await s.busca('/api/dashboards/capa')).json();
    assert.equal(seguinte.cache, 'hit');
    const m = await s.metricas();
    assert.equal(calculos(m), 1);
    assert.equal(m.contadores.cache_hits, 1);
  } finally {
    await s.fecha();
  }
});

test('página inexistente continua 404, e não entra em voo nenhum', async () => {
  // O single-flight ficou DEPOIS de toda validação de pedido, e é onde tem de
  // estar: erro de 400/404 é função do pedido, não do cálculo, e coalescê-lo
  // faria um pedido malformado esperar por outro.
  const s = await sobe(await dirComCapa());
  try {
    const r = await s.busca('/api/dashboards/nao-existe');
    assert.equal(r.status, 404);
    const m = await s.metricas();
    assert.equal(calculos(m), 0, 'um 404 não pode ter disparado cálculo nenhum');
  } finally {
    await s.fecha();
  }
});

test('sem snapshot: os N que esperavam recebem 409, e o pedido seguinte tenta de novo', async () => {
  // O erro tem de chegar a TODOS os que esperavam pelo voo (é a única resposta
  // honesta: eles pediram o mesmo cálculo), e a chave tem de ficar livre. Se a
  // promessa rejeitada continuasse registrada, aquela página passaria a devolver
  // a mesma falha para sempre — até alguém reiniciar o processo.
  const vazio = fs.mkdtempSync(path.join(os.tmpdir(), 'single-flight-vazio-'));
  const s = await sobe(vazio);
  try {
    const respostas = await Promise.all(
      Array.from({ length: 3 }, () => s.busca('/api/dashboards/capa')),
    );
    for (const r of respostas) {
      assert.equal(r.status, 409, 'falta de snapshot é 409, e chega a todos');
      assert.match((await r.json()).erro, /.+/);
    }
    // E de novo: a chave não ficou envenenada pela falha anterior.
    assert.equal((await s.busca('/api/dashboards/capa')).status, 409);
  } finally {
    await s.fecha();
  }
});

test('a worker MORRE no meio do voo: os N que esperavam são atendidos, e a chave fica livre', async () => {
  // O cruzamento das duas fases, e o motivo de o conserto do ciclo de vida ter
  // entrado junto com a F2. Antes dele, uma worker morta pendurava UM pedido;
  // com o single-flight ela penduraria o VOO daquela chave, e todo pedido
  // seguinte entraria nesse voo — a página inteira travada, para todo mundo,
  // até o carimbo do snapshot mudar. A mecânica isolada está em
  // `piscina-ciclo-de-vida.test.ts`; aqui o que se afirma é o efeito visível de
  // fora.
  const piscina = new PiscinaWorkers({ tamanhoPool: 1, scriptDaWorker: WORKER_QUE_MORRE });
  const s = await sobe(await dirComCapa(), piscina);
  try {
    const respostas = await comPrazo(
      Promise.all(Array.from({ length: 5 }, () => s.busca('/api/dashboards/capa'))),
      15000,
      'os 5 pedidos coalescidos no voo cuja worker morreu',
    );
    for (const r of respostas) assert.equal(r.status, 200, 'a morte da worker não pode virar erro na tela');

    const corpos = await Promise.all(respostas.map((r) => r.json()));
    // Um iniciou o voo, quatro pegaram carona — e a carona não virou espera
    // eterna. Este é o assert que ficaria PENDENTE sem o handler de `exit`.
    assert.deepEqual(
      corpos.map((c) => c.cache).sort(),
      ['coalescido', 'coalescido', 'coalescido', 'coalescido', 'miss'],
    );

    const m = await s.metricas();
    // Zero `worker_ms`: a worker morreu sem responder, então nada foi observado.
    assert.equal(calculos(m), 0);
    // E UM fallback, não um por pedido — a degradação também foi deduplicada.
    assert.equal(m.contadores.worker_fallback, 1);

    // A chave nao ficou envenenada: o cache foi preenchido dentro do voo que
    // caiu no cálculo em linha, e o pedido seguinte acerta.
    assert.equal((await (await s.busca('/api/dashboards/capa')).json()).cache, 'hit');
  } finally {
    await s.fecha();
    piscina.destroi();
  }
});
