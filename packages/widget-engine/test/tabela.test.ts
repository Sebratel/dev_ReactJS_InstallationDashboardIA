// O `tableEx`: a tabela plana do Power BI.
//
// O teste que mais importa é o primeiro. Uma tabela do Power BI com colunas e
// nenhuma medida mostra as **combinações distintas**, não uma linha por registro —
// e quem espera "detalhe" lê o resultado como dado a mais em vez de erro.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn } from '../../semantic-model/src/types.ts';
import { Dataset, type Row } from '../../measure-engine/src/dataset.ts';
import { Evaluator } from '../../measure-engine/src/evaluator.ts';
import { DaxEvalError, makeDate } from '../../measure-engine/src/value.ts';
import { calculaCard } from '../src/card.ts';
import { calculaTabela, separaCampos, tabelasDoDashboard } from '../src/tabela.ts';
import type { CampoSpec, DashboardSpec, FiltroSpec, VisualSpec } from '../src/spec.ts';

const AGORA = makeDate(2026, 3, 15);

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

const OS: Row[] = [
  { ID: 1, CIDADE: 'Bauru', TIPO: 'Instalação', VALOR: 100 },
  { ID: 2, CIDADE: 'Bauru', TIPO: 'Instalação', VALOR: 200 },
  { ID: 3, CIDADE: 'Bauru', TIPO: 'Reparo', VALOR: 300 },
  { ID: 4, CIDADE: 'Jaú', TIPO: 'Instalação', VALOR: 400 },
];

function montar(rows: Row[] = OS) {
  const model = new SemanticModel();
  model.addTable({
    id: 'os', name: 'OS', queryRef: null,
    columns: [col('ID'), col('CIDADE'), col('TIPO'), col('VALOR')],
  });
  model.addMeasure({ name: 'Total', table: 'OS', format: null, displayFolder: null, dax: "SUM('OS'[VALOR])" });
  const dataset = new Dataset();
  dataset.addTable('OS', rows);
  return new Evaluator({ model, dataset, now: AGORA });
}

const coluna = (property: string, name = property): CampoSpec => ({
  role: 'Values', kind: 'column', entity: 'OS', property, name,
});

const agregacao = (property: string, aggregation: string, name = aggregation): CampoSpec => ({
  role: 'Values', kind: 'aggregation', entity: 'OS', property, name, aggregation, aggregation_code: null,
});

const medida = (property: string): CampoSpec => ({
  role: 'Values', kind: 'measure', entity: 'OS', property, name: property,
});

