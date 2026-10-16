// O agrupamento: uma linha por combinação distinta das chaves.
//
// Modelo pequeno com um relacionamento, porque o teste que mais importa aqui é o
// que mostra o grupo **filtrando através dele** — é o que prova que o grupo é um
// contexto de filtro e não um recorte de linhas.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn, ModelRelationship } from '../../semantic-model/src/types.ts';
import { Dataset, type Row } from '../../measure-engine/src/dataset.ts';
import { Evaluator } from '../../measure-engine/src/evaluator.ts';
import { DaxEvalError, makeDate } from '../../measure-engine/src/value.ts';
import { agrupar, chaveDoCampo, combinacoesDistintas, type Chave } from '../src/grupos.ts';
import type { CampoSpec } from '../src/spec.ts';

const AGORA = makeDate(2026, 3, 15);

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

/** `EQUIPES` (one) ← `OS` (many). O relacionamento é o que o teste de propagação usa. */
const RELACAO: ModelRelationship = {
  id: 'os-equipes',
  fromTable: 'OS', fromColumn: 'EQUIPE',
  toTable: 'EQUIPES', toColumn: 'NOME',
  fromCardinality: 'many', toCardinality: 'one',
  active: true, crossFilter: 'oneDirection', joinOnDateBehavior: null,
};

const OS: Row[] = [
  { ID: 1, CIDADE: 'Bauru', TIPO: 'Instalação', EQUIPE: 'Alfa', VALOR: 100 },
  { ID: 2, CIDADE: 'Bauru', TIPO: 'Reparo', EQUIPE: 'Alfa', VALOR: 200 },
  { ID: 3, CIDADE: 'Jaú', TIPO: 'Instalação', EQUIPE: 'Beta', VALOR: 300 },
  { ID: 4, CIDADE: 'Jaú', TIPO: 'Instalação', EQUIPE: 'Beta', VALOR: 400 },
  { ID: 5, CIDADE: 'Jaú', TIPO: 'Reparo', EQUIPE: null, VALOR: 500 },
];

const EQUIPES: Row[] = [
  { NOME: 'Alfa', REGIAO: 'Centro' },
  { NOME: 'Beta', REGIAO: 'Sul' },
];

function montar(os: Row[] = OS) {
  const model = new SemanticModel();
  model.addTable({
    id: 'os', name: 'OS', queryRef: null,
    columns: [col('ID'), col('CIDADE'), col('TIPO'), col('EQUIPE'), col('VALOR')],
  });
  model.addTable({
    id: 'equipes', name: 'EQUIPES', queryRef: null,
    columns: [col('NOME'), col('REGIAO')],
  });
  model.relationships.push(RELACAO);
  model.addMeasure({ name: 'Total', table: 'OS', format: null, displayFolder: null, dax: "SUM('OS'[VALOR])" });
  model.addMeasure({ name: 'Itens', table: 'OS', format: null, displayFolder: null, dax: "COUNTROWS('OS')" });
  model.addMeasure({
    name: 'Ticket', table: 'OS', format: null, displayFolder: null, dax: 'DIVIDE([Total], [Itens])',
  });

  const dataset = new Dataset();
  dataset.addTable('OS', os);
  dataset.addTable('EQUIPES', EQUIPES);
  return new Evaluator({ model, dataset, now: AGORA });
}

const chave = (tabela: string, coluna: string, nivel: string | null = null): Chave => ({
  tabela, coluna, nivel, nome: coluna,
});

/** O total de `[Total]` em cada grupo, junto com os valores da chave. */
function porGrupo(chaves: Chave[], ev = montar(), medida = 'Total') {
  return agrupar(chaves, ev.rootScope(), ev, 'teste').map((g) => [
    ...g.valores,
    ev.measureInScope(medida, g.escopo),
  ]);
}

// ---------------------------------------------------------------------------
// As combinações
// ---------------------------------------------------------------------------

