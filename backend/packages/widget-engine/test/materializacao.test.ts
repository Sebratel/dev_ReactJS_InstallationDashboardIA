// O caminho rápido do agrupamento: as linhas que a varredura já separou.
//
// **O que este arquivo tem de provar é que ele não muda número nenhum.** A
// materialização é otimização — o agrupamento entrega ao contexto de filtro as
// linhas de cada grupo, que ele antes redescobria varrendo a tabela por grupo
// (ACHADOS #38). Com ela ou sem ela, o resultado tem de ser o mesmo, e é isso que
// o teste diferencial daqui afirma.
//
// **E o perigo mora na substituição do DAX.** `CALCULATE(x, ALL('T'[TIPO]))`
// derruba o filtro de tipo e mantém o de cidade. Se as linhas materializadas do
// grupo `(cidade, tipo)` continuassem valendo depois disso, o grupo ficaria
// estreito demais — número menor, plausível, sem aviso. Por isso o carimbo é do
// grupo inteiro e vale só enquanto **todos** os filtros dele estiverem no contexto.
//
// Os dois testes de `ALL` abaixo nasceram de um teste de mutação: tirando a
// conferência de validade, os 860 testes do repositório continuavam passando.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn } from '../../semantic-model/src/types.ts';
import { Dataset, type Row } from '../../measure-engine/src/dataset.ts';
import { Evaluator } from '../../measure-engine/src/evaluator.ts';
import type { TableFilter } from '../../measure-engine/src/filter.ts';
import { makeDate, type DaxValue } from '../../measure-engine/src/value.ts';
import { prepara } from '../src/grupos.ts';
import { calculaTabela } from '../src/tabela.ts';
import { calculaMatriz } from '../src/matriz.ts';
import { escopoComFiltros } from '../src/card.ts';
import type { CampoSpec, DashboardSpec, VisualSpec } from '../src/spec.ts';

const AGORA = makeDate(2026, 8, 7);

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

const OS: Row[] = [
  { ID: 1, CIDADE: 'Bauru', TIPO: 'Instalação', EQUIPE: 'A', VALOR: 10 },
  { ID: 2, CIDADE: 'Bauru', TIPO: 'Reparo', EQUIPE: 'A', VALOR: 30 },
  { ID: 3, CIDADE: 'Jaú', TIPO: 'Instalação', EQUIPE: 'B', VALOR: 60 },
  { ID: 4, CIDADE: 'Jaú', TIPO: 'Reparo', EQUIPE: 'B', VALOR: 100 },
  { ID: 5, CIDADE: 'Jaú', TIPO: 'Instalação', EQUIPE: null, VALOR: 500 },
];

const EQUIPES: Row[] = [
  { EQUIPE: 'A', REGIAO: 'Centro' },
  { EQUIPE: 'B', REGIAO: 'Oeste' },
];

/** `OS` muitos→um `EQUIPES`, para exercitar chave de outra tabela e linha em branco. */
function montar(): Evaluator {
  const model = new SemanticModel();
  model.addTable({
    id: 'os', name: 'OS', queryRef: null,
    columns: [col('ID'), col('CIDADE'), col('TIPO'), col('EQUIPE'), col('VALOR')],
  });
  model.addTable({ id: 'eq', name: 'EQUIPES', queryRef: null, columns: [col('EQUIPE'), col('REGIAO')] });
  model.relationships.push({
    id: 'r', fromTable: 'OS', fromColumn: 'EQUIPE', toTable: 'EQUIPES', toColumn: 'EQUIPE',
    fromCardinality: 'many', toCardinality: 'one', active: true,
    crossFilter: 'oneDirection', joinOnDateBehavior: null,
  });
  model.addMeasure({ name: 'Total', table: 'OS', format: null, displayFolder: null, dax: "SUM('OS'[VALOR])" });
  // A medida que remove **uma** das chaves do grupo — é ela que separa o certo do errado.
  model.addMeasure({
    name: 'Total sem tipo', table: 'OS', format: null, displayFolder: null,
    dax: "CALCULATE(SUM('OS'[VALOR]), ALL('OS'[TIPO]))",
  });
  model.addMeasure({
    name: 'Total sem cidade', table: 'OS', format: null, displayFolder: null,
    dax: "CALCULATE(SUM('OS'[VALOR]), ALL('OS'[CIDADE]))",
  });

  const dataset = new Dataset();
  dataset.addTable('OS', OS);
  dataset.addTable('EQUIPES', EQUIPES);
  return new Evaluator({ model, dataset, now: AGORA });
}

const coluna = (entity: string, property: string, role = 'Values'): CampoSpec => ({
  role, kind: 'column', entity, property, name: property,
});
const medida = (property: string, role = 'Values'): CampoSpec => ({
  role, kind: 'measure', entity: 'OS', property, name: property,
});

function visual(fields: CampoSpec[], tipo = 'tableEx', id = 'vis'): VisualSpec {
  return {
    id, type: tipo,
    position: { x: 0, y: 0, width: 1, height: 1 },
    entities_used: ['OS'], fields, filters: [], filters_vazios: 0,
  };
}

