// O número que um visual `card` mostra.
//
// Modelo pequeno, resultado calculável à mão. A conferência contra os 64 cards do
// relatório é medida em cobertura.test.ts, e **nenhum dos dois prova paridade**:
// os dados aqui são inventados, então o que se prova é que o card calcula o que a
// spec dele manda, não que o número é o da tela.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn } from '../../semantic-model/src/types.ts';
import { Dataset, type Row } from '../../measure-engine/src/dataset.ts';
import { Evaluator } from '../../measure-engine/src/evaluator.ts';
import { DaxEvalError, makeDate } from '../../measure-engine/src/value.ts';
import { FUNCAO_DA_AGREGACAO, calculaCard, cardsDoDashboard } from '../src/card.ts';
import type { CampoSpec, DashboardSpec, FiltroSpec, VisualSpec } from '../src/spec.ts';

const AGORA = new Date(Date.UTC(2026, 2, 15, 14, 37, 52));

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

const OS: Row[] = [
  { ID: 1, CIDADE: 'Bauru', CLIENTE: 'Alfa', VALOR: 100, DATA: makeDate(2026, 3, 15) },
  { ID: 2, CIDADE: 'Bauru', CLIENTE: 'Alfa', VALOR: 250, DATA: makeDate(2026, 3, 10) },
  { ID: 3, CIDADE: 'Jaú', CLIENTE: 'Beta', VALOR: 250, DATA: makeDate(2026, 2, 20) },
  { ID: 4, CIDADE: 'Jaú', CLIENTE: null, VALOR: null, DATA: null },
];

function montar(rows: Row[] = OS) {
  const model = new SemanticModel();
  model.addTable({
    id: 'os',
    name: 'OS',
    queryRef: null,
    columns: [col('ID'), col('CIDADE'), col('CLIENTE'), col('VALOR'), col('DATA', { type: 'dateTime' })],
  });
  model.addMeasure({
    name: 'Total', table: 'OS', format: null, displayFolder: null, dax: "SUM('OS'[VALOR])",
  });
  model.addMeasure({
    name: 'Ticket', table: 'OS', format: null, displayFolder: null,
    dax: "DIVIDE([Total], COUNTROWS('OS'))",
  });
  const dataset = new Dataset();
  dataset.addTable('OS', rows);
  return new Evaluator({ model, dataset, now: AGORA });
}

const agregacao = (property: string, aggregation: string): CampoSpec => ({
  role: 'Values', kind: 'aggregation', entity: 'OS', property, name: `${aggregation} de ${property}`,
  aggregation, aggregation_code: null,
});

const medida = (property: string): CampoSpec => ({
  role: 'Values', kind: 'measure', entity: 'OS', property, name: property,
});

function visual(fields: CampoSpec[], filters: FiltroSpec[] = [], type = 'card'): VisualSpec {
  return {
    id: 'v1', type, position: { x: 0, y: 0, width: 100, height: 100 },
    entities_used: ['OS'], fields, filters, filters_vazios: 0,
  };
}

function dashboard(visuais: VisualSpec[], filters: FiltroSpec[] = []): DashboardSpec {
  return {
    spec: 'dashboard/v1', id: 'd1', page_id: 'p1', name: 'Teste', type: 'page', visibility: null,
    size: { width: 1280, height: 720 }, visual_count: visuais.length, filters, filters_vazios: 0,
    visuals: visuais,
  };
}

const cidade = (valores: string[]): FiltroSpec => ({
  name: 'f cidade', type: 'Categorical', entity: 'OS', property: 'CIDADE',
  conditions: [{ op: 'in', values: valores }],
});

// ---------------------------------------------------------------------------
// As agregações
// ---------------------------------------------------------------------------

test('cada agregação do PBIP vira a função DAX correspondente', () => {
  const ev = montar();
  const valor = (agg: string, coluna = 'VALOR') =>
    calculaCard(dashboard([visual([agregacao(coluna, agg)])]), visual([agregacao(coluna, agg)]), ev).valor;

  assert.equal(valor('sum'), 600);
  assert.equal(valor('avg'), 200); // 600/3 — a linha vazia não entra no denominador
  assert.equal(valor('min'), 100);
  assert.equal(valor('max'), 250);
  assert.equal(valor('count'), 3); // DISTINCTCOUNT: 100, 250 e o vazio
  assert.equal(valor('count_non_null'), 3);
  assert.equal(valor('count', 'CIDADE'), 2); // Bauru e Jaú
});

/**
 * **`avg` não conta o vazio como zero.** Com 4 linhas e uma vazia, a média é
 * 600/3 = 200, não 600/4 = 150. É a diferença entre `AVERAGE` e `SUM/COUNTROWS`, e
 * ela aparece em toda coluna com buraco — que nesta base são quase todas.
 */