test('uma linha por valor distinto da chave, na ordem de primeira aparição', () => {
  assert.deepEqual(porGrupo([chave('OS', 'CIDADE')]), [
    ['Bauru', 300],
    ['Jaú', 1200],
  ]);
});

/**
 * Duas chaves dão as combinações **que existem nas linhas**, não o produto
 * cartesiano das duas colunas. Aqui as quatro combinações possíveis existem todas,
 * e as quatro aparecem; o caso em que uma falta está no teste seguinte.
 */
test('duas chaves dão as combinações que existem nas linhas', () => {
  assert.deepEqual(porGrupo([chave('OS', 'CIDADE'), chave('OS', 'TIPO')]), [
    ['Bauru', 'Instalação', 100],
    ['Bauru', 'Reparo', 200],
    ['Jaú', 'Instalação', 700],
    ['Jaú', 'Reparo', 500],
  ]);
});

/** Combinação ausente não vira linha vazia: `Lins` não existe, e não aparece. */
test('combinação que não existe não vira grupo', () => {
  const ev = montar([
    { ID: 1, CIDADE: 'Bauru', TIPO: 'Instalação', EQUIPE: 'Alfa', VALOR: 10 },
    { ID: 2, CIDADE: 'Jaú', TIPO: 'Reparo', EQUIPE: 'Beta', VALOR: 20 },
  ]);
  assert.equal(agrupar([chave('OS', 'CIDADE'), chave('OS', 'TIPO')], ev.rootScope(), ev, 't').length, 2);
});

test('o vazio é um grupo como qualquer outro', () => {
  assert.deepEqual(porGrupo([chave('OS', 'EQUIPE')]), [
    ['Alfa', 300],
    ['Beta', 700],
    [null, 500],
  ]);
});

/**
 * **Sem chave nenhuma é o total** — um grupo só, e `ISINSCOPE` responde `FALSE`
 * para tudo. É este caso que faz `[Faixa 1 Premiação Total]` calcular.
 */
test('sem chave, um grupo só: o total', () => {
  const ev = montar();
  const grupos = agrupar([], ev.rootScope(), ev, 't');
  assert.equal(grupos.length, 1);
  assert.deepEqual(grupos[0]!.valores, []);
  assert.equal(ev.measureInScope('Total', grupos[0]!.escopo), 1500);
  assert.equal(ev.evaluateExpression("ISINSCOPE('OS'[CIDADE])", grupos[0]!.escopo), false);
});

// ---------------------------------------------------------------------------
// O grupo é um contexto de filtro
// ---------------------------------------------------------------------------

/**
 * **A razão de o grupo ser filtro e não recorte de linhas.** `[Ticket]` é
 * `DIVIDE([Total], [Itens])`: as duas medidas de dentro têm de enxergar o filtro do
 * grupo. Recortando linhas por fora, `[Itens]` contaria a tabela inteira e o ticket
 * de Jaú sairia 1200/5 = 240 em vez de 400.
 */
test('medida composta enxerga o filtro do grupo, não a tabela inteira', () => {
  assert.deepEqual(porGrupo([chave('OS', 'CIDADE')], montar(), 'Ticket'), [
    ['Bauru', 150], // 300/2
    ['Jaú', 400], // 1200/3
  ]);
});

/**
 * **O grupo atravessa relacionamento de graça.** Agrupar por `'EQUIPES'[REGIAO]`
 * restringe `OS` sem que `grupos.ts` saiba que existe relacionamento — quem faz
 * isso é a propagação da 2b.5. É o retorno concreto daquela fase.
 */
test('agrupar por uma tabela filtra a outra pelo relacionamento', () => {
  assert.deepEqual(porGrupo([chave('EQUIPES', 'REGIAO')]), [
    ['Centro', 300], // Alfa: OS 1 e 2
    ['Sul', 700], // Beta: OS 3 e 4
  ]);
});

