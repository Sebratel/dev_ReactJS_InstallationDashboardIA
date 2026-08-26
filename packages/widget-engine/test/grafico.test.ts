// O gráfico: um valor por série, por ponto do eixo.
//
// Um ponto de gráfico é uma linha de tabela desenhada — mesmo agrupamento, mesmo
// contexto de filtro, mesma ordem de filtros. Por isso o que se testa aqui é o que
// **só** o gráfico tem: a separação por papel (`Category`/`Series` agrupam,
// `Y`/`Y2` viram número) e o que acontece quando um papel novo aparece.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn } from '../../semantic-model/src/types.ts';
import { Dataset, type Row } from '../../measure-engine/src/dataset.ts';
import { Evaluator } from '../../measure-engine/src/evaluator.ts';
import { BLANK, DaxEvalError, makeDate } from '../../measure-engine/src/value.ts';
import { TIPOS_DE_GRAFICO, calculaGrafico, graficosDoDashboard, separaPapeis } from '../src/grafico.ts';
import type { CampoSpec, DashboardSpec, FiltroSpec, VisualSpec } from '../src/spec.ts';

const AGORA = makeDate(2026, 8, 7);

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

const OS: Row[] = [
  { ID: 1, CIDADE: 'Bauru', TIPO: 'Instalação', DATA: makeDate(2026, 1, 10), VALOR: 100 },
  { ID: 2, CIDADE: 'Bauru', TIPO: 'Reparo', DATA: makeDate(2026, 1, 25), VALOR: 200 },
  { ID: 3, CIDADE: 'Jaú', TIPO: 'Instalação', DATA: makeDate(2026, 3, 2), VALOR: 300 },
  { ID: 4, CIDADE: 'Jaú', TIPO: 'Instalação', DATA: makeDate(2026, 3, 9), VALOR: 400 },
];

function montar() {
  const model = new SemanticModel();
  model.addTable({
    id: 'os', name: 'OS', queryRef: null,
    columns: [col('ID'), col('CIDADE'), col('TIPO'), col('DATA', { type: 'dateTime' }), col('VALOR')],
  });
  model.addMeasure({ name: 'Total', table: 'OS', format: null, displayFolder: null, dax: "SUM('OS'[VALOR])" });
  model.addMeasure({ name: 'Itens', table: 'OS', format: null, displayFolder: null, dax: "COUNTROWS('OS')" });
  const dataset = new Dataset();
  dataset.addTable('OS', OS);
  return new Evaluator({ model, dataset, now: AGORA });
}

const campo = (role: string, kind: string, extra: Partial<CampoSpec> = {}): CampoSpec => ({
  role, kind, entity: 'OS', property: 'CIDADE', name: null, ...extra,
});

const eixo = (property: string, nome = property): CampoSpec =>
  campo('Category', 'column', { property, name: nome });

const soma = (nome = 'Soma'): CampoSpec =>
  campo('Y', 'aggregation', { property: 'VALOR', aggregation: 'sum', name: nome });