function pagina(visuals: VisualSpec[]): DashboardSpec {
  return {
    spec: 'v1', id: 'pag', page_id: 'p', name: 'Página', type: 'page', visibility: null,
    size: { width: 1, height: 1 }, visual_count: visuals.length,
    filters: [], filters_vazios: 0, visuals,
  };
}

// ---------------------------------------------------------------------------
// A substituição do DAX derruba o caminho rápido
// ---------------------------------------------------------------------------

/**
 * **O teste que a mutação pediu.** Grupo por `(CIDADE, TIPO)`; a medida remove o
 * filtro de tipo. A resposta certa para `(Bauru, Instalação)` é a soma de Bauru
 * inteira — 40 —, não os 10 da linha do grupo.
 */
test('ALL de uma das chaves alarga o grupo, e as linhas materializadas não valem mais', () => {
  const v = visual([coluna('OS', 'CIDADE'), coluna('OS', 'TIPO'), medida('Total'), medida('Total sem tipo')]);
  const r = calculaTabela(pagina([v]), v, montar());
  assert.deepEqual(r.colunas, ['CIDADE', 'TIPO', 'Total', 'Total sem tipo']);
  assert.deepEqual(r.linhas.map((l) => l.map((c) => c.valor)), [
    ['Bauru', 'Instalação', 10, 40],
    ['Bauru', 'Reparo', 30, 40],
    ['Jaú', 'Instalação', 560, 660],
    ['Jaú', 'Reparo', 100, 660],
  ]);
});

test('ALL da outra chave também alarga, e para o outro lado', () => {
  const v = visual([coluna('OS', 'CIDADE'), coluna('OS', 'TIPO'), medida('Total sem cidade')]);
  const r = calculaTabela(pagina([v]), v, montar());
  assert.deepEqual(r.linhas.map((l) => l[2]!.valor), [
    570, // Instalação em qualquer cidade: 10 + 60 + 500
    130, // Reparo em qualquer cidade: 30 + 100
    570,
    130,
  ]);
});

// ---------------------------------------------------------------------------
// Diferencial: com e sem materialização, o mesmo conjunto de linhas
// ---------------------------------------------------------------------------

/** O mesmo contexto, com o carimbo de grupo arrancado de todos os filtros. */
function semCarimbo(filtros: TableFilter[]): TableFilter[] {
  return filtros.map(({ grupo: _ignorado, ...resto }) => resto);
}

function comparaCaminhos(
  ev: Evaluator,
  chaves: Parameters<typeof prepara>[0],
  tabelas: string[],
): { grupos: number; comMaterializacao: number } {
  const base = escopoComFiltros(ev, []);
  const { grupos, filtrosDe } = prepara(chaves, base, ev, 'teste');
  let comMaterializacao = 0;

  for (const g of grupos) {
    const filtros = filtrosDe(g.valores);
    if (filtros.some((f) => f.grupo)) comMaterializacao++;
    const rapido = base.filter.with(filtros);
    const exato = base.filter.with(semCarimbo(filtros));
    for (const t of tabelas) {
      assert.deepEqual(
        rapido.rowsOf(t).map((r) => r.id ?? r.equipe),
        exato.rowsOf(t).map((r) => r.id ?? r.equipe),
        `${t} divergiu no grupo ${JSON.stringify(g.valores)}`,
      );
    }
  }
  return { grupos: grupos.length, comMaterializacao };
}

test('diferencial: chave de uma tabela só dá as mesmas linhas dos dois jeitos', () => {
  const ev = montar();
  const r = comparaCaminhos(ev, [{ tabela: 'OS', coluna: 'CIDADE', nivel: null, nome: null }], ['OS', 'EQUIPES']);
  assert.equal(r.grupos, 2);
  assert.equal(r.comMaterializacao, 2, 'o caminho rápido nem foi usado — o teste não prova nada');
});

test('diferencial: duas chaves da mesma tabela', () => {
  const ev = montar();
  const r = comparaCaminhos(
    ev,
    [
      { tabela: 'OS', coluna: 'CIDADE', nivel: null, nome: null },
      { tabela: 'OS', coluna: 'TIPO', nivel: null, nome: null },
    ],
    ['OS', 'EQUIPES'],
  );
  assert.equal(r.grupos, 4);
  assert.equal(r.comMaterializacao, 4);
});

/**
 * Chave de outra tabela: os filtros do grupo caem em `EQUIPES`, e as linhas
 * materializadas são de `OS` — a âncora. Inclui o grupo em branco, que é a linha
 * de `OS` cuja equipe não casa com ninguém.
 */
test('diferencial: chave cruzada, incluindo o grupo em branco', () => {
  const ev = montar();
  const r = comparaCaminhos(
    ev,
    [
      { tabela: 'OS', coluna: 'CIDADE', nivel: null, nome: null },
      { tabela: 'EQUIPES', coluna: 'REGIAO', nivel: null, nome: null },
    ],
    ['OS', 'EQUIPES'],
  );
  assert.equal(r.grupos, 3); // (Bauru,Centro) (Jaú,Oeste) (Jaú,BLANK)
  assert.equal(r.comMaterializacao, 3);
});