/**
 * Duas chaves entram num `with()` **único**. Em chamadas encadeadas a segunda
 * substituiria a primeira (é a semântica do `CALCULATE`), e o "grupo"
 * `Bauru`+`Instalação` valeria por `Instalação` inteiro — 800 em vez de 100.
 */
test('as duas chaves valem juntas, não uma sobre a outra', () => {
  const linhas = porGrupo([chave('OS', 'CIDADE'), chave('OS', 'TIPO')]);
  const bauruInstalacao = linhas.find((l) => l[0] === 'Bauru' && l[1] === 'Instalação');
  assert.equal(bauruInstalacao![2], 100);
  assert.notEqual(bauruInstalacao![2], 800);
});

test('o escopo do grupo declara o agrupamento para o ISINSCOPE', () => {
  const ev = montar();
  const [g] = agrupar([chave('OS', 'CIDADE')], ev.rootScope(), ev, 't');
  assert.equal(ev.evaluateExpression("ISINSCOPE('OS'[CIDADE])", g!.escopo), true);
  assert.equal(ev.evaluateExpression("ISINSCOPE('OS'[TIPO])", g!.escopo), false);
});

/** Agrupar dentro de um escopo já filtrado só vê o que sobrou. */
test('o agrupamento respeita o filtro que já estava no escopo', () => {
  const ev = montar();
  const raiz = ev.rootScope();
  const soJau = ev.scopeWithFilter(raiz, raiz.filter.with([{
    table: 'os', columns: new Set(['cidade']), origem: 'teste',
    keep: (r: Row) => r.cidade === 'Jaú',
  }]));
  const grupos = agrupar([chave('OS', 'TIPO')], soJau, ev, 't');
  assert.deepEqual(grupos.map((g) => [g.valores[0], ev.measureInScope('Total', g.escopo)]), [
    ['Instalação', 700],
    ['Reparo', 500],
  ]);
});

// ---------------------------------------------------------------------------
// O que o agrupamento recusa
// ---------------------------------------------------------------------------

/**
 * Chaves de duas tabelas exigem seguir os relacionamentos para saber quais
 * combinações existem. O produto cartesiano criaria linhas que a tela não mostra.
 * São 4 dos 29 `tableEx` e 5 dos 8 `pivotTable` — a fatia seguinte.
 */
/**
 * Chaves de tabelas diferentes **atravessam o relacionamento** — a varredura sai da
 * tabela do lado "muitos" e segue até a do lado "um" (ver `expansao.test.ts`, que é
 * onde essa semântica é provada contra o produto cartesiano). Aqui só se fixa que o
 * caminho está ligado: `OS` tem 2 cidades, `EQUIPES` tem 2 regiões, e o produto daria
 * 4 combinações onde existem 3.
 */
test('chaves de tabelas diferentes atravessam o relacionamento', () => {
  const ev = montar();
  assert.deepEqual(porGrupo([chave('OS', 'CIDADE'), chave('EQUIPES', 'REGIAO')], ev), [
    ['Bauru', 'Centro', 300],
    ['Jaú', 'Sul', 700],
    ['Jaú', null, 500],
  ]);
});

const campo = (kind: string, extra: Partial<CampoSpec> = {}): CampoSpec => ({
  role: 'Values', kind, entity: 'OS', property: 'CIDADE', name: 'Cidade', ...extra,
});

test('nível de hierarquia é chave, e leva o nível junto', () => {
  assert.deepEqual(chaveDoCampo(campo('hierarchy_level', { level: 'Mês' }), 'x'), {
    tabela: 'OS', coluna: 'CIDADE', nivel: 'Mês', nome: 'Cidade',
  });
});

/**
 * O nível é **obrigatório**, e a mensagem diz o tamanho do estrago: `[Data].[Ano]`
 * e `[Data].[Dia]` são o mesmo campo com um nome diferente, e escolher em silêncio
 * troca 1 ponto no eixo por 365.
 */
