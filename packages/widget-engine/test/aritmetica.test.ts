// O campo `Arithmetic` e o `ScopedEval` — o "% do total".
//
// **O que este arquivo precisa provar é o denominador.** O numerador é trivial: é a
// mesma agregação de sempre, na linha. O denominador é um `ScopedEval` de escopo
// vazio, e ele tem três leituras possíveis que só divergem quando há filtro:
//
// | leitura | denominador |
// |---|---|
// | total do **visual** (a certa) | respeita filtro de página e de visual |
// | total da **tabela** | ignora os filtros — porcentagens menores, coluna não soma 100% |
// | total do **grupo** | seria sempre 1,0 |
//
// Sem filtro no visual as três dão o mesmo número. Por isso o teste central aqui
// tem filtro, e afirma que a coluna **soma 1,0** — que é o que a tela mostra.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn } from '../../semantic-model/src/types.ts';
import { Dataset, type Row } from '../../measure-engine/src/dataset.ts';
import { Evaluator } from '../../measure-engine/src/evaluator.ts';
import { BLANK, DaxEvalError, makeDate } from '../../measure-engine/src/value.ts';
import { calculaTabela } from '../src/tabela.ts';
import { calculaCard } from '../src/card.ts';
import type { CampoSpec, DashboardSpec, FiltroSpec, VisualSpec } from '../src/spec.ts';

const AGORA = makeDate(2026, 8, 7);

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

const OS: Row[] = [
  { ID: 1, CIDADE: 'Bauru', TIPO: 'Instalação', VALOR: 10 },
  { ID: 2, CIDADE: 'Bauru', TIPO: 'Instalação', VALOR: 30 },
  { ID: 3, CIDADE: 'Jaú', TIPO: 'Instalação', VALOR: 60 },
  // A linha de Reparo existe só para o filtro ter o que tirar: é ela que separa
  // "total do visual" de "total da tabela".
  { ID: 4, CIDADE: 'Lins', TIPO: 'Reparo', VALOR: 900 },
];

function montar(linhas: Row[] = OS) {
  const model = new SemanticModel();
  model.addTable({
    id: 'os', name: 'OS', queryRef: null,
    columns: [col('ID'), col('CIDADE'), col('TIPO'), col('VALOR')],
  });
  model.addMeasure({ name: 'Total', table: 'OS', format: null, displayFolder: null, dax: "SUM('OS'[VALOR])" });
  const dataset = new Dataset();
  dataset.addTable('OS', linhas);
  return new Evaluator({ model, dataset, now: AGORA });
}

const chave = (property: string): CampoSpec => ({
  role: 'Values', kind: 'column', entity: 'OS', property, name: property,
});

const soma = (nome = 'QTDE'): CampoSpec => ({
  role: 'Values', kind: 'aggregation', entity: 'OS', property: 'VALOR',
  aggregation: 'sum', name: nome,
});

/** `A / ScopedEval(A, [])` — a forma exata dos dois campos do relatório. */
function porcentagem(operator = 'divide', scope: unknown[] = []): CampoSpec {
  const dentro = soma('interno');
  return {
    role: 'Values', kind: 'arithmetic', entity: 'OS', property: 'VALOR', name: '%',
    operator,
    left: dentro,
    right: {
      role: 'Values', kind: 'scoped_eval', entity: 'OS', property: 'VALOR', name: null,
      scope,
      expression: dentro,
    },
  };
}