test('o grupo em branco de chave cruzada continua dando o número certo', () => {
  const v = visual([coluna('OS', 'CIDADE'), coluna('EQUIPES', 'REGIAO'), medida('Total')]);
  const r = calculaTabela(pagina([{ ...v, entities_used: ['OS', 'EQUIPES'] }]), v, montar());
  assert.deepEqual(r.linhas.map((l) => l.map((c) => c.valor)), [
    ['Bauru', 'Centro', 40],
    ['Jaú', 'Oeste', 160],
    ['Jaú', null, 500],
  ]);
});

// ---------------------------------------------------------------------------
// Matriz: duas materializações sobre a mesma tabela
// ---------------------------------------------------------------------------

/**
 * Uma célula tem o grupo do eixo de linha **e** o do eixo de coluna, os dois com
 * linhas materializadas de `OS`. O contexto começa pelo menor e confere o outro por
 * predicado — e o resultado é o cruzamento, não um dos dois lados.
 */
test('matriz: os dois eixos materializam, e a célula é o cruzamento', () => {
  const v = visual(
    [coluna('OS', 'CIDADE', 'Rows'), coluna('OS', 'TIPO', 'Columns'), medida('Total')],
    'pivotTable',
  );
  const r = calculaMatriz(pagina([v]), v, montar());
  assert.deepEqual(r.linhas.map((l) => l.valores), [['Bauru'], ['Jaú']]);
  assert.deepEqual(r.colunas.map((c) => c.valores), [['Instalação'], ['Reparo']]);
  assert.deepEqual(r.celulas, [
    [[10], [30]],
    [[560], [100]],
  ]);
});

test('matriz: uma célula que não existe fica em branco, não pega a linha errada', () => {
  const ev = montar();
  // Bauru não tem equipe B; a célula (Bauru, Oeste) não existe.
  const v = visual(
    [coluna('OS', 'CIDADE', 'Rows'), coluna('EQUIPES', 'REGIAO', 'Columns'), medida('Total')],
    'pivotTable',
  );
  const r = calculaMatriz(pagina([{ ...v, entities_used: ['OS', 'EQUIPES'] }]), v, ev);
  const iBauru = r.linhas.findIndex((l) => l.valores[0] === 'Bauru');
  const iOeste = r.colunas.findIndex((c) => c.valores[0] === 'Oeste');
  assert.equal(r.celulas[iBauru]![iOeste]![0], null);
});

// ---------------------------------------------------------------------------
// O carimbo em si
// ---------------------------------------------------------------------------

test('todos os filtros de um grupo levam o mesmo carimbo, e ele conta quantos são', () => {
  const ev = montar();
  const base = escopoComFiltros(ev, []);
  const { grupos, filtrosDe } = prepara(
    [
      { tabela: 'OS', coluna: 'CIDADE', nivel: null, nome: null },
      { tabela: 'OS', coluna: 'TIPO', nivel: null, nome: null },
    ],
    base, ev, 'teste',
  );
  const filtros = filtrosDe(grupos[0]!.valores);
  assert.equal(filtros.length, 2);
  assert.equal(filtros[0]!.grupo, filtros[1]!.grupo, 'carimbos diferentes no mesmo grupo');
  assert.equal(filtros[0]!.grupo!.filtros, 2);
  assert.equal(filtros[0]!.grupo!.tabela, 'os');
});

test('grupos diferentes nunca dividem o carimbo', () => {
  const ev = montar();
  const base = escopoComFiltros(ev, []);
  const chaves = [{ tabela: 'OS', coluna: 'CIDADE', nivel: null, nome: null }];
  const { grupos, filtrosDe } = prepara(chaves, base, ev, 'teste');
  const marcas = grupos.map((g) => filtrosDe(g.valores)[0]!.grupo!.marca);
  assert.equal(new Set(marcas).size, grupos.length);
});

test('chamar filtrosDe duas vezes para o mesmo grupo devolve o mesmo carimbo', () => {
  const ev = montar();
  const base = escopoComFiltros(ev, []);
  const chaves = [{ tabela: 'OS', coluna: 'CIDADE', nivel: null, nome: null }];
  const { grupos, filtrosDe } = prepara(chaves, base, ev, 'teste');
  const a = filtrosDe(grupos[0]!.valores)[0]!.grupo;
  const b = filtrosDe(grupos[0]!.valores)[0]!.grupo;
  assert.equal(a, b);
});

test('sem chave nenhuma não há grupo para materializar', () => {
  const ev = montar();
  const base = escopoComFiltros(ev, []);
  const { grupos, filtrosDe } = prepara([], base, ev, 'teste');
  assert.equal(grupos.length, 1);
  assert.deepEqual(filtrosDe([] as readonly DaxValue[]), []);
});
