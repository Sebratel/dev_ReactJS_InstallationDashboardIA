// O caminho do SNAPSHOT sem a agenda completa (passo 3b, docs/DECISAO-AO-VIVO.md): o que
// muda quando `completa_no_snapshot` vira `false` (passo 5) e a `field-agenda` sai do
// refresh. A agenda completa não está mais no snapshot, então nenhuma carga dele pode
// pedi-la — e o que dependia dela não pode sair calculado pela metade:
//
//   - nenhuma carga pede a FIELD AGENDA completa (leria um arquivo que ninguém atualiza);
//   - os visuais que leem coluna de relato voltam INDISPONÍVEIS, com o motivo;
//   - com filtro de tela em coluna de relato, todo visual que calcula volta indisponível;
//   - o overlay do tempo real perde as fontes do `Status Protocolo Dia` (recalculado sobre
//     a agenda de slot, ele sairia errado), e mantém as do `calendar` (que lê só protocolo
//     e data);
//   - a lista de um seletor de relato sem a agregada no snapshot é 409, não lista parcial.
//
// As specs são uma CÓPIA com a chave desligada; a piscina é de mentira e anota os pedidos.
// O controle (specs reais, chave ligada) mostra que hoje nada disso acontece.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { escreveManifesto } from '../../packages/snapshot/src/manifesto.ts';
import { planeja } from '../../packages/snapshot/src/plano.ts';
import { normalizeName, SemanticModel } from '../../packages/semantic-model/src/model.ts';
import { codificaFiltro } from '../../packages/widget-engine/src/filtro-url.ts';
import { filtrosPadrao } from '../../packages/widget-engine/src/filtros-padrao.ts';
import { loadDashboards } from '../../packages/widget-engine/src/spec.ts';
import { segmentacaoDe, type VisualCalculado } from '../src/calcula.ts';
import type { OverlayDeTabela } from '../src/overlay-realtime.ts';
import type { PiscinaWorkers } from '../src/piscina-workers.ts';
import { Servidor } from '../src/servidor.ts';
import type { MensagemCalculoWorker, RespostaCalculoWorker } from '../src/worker-calculador.ts';
import { ACESSO_LIBERADO } from './fixtures/acesso.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const AGORA = new Date('2026-08-07T12:00:00.000Z');
const PAGINAS = loadDashboards(path.join(ROOT, 'backend', 'specs'));
const AGENDA = PAGINAS.find((d) => d.id === 'agendamento-field')!;
const MODELO = SemanticModel.fromSpecsDir(path.join(ROOT, 'backend', 'specs'));
const RELATO = ['HISTÓRICO DE RELATOS', 'HISTÓRICO DE RELATOS COMPLETOS', 'MOTIVO IMPRODUTIVO/ PRODUTIVO'];

/** Uma raiz com as specs copiadas e a agenda completa FORA do snapshot. */
const SEM_COMPLETA = (() => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-sem-completa-'));
  fs.cpSync(path.join(ROOT, 'backend', 'specs'), path.join(raiz, 'backend', 'specs'), { recursive: true });
  const projecao = path.join(raiz, 'backend', 'specs', '_catalog', 'projecao.yaml');
  const texto = fs.readFileSync(projecao, 'utf8');
  assert.match(texto, /completa_no_snapshot: true/);
  fs.writeFileSync(projecao, texto.replace('completa_no_snapshot: true', 'completa_no_snapshot: false'));
  return raiz;
})();
after(() => fs.rmSync(SEM_COMPLETA, { recursive: true, force: true }));

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
          : {
              idReq: 'x',
              ok: true,
              pagina: { id: msg.dashboardSpec.id, nome: 'x', dadoDe: null, visuais: [], resumo: { calculados: 0, falharam: 0, semCalculo: 0 }, ms: 0 },
              dadoDe: null,
              omitidas: [],
              linhasPorTabela: [],
            },
      );
    },
    invalidaPagina(): void {},
    medeCom(): void {},
    destroi(): void {},
  };
  return { piscina: falsa as unknown as PiscinaWorkers, pedidos };
}

/** Um overlay vazio por tabela — o que importa aqui é QUAIS tabelas chegam à worker. */
const OVERLAY = new Map<string, OverlayDeTabela>(
  ['FIELD AGENDA', 'PROTOCOLOS GERAL', 'ALOCAÇÃO PATRIMONIO'].map((t) => [
    normalizeName(t),
    { linhas: [], corte: new Date('2026-08-07T00:00:00.000Z'), chave: ['x'], marca: ['y'] },
  ]),
);