test('a média divide pelos não-vazios, não pelas linhas', () => {
  const ev = montar();
  const v = visual([agregacao('VALOR', 'avg')]);
  assert.equal(calculaCard(dashboard([v]), v, ev).valor, 200);
  assert.notEqual(calculaCard(dashboard([v]), v, ev).valor, 150);
});

/**
 * `count` (`Function: 2`) está mapeado para `DISTINCTCOUNT`, e é o único item em
 * aberto do mapa — a pergunta está em PERGUNTAS-NEGOCIO #6. O teste fixa a escolha
 * **vigente** sobre um dado em que as duas leituras discordam (2 distintos em 4
 * linhas): se alguém trocar a linha do mapa sem responder a pergunta, é aqui que
 * aparece.
 */
test('`count` conta valores distintos — a escolha vigente, e o teste que a fixa', () => {
  assert.equal(FUNCAO_DA_AGREGACAO.count, 'DISTINCTCOUNT');
  const ev = montar();
  const v = visual([agregacao('CIDADE', 'count')]);
  assert.equal(calculaCard(dashboard([v]), v, ev).valor, 2);
});

/**
 * **Segunda pergunta em aberto, aninhada na primeira** (PERGUNTAS-NEGOCIO #6).
 *
 * `DISTINCTCOUNT` do DAX conta o vazio como **um valor distinto** — quem ignora é
 * `DISTINCTCOUNTNOBLANK`. Então um card `count` sobre coluna com buraco sai **um a
 * mais** do que a leitura "quantos valores diferentes existem".
 *
 * Não é decisão deste arquivo, e não foi alterada: o comportamento é o do DAX, e
 * está correto enquanto o mapa disser `DISTINCTCOUNT`. O teste existe para o
 * número não mudar sem alguém perceber, e porque a resposta de negócio à #6
 * precisa cobrir **as duas** perguntas — distinto ou não, e o vazio conta ou não.
 */
test('`count` conta o vazio como um valor distinto, como o DAX', () => {
  const ev = montar();
  const v = visual([agregacao('CLIENTE', 'count')]);
  assert.equal(calculaCard(dashboard([v]), v, ev).valor, 3); // Alfa, Beta e o vazio
});

test('agregação sobre coluna de texto não exige número', () => {
  const ev = montar();
  const v = visual([agregacao('CLIENTE', 'count_non_null')]);
  assert.equal(calculaCard(dashboard([v]), v, ev).valor, 3); // Alfa, Alfa, Beta
});

// ---------------------------------------------------------------------------
// Medida nomeada
// ---------------------------------------------------------------------------

test('card de medida avalia o DAX da medida', () => {
  const ev = montar();
  const v = visual([medida('Total')]);
  const r = calculaCard(dashboard([v]), v, ev);
  assert.equal(r.valor, 600);
  assert.deepEqual(r.origem, { kind: 'measure', measure: 'Total' });
});

test('medida que depende de outra medida também roda', () => {
  const ev = montar();
  const v = visual([medida('Ticket')]);
  assert.equal(calculaCard(dashboard([v]), v, ev).valor, 150); // 600/4
});

test('medida que não existe no modelo erra alto', () => {
  const ev = montar();
  const v = visual([medida('Inventada')]);
  assert.throws(() => calculaCard(dashboard([v]), v, ev), DaxEvalError);
});

// ---------------------------------------------------------------------------
// Os filtros entram no cálculo
// ---------------------------------------------------------------------------

test('o filtro de página entra no número do card', () => {
  const ev = montar();
  const v = visual([agregacao('VALOR', 'sum')]);
  const r = calculaCard(dashboard([v], [cidade(['Bauru'])]), v, ev);
  assert.equal(r.valor, 350);
});

test('o filtro de visual entra no número do card', () => {
  const ev = montar();
  const v = visual([agregacao('VALOR', 'sum')], [cidade(['Jaú'])]);
  assert.equal(calculaCard(dashboard([v]), v, ev).valor, 250);
});

/**
 * **O caso que o Widget Engine existe para não errar.** Página filtra Bauru e Jaú,
 * visual filtra Jaú: o certo é 250 (só Jaú). Se os dois filtros fossem aplicados em
 * `with()` separados, o de visual substituiria o de página — dando o mesmo 250 aqui
 * por acaso, então o teste usa listas que **não** se contêm: página Bauru, visual
 * Bauru e Jaú. Somando dá 350; substituindo daria 600.
 */
