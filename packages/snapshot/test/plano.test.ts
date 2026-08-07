// O que uma página precisa em disco — o fechamento.
//
// **O teste que dá razão a este módulo é o do `FERIADOS`.** Nenhum visual do
// relatório nomeia essa tabela. Quem a puxa é o DAX de
// `'CALENDARIO INSTALADO'[PESO]`, uma coluna calculada de uma tabela calculada.
// Materializar pela lista de `entities_used` deixaria `FERIADOS` de fora de 9
// páginas, e o carregamento morreria com "tabela não está no dataset" — longe da
// causa, e depois de já ter buscado tudo o mais nas fontes reais.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn } from '../../semantic-model/src/types.ts';
import { loadDashboards, type DashboardSpec, type VisualSpec } from '../../widget-engine/src/spec.ts';
import { planeja } from '../src/plano.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SPECS = path.join(ROOT, 'specs');

// ---------------------------------------------------------------------------
// Contra as specs reais — os números medidos, presos
// ---------------------------------------------------------------------------

const model = SemanticModel.fromSpecsDir(SPECS);
const dashboards = loadDashboards(SPECS);

test('as 14 páginas juntas fecham em 23 tabelas e 16 queries', () => {
  const p = planeja(dashboards, model);
  assert.equal(dashboards.length, 14);
  assert.equal(p.tabelas.length, 23);
  assert.equal(p.queries.length, 16);
  // As 7 do catálogo: as calculadas nascem de DAX, não de arquivo.
  assert.equal(p.calculadas.length, 7);
  assert.equal(p.tabelas.length, p.queries.length + p.calculadas.length);
});

/**
 * **O achado que o fechamento existe para pegar.** Se este número cair para 0, é
 * porque alguém trocou o fechamento pela lista do visual.
 */
test("FERIADOS entra em 9 páginas e nenhum visual a nomeia", () => {
  let porFechamento = 0;
  let porVisual = 0;
  for (const d of dashboards) {
    const t = planeja([d], model).tabelas.find((x) => x.nome === 'FERIADOS');
    if (!t) continue;
    porFechamento++;
    if (t.porque.startsWith('visual de')) porVisual++;
  }
  assert.equal(porFechamento, 9);
  assert.equal(porVisual, 0);
  const uma = planeja([dashboards.find((d) => d.id === 'diario-instalacao')!], model);
  assert.match(uma.tabelas.find((t) => t.nome === 'FERIADOS')!.porque, /CALENDARIO INSTALADO.*PESO/);
});

/**
 * **A medida do que o plano economiza.** `field-agenda` tem 1,4 milhão de linhas e
 * é a query mais cara da base. Carregar o catálogo inteiro por página a puxaria
 * para as 14; o fechamento a puxa para 3.
 */
test('field-agenda entra em 3 das 14 páginas, protocolos-geral em 13', () => {
  const conta = (q: string): number =>
    dashboards.filter((d) => planeja([d], model).queries.includes(q)).length;
  assert.equal(conta('field-agenda'), 3);
  assert.equal(conta('protocolos-geral'), 13);
});

test('toda tabela do plano tem query ou DAX — nenhuma fica sem como materializar', () => {
  for (const t of planeja(dashboards, model).tabelas) {
    assert.ok(t.query !== null || model.table(t.nome)!.tableDax, t.nome);
  }
});

// ---------------------------------------------------------------------------
// As quatro arestas do fechamento, isoladas
// ---------------------------------------------------------------------------

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

function visual(fields: VisualSpec['fields'], entities: string[] = []): VisualSpec {
  return {
    id: 'v', type: 'card',
    position: { x: 0, y: 0, width: 1, height: 1 },
    entities_used: entities, fields, filters: [], filters_vazios: 0,
  };
}

function pagina(visuals: VisualSpec[]): DashboardSpec {
  return {
    spec: 'v1', id: 'p', page_id: 'p', name: 'P', type: 'page', visibility: null,
    size: { width: 1, height: 1 }, visual_count: visuals.length,
    filters: [], filters_vazios: 0, visuals,
  };
}