async function sobe(
  t: { after: (f: () => void | Promise<void>) => void },
  raiz: string,
  snapshot: string = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-sem-completa-dir-')),
): Promise<{ pedidos: Pedido[]; busca: (rota: string) => Promise<Response>; servidor: Servidor }> {
  t.after(() => fs.rmSync(snapshot, { recursive: true, force: true }));
  const { piscina, pedidos } = piscinaQueAnota();
  const servidor = new Servidor({
    acesso: ACESSO_LIBERADO,
    root: raiz,
    snapshotDir: snapshot,
    webDir: path.join(ROOT, 'frontend', 'dist'),
    agora: () => AGORA,
    identifica: () => ({ usuario: 'teste', papeis: ['autenticado'] }),
    piscinaWorkers: piscina,
    overlayRealtime: () => OVERLAY,
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
  return { pedidos, busca: (rota) => fetch(`http://127.0.0.1:${port}${rota}`), servidor };
}

/** Um snapshot só com o manifesto: as queries da Agendamento Field, cada uma com o seu `geradoEm`. */
async function manifestoDaAgenda(queries: readonly string[], geradoEm: (q: string) => string): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-sem-completa-manifesto-'));
  await escreveManifesto(
    dir,
    queries.map((query) => ({ query, tabelas: [], linhas: 1, colunas: 1, bytes: 1, geradoEm: geradoEm(query) })),
  );
  return dir;
}

const comFiltros = (pagina: string, extra: string[] = []) =>
  `/api/dashboards/${pagina}?${[...filtrosPadrao(pagina, AGORA).map(codificaFiltro), ...extra].map((f) => `filtro=${encodeURIComponent(f)}`).join('&')}`;

const titulosIndisponiveis = (visuais: VisualCalculado[]) => visuais.filter((v) => v.indisponivel).map((v) => v.titulo).sort();

test('sem a agenda completa: nenhuma carga a pede, e os três visuais de relato voltam indisponíveis', async (t) => {
  const { pedidos, busca } = await sobe(t, SEM_COMPLETA);
  const r = await busca(comFiltros(AGENDA.id));
  assert.equal(r.status, 200);
  const corpo = (await r.json()) as { visuais: VisualCalculado[] };

  const [p] = pedidos;
  assert.ok(p);
  assert.ok(!p.precisaFormaCompleta?.includes('FIELD AGENDA'), 'a carga não pede a FIELD AGENDA completa');
  const pedidos3 = (p.dashboardSpec.visuals ?? []).map((v) => v.title);
  for (const titulo of RELATO) assert.ok(!pedidos3.includes(titulo), `${titulo} não vai para o cálculo`);
  assert.deepEqual(titulosIndisponiveis(corpo.visuais), [...RELATO].sort());
  for (const v of corpo.visuais.filter((x) => x.indisponivel)) assert.match(v.indisponivel!, /só chegam pelo ao vivo/);
});

test('sem a agenda completa: o overlay perde as fontes do Status Protocolo Dia, e o calendar segue recalculando', async (t) => {
  const { pedidos, busca } = await sobe(t, SEM_COMPLETA);
  assert.equal((await busca(comFiltros(AGENDA.id))).status, 200);
  assert.equal((await busca(comFiltros('relatorio-do-mes'))).status, 200);
  const daAgenda = pedidos.find((p) => p.dashboardSpec.id === AGENDA.id)!;
  const doMes = pedidos.find((p) => p.dashboardSpec.id === 'relatorio-do-mes')!;
  assert.equal(daAgenda.overlays, undefined, 'FIELD AGENDA, PG e alocação recalculariam o Status Protocolo Dia sobre a agenda de slot');
  assert.ok(doMes.overlays?.has(normalizeName('FIELD AGENDA')), 'o calendar do Relatório do Mês recalcula sobre a agenda de slot');
  assert.ok(!doMes.precisaFormaCompleta?.includes('FIELD AGENDA'));
});

test('sem a agenda completa: filtro de tela em coluna de relato deixa indisponível todo visual que calcula', async (t) => {
  const { busca } = await sobe(t, SEM_COMPLETA);
  const filtro = codificaFiltro({ tabela: 'FIELD AGENDA', coluna: 'ClassificacaoRelato', valores: ['x'] });
  const r = await busca(comFiltros(AGENDA.id, [filtro]));
  assert.equal(r.status, 200);
  const corpo = (await r.json()) as { visuais: VisualCalculado[] };
  const calculam = (AGENDA.visuals ?? []).filter((v) => !segmentacaoDe(v) && !['image', 'textbox', 'shape', 'basicShape', 'actionButton'].includes(v.type));
  const indisponiveis = corpo.visuais.filter((v) => v.indisponivel);
  assert.ok(indisponiveis.length > RELATO.length, 'não só os de relato');
  assert.ok(indisponiveis.length <= calculam.length);
  for (const v of indisponiveis) assert.match(v.indisponivel!, /O filtro em 'FIELD AGENDA'\[ClassificacaoRelato\]/);
});

test('sem a agenda completa e sem a agregada: a lista de relato é 409, não lista parcial', async (t) => {
  const { busca, pedidos } = await sobe(t, SEM_COMPLETA);
  const r = await busca(`/api/dashboards/${AGENDA.id}/valores?${new URLSearchParams({ tabela: 'FIELD AGENDA', coluna: 'ClassificacaoRelato' })}`);
  assert.equal(r.status, 409);
  assert.match(((await r.json()) as { erro: string }).erro, /agregada dos relatos/);
  assert.equal(pedidos.filter((p) => p.valores).length, 0);
});

// O carimbo da página sai das queries que ela usa. O plano nomeia a `field-agenda` (a
// canônica), e a carga lê a `field-agenda-slot`: o refresh da de slot tem de chegar ao
// carimbo por ela mesma, e não pelo acaso do carimbo global das calculadas.
test('o refresh da agenda de slot muda o carimbo da página, com a completa parada', async (t) => {
  const queries = [...new Set([...planeja([AGENDA], MODELO).queries, 'field-agenda-slot'])];
  const snapshot = await manifestoDaAgenda(queries, () => '2026-08-07T10:00:00.000Z');
  t.after(() => fs.rmSync(snapshot, { recursive: true, force: true }));
  const { servidor } = await sobe(t, ROOT, snapshot);
  const antes = servidor['carimboDaPagina'](AGENDA);

  await escreveManifesto(
    snapshot,
    queries.map((query) => ({ query, tabelas: [], linhas: 1, colunas: 1, bytes: 1, geradoEm: query === 'field-agenda-slot' ? '2026-08-07T10:15:00.000Z' : '2026-08-07T10:00:00.000Z' })),
  );
  servidor['confereCarimbo']();
  assert.notEqual(servidor['carimboDaPagina'](AGENDA), antes);
});

test('sem a agenda completa, a página fica pronta sem o arquivo dela (o snapshot novo nunca o terá)', async (t) => {
  const semACompleta = [...new Set([...planeja([AGENDA], MODELO).queries, 'field-agenda-slot'])].filter((q) => q !== 'field-agenda');
  const snapshot = await manifestoDaAgenda(semACompleta, () => '2026-08-07T10:00:00.000Z');
  t.after(() => fs.rmSync(snapshot, { recursive: true, force: true }));
  const pronta = async (raiz: string) => {
    const { busca } = await sobe(t, raiz, snapshot);
    const corpo = (await (await busca('/api/dashboards')).json()) as { dashboards: { id: string; pronta: boolean }[] };
    return corpo.dashboards.find((d) => d.id === AGENDA.id)!.pronta;
  };
  assert.equal(await pronta(SEM_COMPLETA), true);
  assert.equal(await pronta(ROOT), false, 'controle: com a chave ligada, a completa ainda é exigida');
});

test('controle — com a agenda completa no snapshot (hoje): nada indisponível, e a carga a pede', async (t) => {
  const { pedidos, busca } = await sobe(t, ROOT);
  const r = await busca(comFiltros(AGENDA.id));
  assert.equal(r.status, 200);
  const corpo = (await r.json()) as { visuais: VisualCalculado[] };
  assert.equal(titulosIndisponiveis(corpo.visuais).length, 0);
  assert.ok(pedidos[0]!.precisaFormaCompleta?.includes('FIELD AGENDA'));
  assert.ok(pedidos[0]!.overlays?.has(normalizeName('FIELD AGENDA')));
});