function grafico(fields: CampoSpec[], filtros: FiltroSpec[] = [], tipo = 'columnChart'): VisualSpec {
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

const calcular = (v: VisualSpec, d = pagina([v]), ev = montar()) => calculaGrafico(d, v, ev);

// ---------------------------------------------------------------------------
// A forma
// ---------------------------------------------------------------------------

test('um eixo e um valor: um ponto por categoria distinta', () => {
  const r = calcular(grafico([eixo('CIDADE'), soma()]));
  assert.deepEqual(r.pontos, [
    { categoria: ['Bauru'], valores: [300] },
    { categoria: ['Jaú'], valores: [700] },
  ]);
  assert.deepEqual(r.series, [{ nome: 'Soma', papel: 'Y' }]);
  assert.equal(r.tipo, 'columnChart');
});

/**
 * Dois campos em `Y` são **duas séries no mesmo ponto**, não dois gráficos. É a
 * forma de `relatorio-do-mes/b191...` (`Abertos` e `Agendados` lado a lado) e de
 * todos os `lineStackedColumnComboChart`.
 */
test('dois valores no mesmo eixo dão duas séries por ponto', () => {
  const r = calcular(grafico([
    eixo('CIDADE'),
    soma('Soma'),
    campo('Y', 'measure', { property: 'Itens', name: 'Itens' }),
  ]));
  assert.deepEqual(r.series, [
    { nome: 'Soma', papel: 'Y' },
    { nome: 'Itens', papel: 'Y' },
  ]);
  assert.deepEqual(r.pontos.map((p) => p.valores), [[300, 2], [700, 2]]);
});

/** `Y2` é o eixo secundário — escala diferente, mas o mesmo ponto do eixo. */
test('Y2 é série como Y, e o papel fica registrado', () => {
  const r = calcular(grafico([
    eixo('CIDADE'),
    soma(),
    campo('Y2', 'measure', { property: 'Itens', name: 'Itens' }),
  ]));
  assert.deepEqual(r.series.map((s) => s.papel), ['Y', 'Y2']);
});

/** `Series` é a legenda: uma segunda dimensão, e vira chave como o eixo. */
test('Series agrupa junto com Category', () => {
  const r = calcular(grafico([eixo('CIDADE'), campo('Series', 'column', { property: 'TIPO' }), soma()]));
  assert.deepEqual(r.chaves.map((c) => [c.papel, c.coluna]), [
    ['Category', 'CIDADE'],
    ['Series', 'TIPO'],
  ]);
  assert.deepEqual(r.pontos, [
    { categoria: ['Bauru', 'Instalação'], valores: [100] },
    { categoria: ['Bauru', 'Reparo'], valores: [200] },
    { categoria: ['Jaú', 'Instalação'], valores: [700] },
  ]);
});

test('o eixo de datas projeta o nível e ordena por primeira aparição', () => {
  const r = calcular(grafico([
    campo('Category', 'hierarchy_level', { property: 'DATA', level: 'Mês', name: 'Mês' }),
    soma(),
  ]));
  assert.deepEqual(r.pontos, [
    { categoria: ['janeiro'], valores: [300] },
    { categoria: ['março'], valores: [700] },
  ]);
});

// ---------------------------------------------------------------------------
// O que erra alto
// ---------------------------------------------------------------------------

/**
 * Um papel que não é eixo nem valor é uma **dimensão a mais** que o visual ganhou
 * (`Tooltips`, `SmallMultiples`, `Size`). Ignorá-lo não daria erro: daria menos
 * pontos do que a tela mostra, ou o mesmo ponto repetido.
 */
test('papel desconhecido erra alto e lista os quatro que existem', () => {
  assert.throws(() => calcular(grafico([eixo('CIDADE'), soma(), campo('Tooltips', 'measure', { property: 'Itens' })])),
    (e: unknown) => {
      assert.ok(e instanceof DaxEvalError);
      assert.match(e.message, /'Tooltips'/);
      assert.match(e.message, /Category, Series, Y, Y2/);
      return true;
    });
});

test('gráfico sem nenhum Y ou Y2 erra alto em vez de desenhar eixo vazio', () => {
  assert.throws(() => calcular(grafico([eixo('CIDADE')])), /sem nenhum campo em Y ou Y2/);
});

test('gráfico sem campo nenhum erra alto', () => {
  assert.throws(() => calcular(grafico([])), /sem campo nenhum/);
});

test('visual que não é gráfico erra alto e diz o que é calculável', () => {
  assert.throws(() => calcular(grafico([eixo('CIDADE'), soma()], [], 'card')), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /não é gráfico, é 'card'/);
    assert.match(e.message, /lineChart/);
    return true;
  });
});

/**
 * Eixo que agrega não existe nos 16, e as duas leituras possíveis divergem: tratar
 * como eixo perde a agregação, tratar como valor perde o ponto.
 */
test('campo de eixo com agregação erra alto', () => {
  assert.throws(
    () => calcular(grafico([campo('Category', 'column', { property: 'VALOR', aggregation: 'sum' }), soma()])),
    /Eixo não agrega/,
  );
});

test('chaves de duas tabelas continuam recusadas, com o nome das duas', () => {
  const ev = montar();
  const v = grafico([
    eixo('CIDADE'),
    { role: 'Series', kind: 'column', entity: 'EQUIPES', property: 'REGIAO', name: null },
    soma(),
  ]);
  assert.throws(() => calculaGrafico(pagina([v]), v, ev), /2 tabelas/);
});

// ---------------------------------------------------------------------------
// `active`, filtros e a ordem entre eles
// ---------------------------------------------------------------------------

/** Campo inativo não é ponto, não é série, não existe. Ver ACHADOS.md #32. */
test('nível inativo não vira chave do eixo', () => {
  const r = calcular(grafico([
    campo('Category', 'hierarchy_level', { property: 'DATA', level: 'Mês', name: 'Mês', active: true }),
    campo('Category', 'hierarchy_level', { property: 'DATA', level: 'Dia', name: 'Dia', active: false }),
    soma(),
  ]));
  assert.deepEqual(r.chaves.map((c) => c.nivel), ['Mês']);
  assert.equal(r.pontos.length, 2);
});

