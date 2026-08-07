// A matriz (`pivotTable`).
//
// **O dataset tem um buraco de propósito.** `Bauru` não tem `Reparo`. Numa tabela
// essa combinação simplesmente não existiria; numa matriz ela é uma **célula vazia**,
// com a linha `Bauru` e a coluna `Reparo` as duas presentes. É o teste que separa as
// duas leituras, e sem o buraco os dois modelos dariam o mesmo resultado.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn } from '../../semantic-model/src/types.ts';
import { Dataset, type Row } from '../../measure-engine/src/dataset.ts';
import { Evaluator } from '../../measure-engine/src/evaluator.ts';
import { BLANK, DaxEvalError, makeDate } from '../../measure-engine/src/value.ts';
import { calculaMatriz, matrizesDoDashboard, separaEixos } from '../src/matriz.ts';
import type { CampoSpec, DashboardSpec, FiltroSpec, VisualSpec } from '../src/spec.ts';

const AGORA = makeDate(2026, 8, 7);

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

const OS: Row[] = [
  { ID: 1, CIDADE: 'Bauru', TIPO: 'Instalação', VALOR: 100 },
  { ID: 2, CIDADE: 'Bauru', TIPO: 'Instalação', VALOR: 200 },
  // Bauru não tem Reparo — o buraco que separa matriz de tabela.
  { ID: 3, CIDADE: 'Jaú', TIPO: 'Instalação', VALOR: 300 },
  { ID: 4, CIDADE: 'Jaú', TIPO: 'Reparo', VALOR: 400 },
];

function montar(linhas: Row[] = OS) {
  const model = new SemanticModel();
  model.addTable({
    id: 'os', name: 'OS', queryRef: null,
    columns: [col('ID'), col('CIDADE'), col('TIPO'), col('VALOR')],
  });
  model.addMeasure({ name: 'Total', table: 'OS', format: null, displayFolder: null, dax: "SUM('OS'[VALOR])" });
  model.addMeasure({ name: 'Itens', table: 'OS', format: null, displayFolder: null, dax: "COUNTROWS('OS')" });
  const dataset = new Dataset();
  dataset.addTable('OS', linhas);
  return new Evaluator({ model, dataset, now: AGORA });
}

const campo = (role: string, kind: string, extra: Partial<CampoSpec> = {}): CampoSpec => ({
  role, kind, entity: 'OS', property: 'CIDADE', name: null, ...extra,
});

const linha = (property: string): CampoSpec => campo('Rows', 'column', { property, name: property });
const coluna = (property: string): CampoSpec => campo('Columns', 'column', { property, name: property });
const medida = (nome = 'Total'): CampoSpec => campo('Values', 'measure', { property: nome, name: nome });
const soma = (nome = 'Soma'): CampoSpec =>
  campo('Values', 'aggregation', { property: 'VALOR', aggregation: 'sum', name: nome });

function matriz(fields: CampoSpec[], filtros: FiltroSpec[] = [], tipo = 'pivotTable'): VisualSpec {
  return {
    id: 'vis', type: tipo,
    position: { x: 0, y: 0, width: 1, height: 1 },
    entities_used: ['OS'], fields, filters: filtros, filters_vazios: 0,
  };
}

function pagina(visuals: VisualSpec[], filtros: FiltroSpec[] = []): DashboardSpec {
  return {
    spec: 'v1', id: 'pag', page_id: 'p', name: 'Página', type: 'page', visibility: null,
    size: { width: 1, height: 1 }, visual_count: visuals.length,
    filters: filtros, filters_vazios: 0, visuals,
  };
}

const calcular = (v: VisualSpec, d = pagina([v]), ev = montar()) => calculaMatriz(d, v, ev);

/** Os valores de eixo, achatados, para ler a asserção sem ruído. */
const eixo = (e: { valores: unknown[] }[]) => e.map((x) => x.valores);

// ---------------------------------------------------------------------------
// A forma da matriz
// ---------------------------------------------------------------------------

