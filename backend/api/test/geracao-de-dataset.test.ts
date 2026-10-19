// Uma geração de dataset por página, e a velha fora das workers antes da nova entrar.
//
// **O que este arquivo guarda (16/10/2026).** Depois de cada refresh a memória do
// container subia +1 GB em ~45 s. Dois dos três mecanismos achados estão aqui (o
// terceiro, a ordem da poda dentro da worker, está em `cache-de-carga.test.ts`):
//
//   1. **Chave do dataset por recorte.** `libera`/`formaCompleta` entram na chave de
//      `cacheDeCarga`, e a rota da página as montava com os visuais PEDIDOS enquanto
//      `/valores` usava todos. Recortes da mesma página podiam virar dois datasets
//      inteiros na mesma worker. Agora são os da página inteira, para todo pedido.
//   2. **Geração velha esquecida.** Na troca de snapshot ninguém avisava as workers: o
//      dataset velho de uma página só saía quando chegava o pedido DELA. Agora o
//      aquecedor chama `Servidor.soltaGeracoesVelhas` antes de pedir a primeira página,
//      e o aviso chega à worker antes de qualquer cálculo da passada.
//
// REGRA DE SAÍDA do projeto: nenhum valor de linha real aparece aqui — as linhas são de
// mentira, escritas neste arquivo.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { escreve } from '../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery, escreveManifesto, leManifesto } from '../../packages/snapshot/src/manifesto.ts';
import { loadDashboards } from '../../packages/widget-engine/src/spec.ts';
import type { SemanticModel } from '../../packages/semantic-model/src/model.ts';
import { Aquecedor } from '../src/aquecedor.ts';
import { segmentacaoDe } from '../src/calcula.ts';
import { PiscinaWorkers } from '../src/piscina-workers.ts';
import { Servidor } from '../src/servidor.ts';
import { chaveDeCarga, type MensagemCalculoWorker, type RespostaCalculoWorker } from '../src/worker-calculador.ts';
import { ACESSO_LIBERADO } from './fixtures/acesso.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SPECS = path.join(ROOT, 'backend', 'specs');
const WEB = path.join(ROOT, 'frontend', 'dist');
const AGORA = new Date('2026-08-07T12:00:00.000Z');
const PAGINAS = loadDashboards(SPECS);

/** A `HORA ATUALIZADO` com uma linha: a tabela da `capa`, pequena o bastante para escrever à mão. */
async function dirComCapa(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geracao-dataset-'));
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

/** Rematerializa `query` (só `geradoEm` novo; cria a entrada se faltar) — o que um refresh faz ao carimbo. */
async function rematerializa(dir: string, query: string, geradoEm: string): Promise<void> {
  const m = leManifesto(dir);
  assert.ok(m, 'o manifesto tem de existir para este teste dizer alguma coisa');
  const outras = m.tabelas.filter((t) => t.query !== query);
  const esta = m.tabelas.find((t) => t.query === query);
  await escreveManifesto(dir, [
    ...outras,
    esta
      ? { ...esta, geradoEm }
      : { query, tabelas: ['Clima/ Tempo'], linhas: 3, colunas: 2, bytes: 100, geradoEm },
  ]);
}

/**
 * Uma piscina de mentira que responde na hora e anota cada pedido e cada invalidação,
 * NA ORDEM em que chegaram — é a ordem que o segundo bloco de testes afirma.
 */
function piscinaQueAnota(): {
  piscina: PiscinaWorkers;
  pedidos: Omit<MensagemCalculoWorker, 'idReq'>[];
  eventos: string[];
} {
  const pedidos: Omit<MensagemCalculoWorker, 'idReq'>[] = [];
  const eventos: string[] = [];
  const falsa = {
    ativa: true,
    estado: { fila: 0, ocupados: 0, workers: 1, porClasse: [0, 0, 0, 0] },
    executa(msg: Omit<MensagemCalculoWorker, 'idReq'>): Promise<RespostaCalculoWorker> {
      pedidos.push(msg);
      eventos.push(`${msg.valores ? 'valores' : 'calcula'} ${msg.dashboardSpec.id}`);
      return Promise.resolve(
        msg.valores
          ? { idReq: 'x', ok: true, valores: [], dadoDe: null }
          : { idReq: 'x', ok: true, pagina: { visuais: [] }, dadoDe: null, omitidas: [], linhasPorTabela: [] },
      );
    },
    invalidaPagina(id: string): void {
      eventos.push(`invalida ${id}`);
    },
    medeCom(): void {},
    destroi(): void {},
  };
  return { piscina: falsa as unknown as PiscinaWorkers, pedidos, eventos };
}

async function sobe(
  piscina: PiscinaWorkers,
  snapshotDir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'geracao-dataset-vazio-')),
  antesDeServir?: (s: Servidor) => void,
): Promise<{ servidor: Servidor; base: string; busca: (rota: string) => Promise<Response>; fecha: () => Promise<void> }> {
  const servidor = new Servidor({
    acesso: ACESSO_LIBERADO,
    root: ROOT,
    snapshotDir,
    webDir: WEB,
    agora: () => AGORA,
    identifica: () => ({ usuario: 'teste', papeis: ['autenticado'] }),
    piscinaWorkers: piscina,
  });
  antesDeServir?.(servidor);
  const http = servidor.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const { port } = http.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;
  return {
    servidor,
    base,
    busca: (rota) => fetch(`${base}${rota}`),
    fecha: () =>
      new Promise<void>((ok) => {
        servidor.destroi();
        http.closeAllConnections?.();
        http.close(() => ok());
      }),
  };
}