function visual(fields: CampoSpec[], filters: FiltroSpec[] = [], type = 'tableEx'): VisualSpec {
  return {
    id: 't1', type, position: { x: 0, y: 0, width: 100, height: 100 },
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

/** As linhas como matriz de valores, para comparar de olho. */
function valores(fields: CampoSpec[], filtrosVisual: FiltroSpec[] = [], filtrosPagina: FiltroSpec[] = [], ev = montar()) {
  const v = visual(fields, filtrosVisual);
  return calculaTabela(dashboard([v], filtrosPagina), v, ev).linhas.map((l) => l.map((c) => c.valor));
}

// ---------------------------------------------------------------------------
// A semântica que surpreende
// ---------------------------------------------------------------------------

/**
 * **Uma tabela só de colunas mostra combinações distintas, não registros.**
 *
 * Quatro linhas de dado, três combinações de `CIDADE`+`TIPO`. Lida como listagem
 * crua, esta tabela teria 4 linhas — uma a mais que a tela, e "uma linha a mais"
 * não se parece com erro, se parece com dado.
 */
test('tabela só de colunas mostra as combinações distintas', () => {
  assert.deepEqual(valores([coluna('CIDADE'), coluna('TIPO')]), [
    ['Bauru', 'Instalação'],
    ['Bauru', 'Reparo'],
    ['Jaú', 'Instalação'],
  ]);
});

/** Com uma coluna que distingue tudo, cada registro vira uma linha — o "detalhe". */
test('com uma coluna única por registro, cada registro é uma linha', () => {
  assert.equal(valores([coluna('ID'), coluna('CIDADE')]).length, 4);
});

test('a agregação é calculada dentro de cada grupo', () => {
  assert.deepEqual(valores([coluna('CIDADE'), agregacao('VALOR', 'sum')]), [
    ['Bauru', 600],
    ['Jaú', 400],
  ]);
});

test('a medida também é calculada dentro de cada grupo', () => {
  assert.deepEqual(valores([coluna('CIDADE'), medida('Total')]), [
    ['Bauru', 600],
    ['Jaú', 400],
  ]);
});

/**
 * **A ordem das colunas é a da spec, e há tabela real com a agregação no meio**
 * (`agendamento-field` tem uma). Separar chaves e calculados na saída trocaria as
 * colunas de lugar.
 */
test('a ordem das colunas é a da spec, mesmo com a agregação no meio', () => {
  const campos = [agregacao('VALOR', 'sum', 'Qtd'), coluna('CIDADE'), coluna('TIPO')];
  const v = visual(campos);
  const r = calculaTabela(dashboard([v]), v, montar());
  assert.deepEqual(r.colunas, ['Qtd', 'CIDADE', 'TIPO']);
  assert.deepEqual(r.linhas.map((l) => l.map((c) => c.valor)), [
    [300, 'Bauru', 'Instalação'],
    [300, 'Bauru', 'Reparo'],
    [400, 'Jaú', 'Instalação'],
  ]);
});

test('cada célula diz se é chave ou calculada', () => {
  const campos = [coluna('CIDADE'), agregacao('VALOR', 'sum')];
  const v = visual(campos);
  const [primeira] = calculaTabela(dashboard([v]), v, montar()).linhas;
  assert.deepEqual(primeira!.map((c) => c.chave), [true, false]);
});

/**
 * Duas colunas com o mesmo rótulo na tela existem no relatório (há um campo
 * chamado `.`). Por isso a remontagem da linha é por identidade do campo, não
 * por nome — por nome, as duas leriam o mesmo valor.
 */
test('duas colunas com o mesmo rótulo não se confundem', () => {
  const campos = [coluna('CIDADE', '.'), coluna('TIPO', '.')];
  assert.deepEqual(valores(campos), [
    ['Bauru', 'Instalação'],
    ['Bauru', 'Reparo'],
    ['Jaú', 'Instalação'],
  ]);
});

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

const soBauru: FiltroSpec = {
  name: 'f', type: 'Categorical', entity: 'OS', property: 'CIDADE',
  conditions: [{ op: 'in', values: ['Bauru'] }],
};

test('o filtro reduz os grupos, não só os números', () => {
  assert.deepEqual(valores([coluna('CIDADE'), agregacao('VALOR', 'sum')], [soBauru]), [['Bauru', 600]]);
});

test('filtro de página vale para a tabela', () => {
  assert.deepEqual(valores([coluna('CIDADE'), agregacao('VALOR', 'sum')], [], [soBauru]), [['Bauru', 600]]);
});

test('a tabela informa quais filtros aplicou', () => {
  const v = visual([coluna('CIDADE')], [soBauru]);
  const r = calculaTabela(dashboard([v], [soBauru]), v, montar());
  assert.equal(r.filtros.length, 2);
});

// ---------------------------------------------------------------------------
// separaCampos
// ---------------------------------------------------------------------------

/**
 * O critério é ter função de agregação, não o `kind`. `kind: column` **sem**
 * `aggregation` é chave — são 163 dos 195 campos das tabelas do relatório.
 */
test('separaCampos: coluna sem agregação é chave, o resto é calculado', () => {
  const v = visual([coluna('CIDADE'), agregacao('VALOR', 'sum'), medida('Total')]);
  const { chaves, calculados } = separaCampos(v, 'x');
  assert.deepEqual(chaves.map((c) => c.coluna), ['CIDADE']);
  assert.deepEqual(calculados.map((c) => c.kind), ['aggregation', 'measure']);
});

/** Uma coluna **com** agregação é calculada, não chave — é a mesma coluna nos dois papéis. */
test('separaCampos: coluna com agregação é calculada', () => {
  const comAgg: CampoSpec = { ...coluna('VALOR'), aggregation: 'sum' };
  const { chaves, calculados } = separaCampos(visual([comAgg]), 'x');
  assert.deepEqual(chaves, []);
  assert.equal(calculados.length, 1);
});

// ---------------------------------------------------------------------------
// O que a tabela recusa
// ---------------------------------------------------------------------------

test('visual que não é tableEx erra alto', () => {
  const v = visual([coluna('CIDADE')], [], 'pivotTable');
  assert.throws(() => calculaTabela(dashboard([v]), v, montar()), /não é tableEx/);
});

test('tabela sem campo nenhum erra alto', () => {
  const v = visual([]);
  assert.throws(() => calculaTabela(dashboard([v]), v, montar()), DaxEvalError);
});

/** Papel de eixo é do `pivotTable`, que é outra fatia — e um eixo ignorado agruparia errado. */
test('campo fora de Values erra alto dizendo o papel', () => {
  const v = visual([{ ...coluna('CIDADE'), role: 'Rows' }]);
  assert.throws(() => calculaTabela(dashboard([v]), v, montar()), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /Rows/);
    return true;
  });
});

test('chave de duas tabelas erra alto pelo agrupamento', () => {
  const ev = montar();
  ev.model.addTable({ id: 'eq', name: 'EQUIPES', queryRef: null, columns: [col('NOME')] });
  ev.dataset.addTable('EQUIPES', [{ NOME: 'Alfa' }]);
  const v = visual([coluna('CIDADE'), { ...coluna('NOME'), entity: 'EQUIPES' }]);
  assert.throws(() => calculaTabela(dashboard([v]), v, ev), /2 tabelas/);
});