function visual(fields: CampoSpec[], filtros: FiltroSpec[] = [], tipo = 'tableEx'): VisualSpec {
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

const soInstalacao: FiltroSpec = {
  name: 'só instalação', type: 'Categorical', entity: 'OS', property: 'TIPO',
  conditions: [{ op: 'in', values: ['Instalação'] }],
};

const calcular = (v: VisualSpec, filtrosDePagina: FiltroSpec[] = [], ev = montar()) =>
  calculaTabela(pagina([v], filtrosDePagina), v, ev);

// ---------------------------------------------------------------------------
// O denominador
// ---------------------------------------------------------------------------

test('% do total: cada linha sobre o total do visual', () => {
  const r = calcular(visual([chave('CIDADE'), soma(), porcentagem()], [soInstalacao]));
  assert.deepEqual(r.colunas, ['CIDADE', 'QTDE', '%']);
  assert.deepEqual(r.linhas.map((l) => l.map((c) => c.valor)), [
    ['Bauru', 40, 0.4],
    ['Jaú', 60, 0.6],
  ]);
});

/**
 * **O teste que separa "total do visual" de "total da tabela".** Com o filtro, o
 * denominador é 100; sem respeitá-lo seria 1000, e as porcentagens sairiam 0,04 e
 * 0,06 — plausíveis, pequenas, e somando 0,1 em vez de 1.
 */
test('a coluna de porcentagem soma 1,0 mesmo com filtro no visual', () => {
  const r = calcular(visual([chave('CIDADE'), soma(), porcentagem()], [soInstalacao]));
  const total = r.linhas.reduce((n, l) => n + (l[2]!.valor as number), 0);
  assert.equal(total, 1);
});

test('o filtro de página conta no denominador tanto quanto o de visual', () => {
  const r = calcular(visual([chave('CIDADE'), soma(), porcentagem()]), [soInstalacao]);
  assert.deepEqual(r.linhas.map((l) => l[2]!.valor), [0.4, 0.6]);
});

/** Sem agrupamento não há o que dividir: numerador e denominador são o mesmo. */
test('num card, o % do total é 1,0', () => {
  const v = visual([porcentagem()], [], 'card');
  assert.equal(calculaCard(pagina([v]), v, montar()).valor, 1);
});

// ---------------------------------------------------------------------------
// A divisão
// ---------------------------------------------------------------------------

/**
 * `divide` segue `DIVIDE` do DAX, não `/`. Com o visual inteiro em branco o
 * denominador é BLANK, e a resposta é BLANK — não `Infinity`, que apareceria numa
 * coluna de porcentagem como `∞`.
 */
test('denominador em branco dá BLANK, não infinito', () => {
  const ev = montar([
    { ID: 1, CIDADE: 'Bauru', TIPO: 'Instalação', VALOR: null },
    { ID: 2, CIDADE: 'Jaú', TIPO: 'Instalação', VALOR: null },
  ]);
  const v = visual([chave('CIDADE'), porcentagem()]);
  const r = calculaTabela(pagina([v]), v, ev);
  assert.deepEqual(r.linhas.map((l) => l[1]!.valor), [BLANK, BLANK]);
});

test('os outros três operadores contam sobre os dois operandos', () => {
  for (const [op, esperado] of [['add', 140], ['subtract', -60], ['multiply', 4000]] as const) {
    const r = calcular(visual([chave('CIDADE'), porcentagem(op)], [soInstalacao]));
    assert.equal(r.linhas[0]![1]!.valor, esperado, op);
  }
});

// ---------------------------------------------------------------------------
// O que erra alto
// ---------------------------------------------------------------------------

/**
 * Escopo não vazio retém parte do eixo — é outra conta. Tratá-lo como vazio daria um
 * denominador maior e porcentagens menores, sem nada indicar.
 */
test('ScopedEval com escopo não vazio erra alto', () => {
  assert.throws(
    () => calcular(visual([chave('CIDADE'), porcentagem('divide', [{ nivel: 'CIDADE' }])])),
    (e: unknown) => {
      assert.ok(e instanceof DaxEvalError);
      assert.match(e.message, /escopo de 1 nível/);
      assert.match(e.message, /denominador maior/);
      return true;
    },
  );
});

test('operador aritmético desconhecido erra alto e aponta o extrator', () => {
  assert.throws(() => calcular(visual([chave('CIDADE'), porcentagem('desconhecido7')])), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /'desconhecido7'/);
    assert.match(e.message, /tools\/extractor/);
    return true;
  });
});

test('campo aritmético sem operando erra alto', () => {
  const quebrado = { ...porcentagem(), right: undefined };
  assert.throws(() => calcular(visual([chave('CIDADE'), quebrado])), /sem os dois operandos/);
});

test('ScopedEval sem expressão dentro erra alto', () => {
  const p = porcentagem();
  const quebrado = { ...p, right: { ...p.right!, expression: undefined } };
  assert.throws(() => calcular(visual([chave('CIDADE'), quebrado])), /sem expressão dentro/);
});