/** A chave que a worker montaria para este pedido — a MESMA função, sobre a página inteira. */
function chaveDoPedido(p: Omit<MensagemCalculoWorker, 'idReq'>): string {
  const inteira = PAGINAS.find((d) => d.id === p.dashboardSpec.id)!;
  return chaveDeCarga(
    inteira.id,
    (inteira.visuals ?? []).map((v) => v.id),
    p.liberaSobDemanda ?? [],
    p.precisaFormaCompleta ?? [],
  );
}

/** Os três tipos de pedido de uma página: abertura, cada visual sozinho e uma segmentação. */
function rotasDe(id: string): string[] {
  const dash = PAGINAS.find((d) => d.id === id)!;
  const rotas = [`/api/dashboards/${encodeURIComponent(id)}`];
  for (const v of dash.visuals ?? []) rotas.push(`/api/dashboards/${encodeURIComponent(id)}?visual=${encodeURIComponent(v.id)}`);
  const seg = (dash.visuals ?? [])
    .map((v) => segmentacaoDe(v))
    .find((s) => s !== undefined && s.naoFiltra === undefined && s.niveis === undefined);
  if (seg) {
    rotas.push(
      `/api/dashboards/${encodeURIComponent(id)}/valores?tabela=${encodeURIComponent(seg.tabela)}` +
        `&coluna=${encodeURIComponent(seg.coluna)}${seg.nivel ? `&nivel=${encodeURIComponent(seg.nivel)}` : ''}`,
    );
  }
  return rotas;
}

async function chavesPorPagina(
  s: { busca: (rota: string) => Promise<Response> },
  pedidos: Omit<MensagemCalculoWorker, 'idReq'>[],
  ids: readonly string[],
): Promise<Map<string, { chaves: Set<string>; tipos: Set<string> }>> {
  for (const id of ids) {
    for (const rota of rotasDe(id)) await (await s.busca(rota)).arrayBuffer();
  }
  const por = new Map<string, { chaves: Set<string>; tipos: Set<string> }>();
  for (const p of pedidos) {
    const e = por.get(p.dashboardSpec.id) ?? { chaves: new Set<string>(), tipos: new Set<string>() };
    e.chaves.add(chaveDoPedido(p));
    // Página de um visual só (as de dica) não distingue abertura de recorte: conta como abertura.
    const total = PAGINAS.find((d) => d.id === p.dashboardSpec.id)?.visuals?.length ?? 0;
    e.tipos.add(p.valores ? 'valores' : (p.dashboardSpec.visuals?.length ?? 0) < total ? 'visual' : 'abertura');
    por.set(p.dashboardSpec.id, e);
  }
  return por;
}

// ---------------------------------------------------------------- 1. uma chave por página

