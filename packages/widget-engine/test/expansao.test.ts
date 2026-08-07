// Agrupar por colunas de tabelas diferentes.
//
// **O dataset é montado para que o produto cartesiano dê um número diferente.** Com
// 2 cidades e 2 regiões, o produto dá 4 combinações; as que existem são 3, e uma
// delas o produto nem conhece (a linha sem equipe). Um teste em que os dois números
// coincidem não prova nada — provaria só que alguma coisa rodou.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn, ModelRelationship } from '../../semantic-model/src/types.ts';
import { Dataset, type Row } from '../../measure-engine/src/dataset.ts';
import { Evaluator } from '../../measure-engine/src/evaluator.ts';
import { BLANK, DaxEvalError, makeDate } from '../../measure-engine/src/value.ts';
import { agrupar, type Chave } from '../src/grupos.ts';
import { caminhoAte, escolheAncora, tabelaExpandida } from '../src/expansao.ts';

const AGORA = makeDate(2026, 8, 7);

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

function relacao(
  id: string,
  de: [string, string],
  para: [string, string],
  extra: Partial<ModelRelationship> = {},
): ModelRelationship {
  return {
    id,
    fromTable: de[0], fromColumn: de[1],
    toTable: para[0], toColumn: para[1],
    fromCardinality: 'many', toCardinality: 'one',
    active: true, crossFilter: 'oneDirection', joinOnDateBehavior: null,
    ...extra,
  };
}

/**
 * `OS` (fato) → `EQUIPES` → `REGIOES`, e `OS` → `CALENDARIO`.
 *
 * Duas dimensões penduradas no mesmo fato e uma cadeia de dois saltos: é a forma
 * mínima que reproduz os três casos do relatório real.
 */
const OS: Row[] = [
  { ID: 1, CIDADE: 'Bauru', EQUIPE: 'Alfa', DATA: makeDate(2026, 1, 10), VALOR: 100 },
  { ID: 2, CIDADE: 'Bauru', EQUIPE: 'Alfa', DATA: makeDate(2026, 1, 20), VALOR: 200 },
  { ID: 3, CIDADE: 'Jaú', EQUIPE: 'Beta', DATA: makeDate(2026, 3, 5), VALOR: 300 },
  { ID: 4, CIDADE: 'Jaú', EQUIPE: 'Beta', DATA: makeDate(2026, 3, 6), VALOR: 400 },
  // Sem equipe: o produto cartesiano de cidades × regiões nem sabe que existe.
  { ID: 5, CIDADE: 'Jaú', EQUIPE: null, DATA: makeDate(2026, 3, 7), VALOR: 500 },
];

const EQUIPES: Row[] = [
  { NOME: 'Alfa', REGIAO: 'Centro', RID: 'r1' },
  { NOME: 'Beta', REGIAO: 'Sul', RID: 'r2' },
];

const REGIOES: Row[] = [
  { ID: 'r1', DIRETORIA: 'Norte-Oeste' },
  { ID: 'r2', DIRETORIA: 'Sul-Leste' },
];

const CALENDARIO: Row[] = [
  { DIA: makeDate(2026, 1, 10), TRIM: 'T1' },
  { DIA: makeDate(2026, 1, 20), TRIM: 'T1' },
  { DIA: makeDate(2026, 3, 5), TRIM: 'T1' },
  { DIA: makeDate(2026, 3, 6), TRIM: 'T1' },
  { DIA: makeDate(2026, 3, 7), TRIM: 'T1' },
];

function montar(relacoes?: ModelRelationship[]) {
  const model = new SemanticModel();
  model.addTable({
    id: 'os', name: 'OS', queryRef: null,
    columns: [col('ID'), col('CIDADE'), col('EQUIPE'), col('DATA', { type: 'dateTime' }), col('VALOR')],
  });
  model.addTable({ id: 'equipes', name: 'EQUIPES', queryRef: null, columns: [col('NOME'), col('REGIAO'), col('RID')] });
  model.addTable({ id: 'regioes', name: 'REGIOES', queryRef: null, columns: [col('ID'), col('DIRETORIA')] });
  model.addTable({ id: 'cal', name: 'CALENDARIO', queryRef: null, columns: [col('DIA', { type: 'dateTime' }), col('TRIM')] });
  model.relationships.push(...(relacoes ?? [
    relacao('os-equipes', ['OS', 'EQUIPE'], ['EQUIPES', 'NOME']),
    relacao('equipes-regioes', ['EQUIPES', 'RID'], ['REGIOES', 'ID']),
    relacao('os-cal', ['OS', 'DATA'], ['CALENDARIO', 'DIA']),
  ]));
  model.addMeasure({ name: 'Total', table: 'OS', format: null, displayFolder: null, dax: "SUM('OS'[VALOR])" });
  model.addMeasure({ name: 'Itens', table: 'OS', format: null, displayFolder: null, dax: "COUNTROWS('OS')" });

  const dataset = new Dataset();
  dataset.addTable('OS', OS);
  dataset.addTable('EQUIPES', EQUIPES);
  dataset.addTable('REGIOES', REGIOES);
  dataset.addTable('CALENDARIO', CALENDARIO);
  return new Evaluator({ model, dataset, now: AGORA });
}