test('série inativa não é desenhada', () => {
  const r = calcular(grafico([
    eixo('CIDADE'),
    soma(),
    campo('Y', 'measure', { property: 'Itens', name: 'Itens', active: false }),
  ]));
  assert.deepEqual(r.series.map((s) => s.nome), ['Soma']);
});

const filtroDeLinha: FiltroSpec = {
  name: 'só instalação', type: 'Categorical', entity: 'OS', property: 'TIPO',
  conditions: [{ op: 'in', values: ['Instalação'] }],
};

test('filtro de linha entra antes de agrupar e pode apagar um ponto inteiro', () => {
  const r = calcular(grafico([eixo('TIPO'), soma()], [filtroDeLinha]));
  assert.deepEqual(r.pontos, [{ categoria: ['Instalação'], valores: [800] }]);
  assert.equal(r.filtros.length, 1);
});

/**
 * **O filtro sobre agregado é HAVING, e a ordem é o que o distingue.**
 * `COUNT(ID) > 1` derruba `Bauru`/`Reparo`, que tem uma linha só. Lido como filtro
 * de linha ele seria `ID > 1`, que mantém quase tudo e ainda muda os valores — é o
 * defeito de ACHADOS.md #30.
 */
test('filtro sobre agregado derruba o ponto, não a linha', () => {
  const having: FiltroSpec = {
    name: 'com mais de uma', type: 'Advanced', entity: 'OS', property: 'ID',
    conditions: [{ op: 'comparison', kind: 'gt', left_property: 'ID', left_aggregation: 'count', right: 1 }],
  };
  const r = calcular(grafico([eixo('CIDADE'), soma()], [having]));
  assert.deepEqual(r.pontos, [
    { categoria: ['Bauru'], valores: [300] },
    { categoria: ['Jaú'], valores: [700] },
  ]);

  // Com o eixo mais fino, um dos grupos passa a ter uma linha só e cai.
  const fino = calcular(grafico([eixo('CIDADE'), campo('Series', 'column', { property: 'TIPO' }), soma()], [having]));
  assert.deepEqual(fino.pontos, [{ categoria: ['Jaú', 'Instalação'], valores: [700] }]);
});

/** Uma medida dentro do ponto enxerga o contexto de filtro do ponto, não as linhas. */
test('a medida do ponto é calculada no contexto de filtro do ponto', () => {
  const r = calcular(grafico([eixo('CIDADE'), campo('Y', 'measure', { property: 'Itens', name: 'Itens' })]));
  assert.deepEqual(r.pontos.map((p) => p.valores), [[2], [2]]);
});

// ---------------------------------------------------------------------------
// A seleção de visuais
// ---------------------------------------------------------------------------

test('graficosDoDashboard pega os sete tipos e ignora o resto', () => {
  const d = pagina([
    grafico([], [], 'card'),
    grafico([], [], 'lineChart'),
    grafico([], [], 'tableEx'),
    grafico([], [], 'barChart'),
  ]);
  assert.deepEqual(graficosDoDashboard(d).map((v) => v.type), ['lineChart', 'barChart']);
  assert.equal(TIPOS_DE_GRAFICO.length, 7);
});

test('separaPapeis devolve chaves e séries na ordem da spec', () => {
  const { chaves, series } = separaPapeis(
    grafico([soma('primeiro'), eixo('CIDADE'), campo('Y2', 'measure', { property: 'Itens', name: 'segundo' })]),
    'x',
  );
  assert.deepEqual(chaves.map((c) => c.coluna), ['CIDADE']);
  assert.deepEqual(series.map((s) => s.serie.nome), ['primeiro', 'segundo']);
});

test('ponto sem linha nenhuma não é ponto — o eixo some junto', () => {
  const impossivel: FiltroSpec = {
    name: 'nada', type: 'Categorical', entity: 'OS', property: 'CIDADE',
    conditions: [{ op: 'in', values: ['Marte'] }],
  };
  const r = calcular(grafico([eixo('CIDADE'), soma()], [impossivel]));
  assert.deepEqual(r.pontos, []);
});

test('BLANK na categoria é um ponto, e não some', () => {
  const model = new SemanticModel();
  model.addTable({ id: 'os', name: 'OS', queryRef: null, columns: [col('CIDADE'), col('VALOR')] });
  const dataset = new Dataset();
  dataset.addTable('OS', [{ CIDADE: 'Bauru', VALOR: 1 }, { CIDADE: null, VALOR: 2 }]);
  const ev = new Evaluator({ model, dataset, now: AGORA });
  const v = grafico([eixo('CIDADE'), soma()]);
  const r = calculaGrafico(pagina([v]), v, ev);
  assert.deepEqual(r.pontos, [
    { categoria: ['Bauru'], valores: [1] },
    { categoria: [BLANK], valores: [2] },
  ]);
});