// ---------------------------------------------------------------------------
// tabelasDoDashboard
// ---------------------------------------------------------------------------

test('tabelasDoDashboard traz só os tableEx, na ordem da spec', () => {
  const t1 = { ...visual([coluna('CIDADE')]), id: 't1' };
  const card = { ...visual([medida('Total')], [], 'card'), id: 'c1' };
  const t2 = { ...visual([coluna('TIPO')]), id: 't2' };
  assert.deepEqual(tabelasDoDashboard(dashboard([t1, card, t2])).map((v) => v.id), ['t1', 't2']);
});

// ---------------------------------------------------------------------------
// Filtro sobre valor agregado (o HAVING)
// ---------------------------------------------------------------------------

/** `COUNT('OS'[ID]) > n` — filtro de grupo, não de linha. */
const having = (kind: string, right: number, aggregation = 'count'): FiltroSpec => ({
  name: 'having', type: 'Advanced', entity: 'OS', property: 'ID',
  conditions: [{ op: 'comparison', kind, left_property: 'ID', left_aggregation: aggregation, right }],
});

/**
 * **O filtro sobre agregado remove GRUPOS, não linhas.**
 *
 * `Bauru`/`Instalação` tem 2 registros, os outros dois grupos têm 1. Com
 * `COUNT(ID) > 1` sobra um grupo só. Aplicado como predicado de linha — que é o que
 * acontecia antes do agrupamento existir — ele viraria `ID > 1` e deixaria passar
 * quase tudo (ACHADOS #30).
 */
test('o filtro sobre agregado descarta grupos inteiros', () => {
  assert.deepEqual(valores([coluna('CIDADE'), coluna('TIPO')], [having('gt', 1)]), [
    ['Bauru', 'Instalação'],
  ]);
});

test('nenhum grupo passa quando o corte é alto demais', () => {
  assert.deepEqual(valores([coluna('CIDADE'), coluna('TIPO')], [having('gt', 99)]), []);
});

test('todos passam quando o corte é `> 0`, que é o caso mais comum da base', () => {
  assert.equal(valores([coluna('CIDADE'), coluna('TIPO')], [having('gt', 0)]).length, 3);
});

/**
 * **A ordem entre os dois tipos de filtro muda o número, e é por isso que ela é
 * regra e não detalhe.**
 *
 * O filtro de linha (`CIDADE = Bauru`) vale **antes** de agrupar, então `COUNT` só
 * conta o que sobrou dele. Aqui `Bauru`/`Instalação` continua com 2 e passa; se o
 * HAVING fosse avaliado antes do filtro de linha, o resultado seria o mesmo por
 * acaso — então o teste usa um corte que separa: `> 1` sobre Jaú, que tem 1 registro
 * em cada grupo, não sobra nada.
 */
test('o filtro de linha vale antes do de grupo', () => {
  const soJau: FiltroSpec = {
    name: 'f', type: 'Categorical', entity: 'OS', property: 'CIDADE',
    conditions: [{ op: 'in', values: ['Jaú'] }],
  };
  assert.deepEqual(valores([coluna('CIDADE'), coluna('TIPO')], [soJau, having('gt', 1)]), []);
  assert.deepEqual(valores([coluna('CIDADE'), coluna('TIPO')], [soJau, having('gt', 0)]), [
    ['Jaú', 'Instalação'],
  ]);
});

test('o HAVING também vale vindo da página', () => {
  assert.deepEqual(valores([coluna('CIDADE'), coluna('TIPO')], [], [having('gt', 1)]), [
    ['Bauru', 'Instalação'],
  ]);
});

test('a tabela reporta o filtro de grupo junto com os de linha', () => {
  const v = visual([coluna('CIDADE')], [having('gt', 0)]);
  const r = calculaTabela(dashboard([v]), v, montar());
  assert.equal(r.filtros.length, 1);
  assert.match(r.filtros[0]!, /filtro de grupo/);
});

/** Sem chave nenhuma, o HAVING decide se o único grupo — o total — aparece. */
test('sem chave, o HAVING decide se o total aparece', () => {
  assert.equal(valores([agregacao('VALOR', 'sum')], [having('gt', 0)]).length, 1);
  assert.equal(valores([agregacao('VALOR', 'sum')], [having('gt', 99)]).length, 0);
});

test('agregação sem função DAX no HAVING erra alto', () => {
  const v = visual([coluna('CIDADE')], [having('gt', 0, 'mediana')]);
  assert.throws(() => calculaTabela(dashboard([v]), v, montar()), /sem função DAX/);
});

/**
 * Um card não tem grupos, então para ele o filtro sobre agregado continua sendo
 * erro — e é a resposta certa. Nenhum dos 10 do relatório está em card.
 */
test('o card continua recusando filtro sobre agregado', () => {
  const v = { ...visual([medida('Total')], [having('gt', 0)], 'card'), id: 'c1' };
  assert.throws(() => calculaCard(dashboard([v]), v, montar()), /HAVING/);
});
