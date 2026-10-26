// As listas dos seletores não carregam a página do snapshot quando não precisam (passo 3,
// docs/DECISAO-AO-VIVO.md, ACHADOS #248).
//
// **O defeito.** `/valores` calculava na worker sobre o conjunto da página INTEIRA do
// snapshot — na Agendamento Field, a agenda completa —, também com a página ao vivo. A
// memória que o ao vivo poupava nos visuais voltava pelo seletor, e sem a agenda completa
// no snapshot (passo 5) as listas de relato perderiam a fonte.
//
// **O conserto.** Coluna de relato (Classificação do Relato, Categoria de Produtividade,
// Descrição) lista da agregada do SRD que o refresh grava (`valores-do-relato`), em toda
// página; os outros seletores de uma página AO VIVO, de uma carga do snapshot só com os
// seletores, uma para todos. Página fora do ao vivo segue como sempre.
//
// A piscina aqui é de mentira e anota cada pedido: o que se afirma é DE ONDE cada lista
// sai e com que carga, não o cálculo (esse é o mesmo `valoresDistintos` de sempre).
//
// REGRA DE SAÍDA do projeto: nenhum valor de linha real aparece aqui — os da agregada são
// de mentira, escritos neste arquivo.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { decideAoVivo, idDosSeletores, type PeriodoAoVivo } from '../../packages/ao-vivo/src/periodo.ts';
import { escreve } from '../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery, escreveManifesto } from '../../packages/snapshot/src/manifesto.ts';
import { SemanticModel } from '../../packages/semantic-model/src/model.ts';
import { loadDashboards } from '../../packages/widget-engine/src/spec.ts';
import { segmentacaoDe } from '../src/calcula.ts';
import type { PaginaServidaAoVivo } from '../src/opcoes-servidor.ts';
import type { GeracaoDoPeriodo } from '../src/periodos-ao-vivo.ts';
import type { PiscinaWorkers } from '../src/piscina-workers.ts';
import { Servidor } from '../src/servidor.ts';
import type { MensagemCalculoWorker, RespostaCalculoWorker } from '../src/worker-calculador.ts';
import { ACESSO_LIBERADO } from './fixtures/acesso.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SPECS = path.join(ROOT, 'backend', 'specs');
const AGORA = new Date('2026-08-07T12:00:00.000Z');
const MODELO = SemanticModel.fromSpecsDir(SPECS);
const AGENDA = loadDashboards(SPECS).find((d) => d.id === 'agendamento-field')!;
const GATILHOS = ['ClassificacaoRelato', 'CategoriaProdutividade', 'Descrição'];
const AGREGADA = MODELO.graoReduzido.find((g) => g.tabela === 'FIELD AGENDA')!.valoresDosSeletores!;

type Pedido = Omit<MensagemCalculoWorker, 'idReq'>;

function piscinaQueAnota(): { piscina: PiscinaWorkers; pedidos: Pedido[] } {
  const pedidos: Pedido[] = [];
  const falsa = {
    ativa: true,
    estado: { fila: 0, ocupados: 0, workers: 1, porClasse: [0, 0, 0, 0] },
    executa(msg: Pedido): Promise<RespostaCalculoWorker> {
      pedidos.push(msg);
      return Promise.resolve(
        msg.valores
          ? { idReq: 'x', ok: true, valores: ['v'], dadoDe: null }
          : { idReq: 'x', ok: true, pagina: { visuais: [] }, dadoDe: null, omitidas: [], linhasPorTabela: [] },
      );
    },
    invalidaPagina(): void {},
    medeCom(): void {},
    destroi(): void {},
  };
  return { piscina: falsa as unknown as PiscinaWorkers, pedidos };
}

/** A agregada como o refresh a grava: uma linha por combinação, colunas pelo nome do modelo. */
async function gravaAgregada(dir: string, geradoEm: string, linhas: Record<string, string | null>[]): Promise<void> {
  const cab = await escreve(arquivoDaQuery(dir, AGREGADA), { query: AGREGADA, tabelas: [], geradoEm }, ['Descrição', 'ClassificacaoRelato', 'CategoriaProdutividade'], linhas);
  await escreveManifesto(dir, [{ query: AGREGADA, tabelas: cab.tabelas, linhas: linhas.length, colunas: 3, bytes: 100, geradoEm }]);
}