test('abertura, cada ?visual= e /valores da mesma página dão UMA chave de dataset — nas 14 páginas', async () => {
  // Um servidor por página: são ~330 pedidos no total, e o limitador de taxa da API
  // (300/min por IP) devolveria 429 às últimas páginas antes de chegarem à piscina.
  for (const { id } of PAGINAS) {
    const f = piscinaQueAnota();
    const s = await sobe(f.piscina);
    try {
      const por = await chavesPorPagina(s, f.pedidos, [id]);
      const e = por.get(id);
      assert.ok(e, `${id}: nenhum pedido chegou à piscina`);
      const nVisuais = PAGINAS.find((d) => d.id === id)?.visuals?.length ?? 0;
      assert.ok(
        e.tipos.has('abertura') && (nVisuais <= 1 || e.tipos.has('visual')),
        `${id}: faltou tipo de pedido (${[...e.tipos].join(', ')})`,
      );
      if (rotasDe(id).some((r) => r.includes('/valores?'))) {
        assert.ok(e.tipos.has('valores'), `${id}: o pedido de /valores não chegou à piscina`);
      }
      assert.equal(
        e.chaves.size,
        1,
        `${id}: ${e.chaves.size} chaves de dataset para a mesma página — cada uma é uma carga inteira a mais na worker`,
      );
    } finally {
      await s.fecha();
    }
  }
});

test('com uma coluna sob demanda amarrada a um visual, a abertura já a libera — a chave não se parte', async () => {
  // O caso que as specs de hoje não exercitam (`sob_demanda: []` em `projecao.yaml`) e
  // que a montagem antiga partia em duas chaves: a abertura sem a coluna, o `?visual=`
  // que a mostra com ela. Injetada no modelo do próprio servidor, antes do 1º pedido.
  const dash = PAGINAS.find((d) => d.id === 'visao-geral')!;
  const visual = (dash.visuals ?? []).find((v) =>
    (v.fields ?? []).some((c) => c.kind !== 'measure' && c.entity && c.property),
  )!;
  const campo = (visual.fields ?? []).find((c) => c.kind !== 'measure' && c.entity && c.property)!;
  const f = piscinaQueAnota();
  const s = await sobe(f.piscina, undefined, (servidor) => {
    (servidor as unknown as { model: SemanticModel }).model.sobDemanda.push({
      tabela: campo.entity!,
      coluna: campo.property!,
    } as SemanticModel['sobDemanda'][number]);
  });
  try {
    await (await s.busca('/api/dashboards/visao-geral')).arrayBuffer();
    await (await s.busca(`/api/dashboards/visao-geral?visual=${encodeURIComponent(visual.id)}`)).arrayBuffer();
    assert.equal(f.pedidos.length, 2);
    const [abertura, recorte] = f.pedidos;
    assert.equal(abertura!.liberaSobDemanda?.length, 1, 'a abertura não liberou a coluna que um visual da página mostra');
    assert.equal(chaveDoPedido(abertura!), chaveDoPedido(recorte!), 'abertura e recorte viraram dois datasets');
  } finally {
    await s.fecha();
  }
});

// ------------------------------------------------- 2. a geração velha sai antes da nova

test('soltaGeracoesVelhas: a 1ª chamada só anota; depois, invalida só a página cujo dado mudou', async () => {
  const dir = await dirComCapa();
  const f = piscinaQueAnota();
  const s = await sobe(f.piscina, dir);
  try {
    assert.deepEqual(s.servidor.soltaGeracoesVelhas(), [], 'no arranque não há geração velha conhecida');
    assert.deepEqual(s.servidor.soltaGeracoesVelhas(), [], 'nada mudou, nada a soltar');

    // Uma query que a `capa` NÃO lê: a `capa` fica de pé.
    await rematerializa(dir, 'clima-tempo', '2026-08-07T11:30:00.000Z');
    assert.ok(!s.servidor.soltaGeracoesVelhas().includes('capa'), 'refresh alheio derrubou o dataset da capa');

    // A query que a `capa` lê.
    f.eventos.length = 0;
    await rematerializa(dir, 'hora-atualizado', '2026-08-07T11:59:00.000Z');
    const soltas = s.servidor.soltaGeracoesVelhas();
    assert.ok(soltas.includes('capa'), `a capa não foi solta: ${JSON.stringify(soltas)}`);
    assert.deepEqual(
      f.eventos,
      soltas.map((id) => `invalida ${id}`),
      'o que a função diz ter solto tem de ser exatamente o que foi avisado às workers',
    );
  } finally {
    await s.fecha();
  }
});