/**
 * **O teste que separa matriz de tabela.** `Bauru`/`Reparo` não existe no dado. Numa
 * tabela seriam 3 linhas; aqui são 2 linhas × 2 colunas = 4 células, e a que não
 * existe é **vazia**, não ausente. As colunas são as mesmas nas duas linhas — que é
 * a definição de matriz.
 */
test('a combinação que não existe é célula vazia, não linha ausente', () => {
  const r = calcular(matriz([linha('CIDADE'), coluna('TIPO'), medida('Total')]));
  assert.deepEqual(eixo(r.linhas), [['Bauru'], ['Jaú']]);
  assert.deepEqual(eixo(r.colunas), [['Instalação'], ['Reparo']]);
  assert.deepEqual(r.celulas, [
    [[300], [BLANK]], // Bauru: 100+200 em Instalação, nada em Reparo
    [[300], [400]],
  ]);
});

test('as colunas são as mesmas em todas as linhas', () => {
  const r = calcular(matriz([linha('CIDADE'), coluna('TIPO'), medida('Total')]));
  for (const l of r.celulas) assert.equal(l.length, r.colunas.length);
});

test('várias medidas viram várias entradas na mesma célula', () => {
  const r = calcular(matriz([linha('CIDADE'), coluna('TIPO'), medida('Total'), medida('Itens'), soma()]));
  assert.deepEqual(r.medidas, ['Total', 'Itens', 'Soma']);
  assert.deepEqual(r.celulas[0]![0], [300, 2, 300]);
  assert.deepEqual(r.celulas[0]![1], [BLANK, BLANK, BLANK]);
});

/** Sem `Columns` a matriz tem uma coluna só — é a lista de medidas por linha. */
test('matriz só de linhas tem exatamente uma coluna', () => {
  const r = calcular(matriz([linha('CIDADE'), medida('Total'), medida('Itens')]));
  assert.deepEqual(eixo(r.colunas), [[]]);
  assert.deepEqual(r.celulas, [[[300, 2]], [[700, 2]]]);
});

test('sem Rows, a matriz é uma linha só de colunas', () => {
  const r = calcular(matriz([coluna('TIPO'), medida('Total')]));
  assert.deepEqual(eixo(r.linhas), [[]]);
  assert.deepEqual(eixo(r.colunas), [['Instalação'], ['Reparo']]);
  assert.deepEqual(r.celulas, [[[600], [400]]]);
});

// ---------------------------------------------------------------------------
// O que some, e o que não some
// ---------------------------------------------------------------------------

/**
 * **Linha inteira vazia some; linha com uma célula só, não.** É o padrão da matriz
 * do Power BI, e sem ele um eixo de datas traria o mês inteiro de colunas onde a
 * tela mostra os poucos dias com dado.
 *
 * `Lins` existe na coluna `CIDADE` mas todas as suas linhas têm valor em branco, então
 * a medida é BLANK nas duas colunas e a linha some. `Bauru` tem uma célula vazia e
 * fica — é a diferença que o teste fixa.
 */
test('linha inteiramente vazia some; linha com uma célula vazia fica', () => {
  const ev = montar([
    ...OS,
    { ID: 5, CIDADE: 'Lins', TIPO: 'Instalação', VALOR: null },
    { ID: 6, CIDADE: 'Lins', TIPO: 'Reparo', VALOR: null },
  ]);
  const v = matriz([linha('CIDADE'), coluna('TIPO'), medida('Total')]);
  const r = calculaMatriz(pagina([v]), v, ev);
  assert.deepEqual(eixo(r.linhas), [['Bauru'], ['Jaú']]);
  assert.equal(r.descartadas.linhas, 1);
  assert.equal(r.descartadas.colunas, 0);
});

test('coluna inteiramente vazia some, e a conta de descartadas registra', () => {
  const ev = montar([...OS, { ID: 5, CIDADE: 'Bauru', TIPO: 'Vistoria', VALOR: null }]);
  const v = matriz([linha('CIDADE'), coluna('TIPO'), medida('Total')]);
  const r = calculaMatriz(pagina([v]), v, ev);
  assert.deepEqual(eixo(r.colunas), [['Instalação'], ['Reparo']]);
  assert.equal(r.descartadas.colunas, 1);
});