async function sobe(
  t: { after: (f: () => void | Promise<void>) => void },
  o: { aoVivo: boolean },
): Promise<{ pedidos: Pedido[]; busca: (rota: string) => Promise<Response>; snapshot: string; servidor: Servidor }> {
  const snapshot = fs.mkdtempSync(path.join(os.tmpdir(), 'valores-ao-vivo-'));
  t.after(() => fs.rmSync(snapshot, { recursive: true, force: true }));
  const { piscina, pedidos } = piscinaQueAnota();
  const agenda: PaginaServidaAoVivo = {
    decide: (dash, daTela) => decideAoVivo(dash, daTela, MODELO),
    obtem: async (p: PeriodoAoVivo): Promise<GeracaoDoPeriodo> => ({
      periodo: p,
      dir: snapshot,
      geradoEm: '2026-08-07T11:30:00.000Z',
      identidade: 'ao-vivo#1',
      expiraEm: Infinity,
      ms: 1,
      protocolos: 1,
    }),
    marca: () => 'ao-vivo#1',
  };
  const servidor = new Servidor({
    acesso: ACESSO_LIBERADO,
    root: ROOT,
    snapshotDir: snapshot,
    webDir: path.join(ROOT, 'frontend', 'dist'),
    agora: () => AGORA,
    identifica: () => ({ usuario: 'teste', papeis: ['autenticado'] }),
    piscinaWorkers: piscina,
    ...(o.aoVivo ? { aoVivo: { paginas: new Map([[AGENDA.id, agenda]]) } } : {}),
  });
  const http = servidor.criaHttp();
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  t.after(
    () =>
      new Promise<void>((ok) => {
        servidor.destroi();
        http.closeAllConnections?.();
        http.close(() => ok());
      }),
  );
  const { port } = http.address() as { port: number };
  return { pedidos, busca: (rota) => fetch(`http://127.0.0.1:${port}${rota}`), snapshot, servidor };
}

const lista = (tabela: string, coluna: string): string =>
  `/api/dashboards/${AGENDA.id}/valores?${new URLSearchParams({ tabela, coluna })}`;

async function valoresDe(r: Response): Promise<unknown[]> {
  assert.equal(r.status, 200);
  return ((await r.json()) as { valores: { valor: unknown }[] }).valores.map((v) => v.valor);
}

test('página ao vivo: o seletor comum lista de uma carga só dos seletores, sem a agenda completa', async (t) => {
  const { pedidos, busca, snapshot } = await sobe(t, { aoVivo: true });

  assert.equal((await busca(lista('PROTOCOLOS GERAL', 'CIDADE'))).status, 200);
  assert.equal((await busca(lista('PROTOCOLOS GERAL', 'TURNO'))).status, 200);
  const [cidade, turno] = pedidos.filter((p) => p.valores);
  assert.ok(cidade && turno, 'as duas listas foram à worker');

  assert.equal(cidade.dashboardSpec.id, idDosSeletores(AGENDA.id));
  assert.equal(cidade.snapshotDir, snapshot, 'do snapshot de hoje');
  assert.deepEqual(cidade.precisaFormaCompleta, [], 'sem a FIELD AGENDA completa');
  assert.equal(cidade.overlays, undefined, 'sem overlay: o recálculo do tempo real pediria a agenda completa');

  const visuais = (cidade.dashboardSpec.visuals ?? []).map((v) => segmentacaoDe(v));
  assert.ok(visuais.every((s) => s !== undefined), 'só seletores na carga');
  assert.ok(!visuais.some((s) => GATILHOS.includes(s!.coluna)), 'e nenhum de coluna de relato');
  const todos = (AGENDA.visuals ?? []).filter((v) => segmentacaoDe(v) !== undefined).length;
  assert.equal(visuais.length, todos - GATILHOS.length, 'todos os outros seletores da página');

  // A mesma carga para os dois: mesmo id, visuais, liberação e forma = mesma chave na worker.
  const carga = (p: Pedido) =>
    JSON.stringify([p.dashboardSpec.id, (p.dashboardSpec.visuals ?? []).map((v) => v.id), p.liberaSobDemanda, p.precisaFormaCompleta]);
  assert.equal(carga(turno), carga(cidade));
});