test('na troca de snapshot o aviso às workers sai ANTES do primeiro pedido do aquecimento', async () => {
  const dir = await dirComCapa();
  const f = piscinaQueAnota();
  const s = await sobe(f.piscina, dir);
  const aq = new Aquecedor({
    base: s.base,
    carimbo: () => s.servidor.identidadeAtual(),
    antesDeAquecer: () => void s.servidor.soltaGeracoesVelhas(),
    anuncia: () => {},
  });
  try {
    const arranque = await aq.tenta();
    assert.ok(arranque && arranque.paginas.length > 0, 'o arranque não aqueceu nada');
    assert.ok(f.eventos.some((e) => e === 'calcula capa'), 'o arranque não calculou a capa');
    assert.ok(!f.eventos.some((e) => e.startsWith('invalida')), 'o arranque não tem geração velha a soltar');

    f.eventos.length = 0;
    await rematerializa(dir, 'hora-atualizado', '2026-08-07T11:59:00.000Z');
    const troca = await aq.tenta();
    assert.ok(troca && !troca.obsoleta, 'o aquecedor não percebeu a troca de snapshot');

    const aviso = f.eventos.indexOf('invalida capa');
    const primeiroCalculo = f.eventos.findIndex((e) => !e.startsWith('invalida'));
    assert.ok(aviso >= 0, `a capa não foi invalidada nas workers: ${f.eventos.slice(0, 5).join(' | ')}`);
    assert.ok(primeiroCalculo > aviso, 'um cálculo do aquecimento chegou à piscina antes do aviso da troca');
    assert.ok(f.eventos.includes('calcula capa'), 'a capa não foi reaquecida');
  } finally {
    aq.para();
    await s.fecha();
  }
});

test('pela porta de verdade: a worker recebe a invalidação antes do cálculo seguinte', async () => {
  // A piscina de mentira acima prova a ordem em que o servidor CHAMA; esta prova que a
  // ordem sobrevive à travessia — `invalida` é mensagem solta, fora da fila de tarefas.
  const anotacoes = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anota-')), 'mensagens.jsonl');
  const antes = process.env.ANOTA_MENSAGENS_EM;
  process.env.ANOTA_MENSAGENS_EM = anotacoes;
  const piscina = new PiscinaWorkers({
    tamanhoPool: 1,
    scriptDaWorker: path.join(ROOT, 'backend', 'api', 'test', 'fixtures', 'worker-que-anota.ts'),
  });
  if (antes === undefined) delete process.env.ANOTA_MENSAGENS_EM;
  else process.env.ANOTA_MENSAGENS_EM = antes;
  try {
    assert.equal(piscina.ativa, true);
    const capa = PAGINAS.find((d) => d.id === 'capa')!;
    const pedido: Omit<MensagemCalculoWorker, 'idReq'> = {
      snapshotDir: '-',
      specsDir: SPECS,
      dashboardSpec: capa,
      janela: { de: 0, linhas: 0 },
      clicados: [],
      agoraIso: AGORA.toISOString(),
      identidade: 'A@2026-08-07',
      escopo: 'teste',
    };
    await piscina.executa(pedido);
    piscina.invalidaPagina('capa');
    await piscina.executa({ ...pedido, identidade: 'B@2026-08-07' });
    const linhas = fs
      .readFileSync(anotacoes, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { tipo: string; pagina: string; identidade?: string });
    assert.deepEqual(
      linhas.map((l) => `${l.tipo} ${l.pagina}${l.identidade ? ` ${l.identidade}` : ''}`),
      ['calcula capa A@2026-08-07', 'invalida capa', 'calcula capa B@2026-08-07'],
    );
  } finally {
    piscina.destroi();
  }
});