/** Fato → dimensão via medida, e dimensão calculada → tabela que ela varre. */
function modelo(): SemanticModel {
  const m = new SemanticModel();
  m.addTable({ id: 'os', name: 'OS', queryRef: 'q-os', columns: [col('VALOR'), col('CIDADE')] });
  m.addTable({ id: 'met', name: 'METAS', queryRef: 'q-metas', columns: [col('META')] });
  m.addTable({ id: 'fer', name: 'FERIADOS', queryRef: 'q-feriados', columns: [col('DIA')] });
  m.addTable({
    id: 'cal', name: 'CAL', queryRef: null,
    tableDax: "DISTINCT('OS'[CIDADE])",
    columns: [col('CIDADE'), col('PESO', { calculated: true, dax: "COUNTROWS('FERIADOS')" })],
  });
  m.addMeasure({ name: 'Atingimento', table: 'OS', format: null, displayFolder: null,
    dax: "DIVIDE(SUM('OS'[VALOR]), SUM('METAS'[META]))" });
  m.addMeasure({ name: 'Dobro', table: 'OS', format: null, displayFolder: null,
    dax: '[Atingimento] * 2' });
  return m;
}

test('medida arrasta a tabela que o DAX dela cita, e o visual não nomeia', () => {
  const p = planeja(
    [pagina([visual([{ role: 'Values', kind: 'measure', entity: 'OS', property: 'Atingimento', name: null }])])],
    modelo(),
  );
  assert.deepEqual(p.tabelas.map((t) => t.nome).sort(), ['METAS', 'OS']);
  assert.match(p.tabelas.find((t) => t.nome === 'METAS')!.porque, /DAX de \[Atingimento\]/);
});

test('medida que chama medida arrasta as duas', () => {
  const p = planeja(
    [pagina([visual([{ role: 'Values', kind: 'measure', entity: 'OS', property: 'Dobro', name: null }])])],
    modelo(),
  );
  assert.deepEqual(p.medidas.sort(), ['atingimento', 'dobro']);
  assert.ok(p.tabelas.some((t) => t.nome === 'METAS'));
});

test('tabela calculada arrasta a que ela varre e a que a coluna calculada cita', () => {
  const p = planeja([pagina([visual([], ['CAL'])])], modelo());
  assert.deepEqual(p.tabelas.map((t) => t.nome).sort(), ['CAL', 'FERIADOS', 'OS']);
  assert.deepEqual(p.calculadas, ['CAL']);
  assert.deepEqual(p.queries, ['q-feriados', 'q-os']);
  assert.match(p.tabelas.find((t) => t.nome === 'FERIADOS')!.porque, /DAX de 'CAL'\[PESO\]/);
});

/** `Arithmetic` guarda dois operandos e `ScopedEval` uma expressão dentro. */
test('campo aninhado do "% do total" não escapa do fechamento', () => {
  const dentro = { role: 'Values', kind: 'aggregation', entity: 'METAS', property: 'META', aggregation: 'sum', name: null };
  const p = planeja(
    [pagina([visual([{
      role: 'Values', kind: 'arithmetic', entity: 'OS', property: 'VALOR', name: '%',
      operator: 'divide',
      left: dentro,
      right: { role: 'Values', kind: 'scoped_eval', entity: 'OS', property: 'VALOR', name: null, scope: [], expression: dentro },
    } as never])])],
    modelo(),
  );
  assert.ok(p.tabelas.some((t) => t.nome === 'METAS'), 'a tabela do operando ficou de fora');
});

test('tabela sem query e sem DAX erra alto nomeando quem a puxou', () => {
  const m = modelo();
  m.addTable({ id: 'orfa', name: 'ORFA', queryRef: null, columns: [col('X')] });
  assert.throws(
    () => planeja([pagina([visual([], ['ORFA'])])], m),
    /'ORFA' entrou no plano \(visual de p\).*não tem nem query_ref nem table_dax/s,
  );
});

test('a mesma tabela por dois caminhos entra uma vez só', () => {
  const p = planeja(
    [pagina([
      visual([{ role: 'Values', kind: 'measure', entity: 'OS', property: 'Atingimento', name: null }]),
      visual([], ['METAS']),
    ])],
    modelo(),
  );
  assert.equal(p.tabelas.filter((t) => t.nome === 'METAS').length, 1);
});