for (const aoVivo of [true, false]) {
  test(`coluna de relato (${aoVivo ? 'página ao vivo' : 'página pelo snapshot'}): a lista sai da agregada do SRD, sem worker`, async (t) => {
    const { pedidos, busca, snapshot } = await sobe(t, { aoVivo });
    await gravaAgregada(snapshot, '2026-08-07T11:00:00.000Z', [
      { 'Descrição': 'Visita', ClassificacaoRelato: 'Beta', CategoriaProdutividade: 'Produtiva' },
      { 'Descrição': 'Visita', ClassificacaoRelato: 'Alfa', CategoriaProdutividade: 'Improdutiva' },
      { 'Descrição': 'Retorno', ClassificacaoRelato: null, CategoriaProdutividade: null },
      { 'Descrição': 'Retorno', ClassificacaoRelato: 'Alfa', CategoriaProdutividade: 'Improdutiva' },
    ]);
    // Distintos, na ordem do seletor (texto A–Z, vazio por último) — a mesma de `valoresDistintos`.
    assert.deepEqual(await valoresDe(await busca(lista('FIELD AGENDA', 'ClassificacaoRelato'))), ['Alfa', 'Beta', null]);
    assert.deepEqual(await valoresDe(await busca(lista('FIELD AGENDA', 'CategoriaProdutividade'))), ['Improdutiva', 'Produtiva', null]);
    assert.deepEqual(await valoresDe(await busca(lista('FIELD AGENDA', 'Descrição'))), ['Retorno', 'Visita']);
    assert.equal(pedidos.filter((p) => p.valores).length, 0, 'nenhuma carga de página para listar relato');
  });
}

test('um refresh da agregada chega ao seletor', async (t) => {
  const { busca, snapshot, servidor } = await sobe(t, { aoVivo: true });
  await gravaAgregada(snapshot, '2026-08-07T11:00:00.000Z', [{ 'Descrição': 'Visita', ClassificacaoRelato: 'Alfa', CategoriaProdutividade: null }]);
  assert.deepEqual(await valoresDe(await busca(lista('FIELD AGENDA', 'ClassificacaoRelato'))), ['Alfa']);

  await gravaAgregada(snapshot, '2026-08-07T12:00:00.000Z', [
    { 'Descrição': 'Visita', ClassificacaoRelato: 'Alfa', CategoriaProdutividade: null },
    { 'Descrição': 'Visita', ClassificacaoRelato: 'Gama', CategoriaProdutividade: null },
  ]);
  servidor['confereCarimbo']();
  // A lista de antes sai na hora (`ultimaListaDeValores`) e a nova é calculada por baixo.
  let valores: unknown[] = [];
  for (let i = 0; i < 100 && valores.length !== 2; i++) {
    valores = await valoresDe(await busca(lista('FIELD AGENDA', 'ClassificacaoRelato')));
    if (valores.length !== 2) await new Promise((r) => setTimeout(r, 20));
  }
  assert.deepEqual(valores, ['Alfa', 'Gama'], 'o carimbo da agregada entra no frescor da lista');
});

test('sem a agregada no snapshot (o primeiro deploy): a lista de relato segue pela página inteira, como antes', async (t) => {
  const { pedidos, busca, snapshot } = await sobe(t, { aoVivo: true });
  assert.equal((await busca(lista('FIELD AGENDA', 'ClassificacaoRelato'))).status, 200);
  const [p] = pedidos.filter((x) => x.valores);
  assert.equal(p!.dashboardSpec.id, AGENDA.id);
  assert.equal(p!.snapshotDir, snapshot);
  assert.ok(p!.precisaFormaCompleta?.includes('FIELD AGENDA'));
});

test('página fora do ao vivo: o seletor comum segue pela página inteira do snapshot (a mesma carga da abertura)', async (t) => {
  const { pedidos, busca } = await sobe(t, { aoVivo: false });
  assert.equal((await busca(lista('PROTOCOLOS GERAL', 'CIDADE'))).status, 200);
  const [p] = pedidos.filter((x) => x.valores);
  assert.equal(p!.dashboardSpec.id, AGENDA.id);
  assert.ok(p!.precisaFormaCompleta?.includes('FIELD AGENDA'), 'a página inteira, como sempre');
});