test('página e visual sobre a mesma coluna se somam no cálculo do card', () => {
  const ev = montar();
  const v = visual([agregacao('VALOR', 'sum')], [cidade(['Bauru', 'Jaú'])]);
  const r = calculaCard(dashboard([v], [cidade(['Bauru'])]), v, ev);
  assert.equal(r.valor, 350);
});

test('a medida também enxerga os filtros do card', () => {
  const ev = montar();
  const v = visual([medida('Total')], [cidade(['Bauru'])]);
  assert.equal(calculaCard(dashboard([v]), v, ev).valor, 350);
});

/** `filtros` traz a origem de cada um — é o que permite conferir o card contra a tela. */
test('o resultado diz quais filtros foram aplicados', () => {
  const ev = montar();
  const v = visual([agregacao('VALOR', 'sum')], [cidade(['Jaú'])]);
  const r = calculaCard(dashboard([v], [cidade(['Bauru', 'Jaú'])]), v, ev);
  assert.equal(r.filtros.length, 2);
  assert.ok(r.filtros.every((f) => f.includes("'OS'[CIDADE]")));
});

test('card sem filtro nenhum devolve o total geral, e diz que não filtrou', () => {
  const ev = montar();
  const v = visual([agregacao('VALOR', 'sum')]);
  const r = calculaCard(dashboard([v]), v, ev);
  assert.equal(r.valor, 600);
  assert.deepEqual(r.filtros, []);
});

// ---------------------------------------------------------------------------
// O que o card recusa
// ---------------------------------------------------------------------------

test('visual que não é card erra alto', () => {
  const ev = montar();
  const v = visual([agregacao('VALOR', 'sum')], [], 'barChart');
  assert.throws(() => calculaCard(dashboard([v]), v, ev), /não é card/);
});

/** Card com dois campos mostraria um dos dois, e escolher qual em silêncio é inventar. */
test('card com dois campos erra alto', () => {
  const ev = montar();
  const v = visual([agregacao('VALOR', 'sum'), medida('Total')]);
  assert.throws(() => calculaCard(dashboard([v]), v, ev), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /2 campo/);
    return true;
  });
});

test('card sem campo nenhum erra alto', () => {
  const ev = montar();
  const v = visual([]);
  assert.throws(() => calculaCard(dashboard([v]), v, ev), DaxEvalError);
});

test('campo fora de `Values` erra alto dizendo qual role veio', () => {
  const ev = montar();
  const v = visual([{ ...agregacao('VALOR', 'sum'), role: 'Category' }]);
  assert.throws(() => calculaCard(dashboard([v]), v, ev), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /Category/);
    return true;
  });
});

/**
 * Agregação sem função é o defeito do ACHADOS #28: o campo diz que agrega e não diz
 * como. Sem a função não há **um** número, há vários.
 */
test('agregação sem função erra alto e aponta o achado', () => {
  const ev = montar();
  const v = visual([{ ...agregacao('VALOR', 'sum'), aggregation: null }]);
  assert.throws(() => calculaCard(dashboard([v]), v, ev), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /#28/);
    return true;
  });
});

test('agregação que o mapa não conhece erra alto e aponta o extrator', () => {
  const ev = montar();
  const v = visual([{ ...agregacao('VALOR', 'sum'), aggregation: 'desconhecida7' }]);
  assert.throws(() => calculaCard(dashboard([v]), v, ev), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /tools\/extractor/);
    return true;
  });
});

test('campo de tipo que não é valor único erra alto', () => {
  const ev = montar();
  const v = visual([{ role: 'Values', kind: 'hierarchy_level', entity: 'OS', property: 'DATA', name: 'Ano' }]);
  assert.throws(() => calculaCard(dashboard([v]), v, ev), DaxEvalError);
});

test('agregação sobre coluna que não existe erra alto', () => {
  const ev = montar();
  const v = visual([agregacao('INVENTADA', 'sum')]);
  assert.throws(() => calculaCard(dashboard([v]), v, ev), DaxEvalError);
});

// ---------------------------------------------------------------------------
// cardsDoDashboard
// ---------------------------------------------------------------------------

test('cardsDoDashboard traz só os cards, na ordem da spec', () => {
  const c1 = { ...visual([medida('Total')]), id: 'c1' };
  const grafico = { ...visual([medida('Total')], [], 'barChart'), id: 'g1' };
  const c2 = { ...visual([medida('Total')]), id: 'c2' };
  assert.deepEqual(cardsDoDashboard(dashboard([c1, grafico, c2])).map((v) => v.id), ['c1', 'c2']);
});

test('dashboard sem visual nenhum não quebra', () => {
  assert.deepEqual(cardsDoDashboard(dashboard([])), []);
});