const chave = (tabela: string, coluna: string, nivel: string | null = null): Chave => ({
  tabela, coluna, nivel, nome: coluna,
});

function porGrupo(chaves: Chave[], ev = montar(), medida = 'Total') {
  return agrupar(chaves, ev.rootScope(), ev, 'teste').map((g) => [
    ...g.valores,
    ev.measureInScope(medida, g.escopo),
  ]);
}

// ---------------------------------------------------------------------------
// A tabela expandida e a âncora
// ---------------------------------------------------------------------------

test('a expandida do fato alcança as dimensões; a da dimensão não alcança o fato', () => {
  const ev = montar();
  assert.deepEqual([...tabelaExpandida(ev.model, 'OS')].sort(), ['calendario', 'equipes', 'os', 'regioes']);
  assert.deepEqual([...tabelaExpandida(ev.model, 'EQUIPES')].sort(), ['equipes', 'regioes']);
  assert.deepEqual([...tabelaExpandida(ev.model, 'CALENDARIO')], ['calendario']);
});

/**
 * `bothDirections` muda por onde o **filtro** propaga, não o que a tabela contém.
 * Se entrasse na expansão, qualquer dimensão viraria âncora do fato e a varredura
 * sairia da tabela errada.
 */
test('bothDirections não expande a dimensão para o fato', () => {
  const ev = montar([
    relacao('os-equipes', ['OS', 'EQUIPE'], ['EQUIPES', 'NOME'], { crossFilter: 'bothDirections' }),
  ]);
  assert.deepEqual([...tabelaExpandida(ev.model, 'EQUIPES')], ['equipes']);
});

test('relacionamento inativo não expande', () => {
  const ev = montar([relacao('os-equipes', ['OS', 'EQUIPE'], ['EQUIPES', 'NOME'], { active: false })]);
  assert.deepEqual([...tabelaExpandida(ev.model, 'OS')], ['os']);
});

test('a âncora é o fato, não a dimensão', () => {
  const ev = montar();
  assert.equal(escolheAncora(['OS', 'EQUIPES'], ev.model, 't'), 'OS');
  assert.equal(escolheAncora(['EQUIPES', 'REGIOES'], ev.model, 't'), 'EQUIPES');
});

/**
 * Duas dimensões sem caminho entre si: quem as liga é o fato, e ele **não está no
 * visual**. É o caso de `relatorio-do-ano/2d498e...`, o único do relatório. A
 * mensagem nomeia os candidatos porque cada um dá um conjunto de combinações
 * diferente.
 */
test('duas dimensões sem o fato no visual erram alto, nomeando os candidatos', () => {
  const ev = montar();
  assert.throws(() => escolheAncora(['EQUIPES', 'CALENDARIO'], ev.model, 't'), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /tabela de fato que \*\*não está no visual\*\*/);
    assert.match(e.message, /Candidatas: OS/);
    return true;
  });
});

test('tabelas que não se falam erram alto sem falar em candidato', () => {
  const ev = montar([relacao('os-equipes', ['OS', 'EQUIPE'], ['EQUIPES', 'NOME'])]);
  assert.throws(() => escolheAncora(['EQUIPES', 'CALENDARIO'], ev.model, 't'), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /não se alcançam por relacionamento nenhum/);
    return true;
  });
});

// ---------------------------------------------------------------------------
// O caminho
// ---------------------------------------------------------------------------

test('o caminho até a própria tabela é vazio', () => {
  assert.deepEqual(caminhoAte(montar().model, 'OS', 'OS', 't'), []);
});

test('o caminho de dois saltos passa pela tabela do meio', () => {
  const c = caminhoAte(montar().model, 'OS', 'REGIOES', 't');
  assert.deepEqual(c.map((a) => `${a.deTabela}->${a.paraTabela}`), ['OS->EQUIPES', 'EQUIPES->REGIOES']);
});

/**
 * Dois caminhos do mesmo tamanho são **duas junções diferentes** — é o caso real de
 * uma tabela de fato com data de criação e data de instalação apontando para o mesmo
 * calendário. Qual delas o visual usa é decisão do relatório.
 */
test('dois caminhos do mesmo tamanho erram alto em vez de escolher', () => {
  const ev = montar([
    relacao('por-criacao', ['OS', 'DATA'], ['CALENDARIO', 'DIA']),
    relacao('por-instalacao', ['OS', 'DATA'], ['CALENDARIO', 'DIA']),
  ]);
  assert.throws(() => caminhoAte(ev.model, 'OS', 'CALENDARIO', 't'), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /2 caminhos/);
    assert.match(e.message, /junções diferentes/);
    return true;
  });
});