test('nível de hierarquia sem o nome do nível erra alto', () => {
  assert.throws(() => chaveDoCampo(campo('hierarchy_level', { level: null }), 'x'), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /sem nome do nível/);
    return true;
  });
});

test('nível de hierarquia que não existe erra alto e lista os que existem', () => {
  assert.throws(() => chaveDoCampo(campo('hierarchy_level', { level: 'Semana' }), 'x'), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /Semana/);
    assert.match(e.message, /Suportados:.*trimestre/);
    return true;
  });
});

test('medida e agregação não são chave', () => {
  assert.throws(() => chaveDoCampo(campo('measure'), 'x'), /não é chave/);
  assert.throws(() => chaveDoCampo(campo('aggregation'), 'x'), /não é chave/);
});

test('chave sem tabela ou coluna erra alto', () => {
  assert.throws(() => chaveDoCampo(campo('column', { entity: null }), 'x'), DaxEvalError);
  assert.throws(() => chaveDoCampo(campo('column', { property: null }), 'x'), DaxEvalError);
});

test('chaveDoCampo devolve tabela, coluna e o rótulo da tela', () => {
  assert.deepEqual(chaveDoCampo(campo('column', { name: 'Município' }), 'x'), {
    tabela: 'OS', coluna: 'CIDADE', nivel: null, nome: 'Município',
  });
});

// ---------------------------------------------------------------------------
// `combinacoesDistintas`: o caminho sem escopo da tabela só de chaves
// ---------------------------------------------------------------------------

/**
 * A prova de que o atalho da tabela de detalhe não muda linha nenhuma: as mesmas
 * combinações, na mesma ordem, que `agrupar` — o caminho de antes. Os dois ramos da
 * enumeração (uma tabela só; chaves atravessando o relacionamento), com BLANK, data
 * com nível de hierarquia e um escopo já filtrado.
 */
test('combinacoesDistintas dá as mesmas combinações, na mesma ordem, que agrupar', () => {
  // Determinístico e com repetição de propósito: 600 linhas, bem menos combinações.
  const cidades = ['Bauru', 'Jaú', null, 'BAURU'];
  const tipos = ['Instalação', 'Reparo', null];
  const linhas: Row[] = Array.from({ length: 600 }, (_, i) => ({
    ID: i % 97,
    CIDADE: cidades[(i * 7) % cidades.length]!,
    TIPO: tipos[(i * 5) % tipos.length]!,
    EQUIPE: i % 11 === 0 ? null : i % 3 === 0 ? 'Alfa' : 'Beta',
    VALOR: i % 13 === 0 ? null : makeDate(2025 + (i % 2), 1 + (i % 12), 1 + (i % 28)),
  }));
  const ev = montar(linhas);
  const raiz = ev.rootScope();
  const semJau = ev.scopeWithFilter(raiz, raiz.filter.with([{
    table: 'os', columns: new Set(['cidade']), origem: 'teste',
    keep: (r: Row) => r.cidade !== 'Jaú',
  }]));
  const casos: Chave[][] = [
    [chave('OS', 'CIDADE')],
    [chave('OS', 'ID'), chave('OS', 'CIDADE'), chave('OS', 'TIPO'), chave('OS', 'EQUIPE')],
    [chave('OS', 'TIPO'), chave('OS', 'VALOR'), chave('OS', 'VALOR', 'Ano')],
    [chave('OS', 'CIDADE'), chave('EQUIPES', 'REGIAO')],
    [chave('EQUIPES', 'REGIAO'), chave('OS', 'TIPO'), chave('OS', 'ID')],
  ];
  for (const chaves of casos) {
    for (const escopo of [raiz, semJau]) {
      const antes = agrupar(chaves, escopo, ev, 't').map((g) => g.valores);
      assert.ok(antes.length > 1);
      assert.deepEqual(combinacoesDistintas(chaves, escopo, ev, 't'), antes);
    }
  }
});