/**
 * **O HAVING é da célula, não da linha.** A consulta que o Power BI monta agrupa por
 * todas as colunas de eixo juntas, e o filtro de agregado é um HAVING sobre esse
 * agrupamento — que numa matriz é a célula.
 *
 * `COUNT(ID) > 1` só passa em `Bauru`/`Instalação` (2 linhas). Todas as outras
 * células ficam vazias, e por isso `Jaú` e `Reparo` somem inteiras — mas somem
 * **por consequência**, não porque o filtro tenha sido aplicado à linha.
 */
test('o filtro sobre agregado vale por célula, e a linha só some por consequência', () => {
  const having: FiltroSpec = {
    name: 'mais de uma', type: 'Advanced', entity: 'OS', property: 'ID',
    conditions: [{ op: 'comparison', kind: 'gt', left_property: 'ID', left_aggregation: 'count', right: 1 }],
  };
  const r = calcular(matriz([linha('CIDADE'), coluna('TIPO'), medida('Total')], [having]));
  assert.deepEqual(eixo(r.linhas), [['Bauru']]);
  assert.deepEqual(eixo(r.colunas), [['Instalação']]);
  assert.deepEqual(r.celulas, [[[300]]]);
  assert.equal(r.descartadas.linhas, 1);
});

/** Filtro de linha vale antes de agrupar: apaga o eixo, não só a célula. */
test('filtro de linha tira o valor do eixo inteiro', () => {
  const so: FiltroSpec = {
    name: 'só instalação', type: 'Categorical', entity: 'OS', property: 'TIPO',
    conditions: [{ op: 'in', values: ['Instalação'] }],
  };
  const r = calcular(matriz([linha('CIDADE'), coluna('TIPO'), medida('Total')], [so]));
  assert.deepEqual(eixo(r.colunas), [['Instalação']]);
  assert.equal(r.filtros.length, 1);
});

// ---------------------------------------------------------------------------
// O que erra alto
// ---------------------------------------------------------------------------

test('matriz sem Values erra alto', () => {
  assert.throws(() => calcular(matriz([linha('CIDADE'), coluna('TIPO')])), /sem nenhum campo em Values/);
});

test('matriz sem eixo nenhum erra alto e diz que aquilo é um card', () => {
  assert.throws(() => calcular(matriz([medida('Total')])), /é um card/);
});

test('papel desconhecido erra alto', () => {
  assert.throws(
    () => calcular(matriz([linha('CIDADE'), medida('Total'), campo('Tooltips', 'measure', { property: 'Itens' })])),
    (e: unknown) => {
      assert.ok(e instanceof DaxEvalError);
      assert.match(e.message, /'Tooltips'/);
      assert.match(e.message, /Rows, Columns e Values/);
      return true;
    },
  );
});

test('visual que não é pivotTable erra alto', () => {
  assert.throws(() => calcular(matriz([linha('CIDADE'), medida('Total')], [], 'tableEx')), /não é pivotTable/);
});

// ---------------------------------------------------------------------------
// Seleção e separação
// ---------------------------------------------------------------------------

test('matrizesDoDashboard traz só os pivotTable', () => {
  const d = pagina([
    matriz([], [], 'card'),
    matriz([], [], 'pivotTable'),
    matriz([], [], 'tableEx'),
  ]);
  assert.deepEqual(matrizesDoDashboard(d).map((v) => v.type), ['pivotTable']);
});

test('separaEixos respeita a ordem da spec e o campo inativo', () => {
  const { linha: l, coluna: c, medidas } = separaEixos(
    matriz([
      linha('CIDADE'),
      { ...coluna('TIPO'), active: false },
      medida('Total'),
      medida('Itens'),
    ]),
    'x',
  );
  assert.deepEqual(l.map((k) => k.coluna), ['CIDADE']);
  assert.deepEqual(c, []);
  assert.deepEqual(medidas.map((m) => m.name), ['Total', 'Itens']);
});