// ---------------------------------------------------------------------------
// O agrupamento cruzado
// ---------------------------------------------------------------------------

/**
 * **O teste que separa expansão de produto cartesiano.** São 2 cidades e 2 regiões:
 * o produto daria 4 combinações, e nenhuma delas seria a linha sem equipe. A
 * expansão dá 3, e cada valor é o da própria linha.
 */
test('agrupar por fato + dimensão dá as combinações que existem, não o produto', () => {
  assert.deepEqual(porGrupo([chave('OS', 'CIDADE'), chave('EQUIPES', 'REGIAO')]), [
    ['Bauru', 'Centro', 300],
    ['Jaú', 'Sul', 700],
    ['Jaú', BLANK, 500],
  ]);
});

test('a chave estrangeira que não casa vira BLANK, e o grupo continua existindo', () => {
  const grupos = porGrupo([chave('EQUIPES', 'REGIAO')], montar());
  // Varre OS? Não: com uma tabela só, varre EQUIPES — e lá não há linha sem região.
  assert.deepEqual(grupos, [['Centro', 300], ['Sul', 700]]);
  // Com o fato na jogada, a linha órfã aparece.
  assert.deepEqual(porGrupo([chave('OS', 'ID'), chave('EQUIPES', 'REGIAO')]).at(-1), [5, BLANK, 500]);
});

test('dois saltos: o valor vem da tabela do fim da cadeia', () => {
  assert.deepEqual(porGrupo([chave('OS', 'CIDADE'), chave('REGIOES', 'DIRETORIA')]), [
    ['Bauru', 'Norte-Oeste', 300],
    ['Jaú', 'Sul-Leste', 700],
    ['Jaú', BLANK, 500],
  ]);
});

test('três tabelas de uma vez', () => {
  const g = porGrupo([chave('OS', 'CIDADE'), chave('EQUIPES', 'REGIAO'), chave('REGIOES', 'DIRETORIA')]);
  assert.deepEqual(g, [
    ['Bauru', 'Centro', 'Norte-Oeste', 300],
    ['Jaú', 'Sul', 'Sul-Leste', 700],
    ['Jaú', BLANK, BLANK, 500],
  ]);
});

/** O nível de hierarquia também funciona sobre coluna de outra tabela. */
test('nível de hierarquia sobre coluna da dimensão', () => {
  assert.deepEqual(porGrupo([chave('OS', 'CIDADE'), chave('CALENDARIO', 'DIA', 'Mês')]), [
    ['Bauru', 'janeiro', 300],
    ['Jaú', 'março', 1200],
  ]);
});

/**
 * O grupo é um **filtro**, e vale para as duas tabelas: a medida dentro dele vê só
 * as linhas do grupo, e a contagem prova isso melhor que a soma.
 */
test('a medida do grupo cruzado enxerga só as linhas do grupo', () => {
  assert.deepEqual(porGrupo([chave('OS', 'CIDADE'), chave('EQUIPES', 'REGIAO')], montar(), 'Itens'), [
    ['Bauru', 'Centro', 2],
    ['Jaú', 'Sul', 2],
    ['Jaú', BLANK, 1],
  ]);
});

/** O agrupamento declarado leva as duas colunas — `ISINSCOPE` responde pelas duas. */
test('as duas colunas entram em escopo', () => {
  const ev = montar();
  const [g] = agrupar([chave('OS', 'CIDADE'), chave('EQUIPES', 'REGIAO')], ev.rootScope(), ev, 't');
  assert.equal(ev.evaluateExpression("ISINSCOPE('OS'[CIDADE])", g!.escopo), true);
  assert.equal(ev.evaluateExpression("ISINSCOPE('EQUIPES'[REGIAO])", g!.escopo), true);
  assert.equal(ev.evaluateExpression("ISINSCOPE('OS'[VALOR])", g!.escopo), false);
});

/**
 * A varredura é sobre as linhas **visíveis** da âncora. Um filtro que esvazia a
 * âncora dá zero grupos — e é a explicação dos 3 `tableEx` cruzados que calculam e
 * não trazem linha nenhuma sobre dado sintético.
 */
test('filtro que esvazia a âncora dá zero grupos', () => {
  const ev = montar();
  const raiz = ev.rootScope();
  const vazio = ev.scopeWithFilter(raiz, raiz.filter.with([{
    table: 'os', columns: new Set(['cidade']),
    origem: 'teste', keep: () => false,
  }]));
  assert.deepEqual(agrupar([chave('OS', 'CIDADE'), chave('EQUIPES', 'REGIAO')], vazio, ev, 't'), []);
});
