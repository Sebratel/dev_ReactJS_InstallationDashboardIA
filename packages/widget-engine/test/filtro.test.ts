// Tradução de filtro de spec para `TableFilter`, sobre um modelo pequeno.
//
// Modelo de teste e não o real: aqui cada linha que sobrevive ao filtro é
// contável a olho, então um teste vermelho aponta a regra errada. A conferência
// contra os 108 filtros do relatório é medida em cobertura.test.ts.
//
// O teste que carrega o arquivo é o de página + visual sobre a mesma coluna. Os
// outros protegem casos; esse protege a diferença entre o número certo e um
// número maior com a mesma cara.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn } from '../../semantic-model/src/types.ts';
import { Dataset, type Row } from '../../measure-engine/src/dataset.ts';
import { Evaluator } from '../../measure-engine/src/evaluator.ts';
import { DaxEvalError, makeDate } from '../../measure-engine/src/value.ts';
import { traduzFiltros } from '../src/filtro.ts';
import type { CondicaoSpec, FiltroSpec } from '../src/spec.ts';

/** 15/03/2026 14:37 — o mesmo "agora" de datas.test.ts, com hora para truncar. */
const AGORA = new Date(Date.UTC(2026, 2, 15, 14, 37, 52));

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

const OS: Row[] = [
  { ID: 1, STATUS: 'Instalado', CIDADE: 'Bauru', SUPERVISOR: 'Ana', DATA: makeDate(2026, 3, 15), VALOR: 100 },
  { ID: 2, STATUS: 'Cancelado', CIDADE: 'Bauru', SUPERVISOR: 'Ana', DATA: makeDate(2026, 3, 10), VALOR: 250 },
  { ID: 3, STATUS: 'Instalado', CIDADE: 'Jaú', SUPERVISOR: null, DATA: makeDate(2026, 2, 20), VALOR: 250 },
  { ID: 4, STATUS: 'Pendente', CIDADE: 'Jaú', SUPERVISOR: 'Bia', DATA: null, VALOR: 50 },
  { ID: 5, STATUS: 'Instalado', CIDADE: 'Lins', SUPERVISOR: 'Bia', DATA: makeDate(2025, 12, 31), VALOR: 900 },
];

function montar(rows: Row[] = OS) {
  const model = new SemanticModel();
  model.addTable({
    id: 'os',
    name: 'OS',
    queryRef: null,
    columns: [
      col('ID'), col('STATUS'), col('CIDADE'), col('SUPERVISOR'),
      col('DATA', { type: 'dateTime' }), col('VALOR'),
    ],
  });
  const dataset = new Dataset();
  dataset.addTable('OS', rows);
  return new Evaluator({ model, dataset, now: AGORA });
}

/** Filtro de spec sobre `'OS'[coluna]`, com as condições dadas. */
function filtro(coluna: string, conditions: CondicaoSpec[], extra: Partial<FiltroSpec> = {}): FiltroSpec {
  return { name: `f ${coluna}`, type: 'Categorical', entity: 'OS', property: coluna, conditions, ...extra };
}

/**
 * Os IDs que sobrevivem aos filtros, na ordem do dataset.
 *
 * A chave é `id` minúsculo porque o `Dataset` normaliza o nome da coluna na
 * entrada — a linha crua não conserva a caixa com que foi escrita.
 */
function sobrevivem(filtros: FiltroSpec[], ev = montar()): number[] {
  const traduzidos = traduzFiltros(filtros, ev, 'teste');
  const raiz = ev.rootScope();
  const escopo = ev.scopeWithFilter(raiz, raiz.filter.with(traduzidos));
  return escopo.filter.rowsOf('OS').map((r) => r.id as number);
}

// ---------------------------------------------------------------------------
// A regra central: página e visual se somam
// ---------------------------------------------------------------------------

/**
 * **Este é o teste que justifica `traduzFiltros` receber uma lista só.**
 *
 * Página diz "Bauru ou Jaú", visual diz "Jaú ou Lins", as duas sobre `CIDADE`. O
 * certo é a interseção: só Jaú. Aplicando em dois `with()` encadeados, o filtro de
 * visual substituiria o de página (é a semântica de `CALCULATE`, e ela está certa
 * para DAX) e o card mostraria Jaú **e Lins** — um número maior, sem erro nenhum.
 */
test('filtro de página e de visual sobre a mesma coluna se somam (E)', () => {
  const pagina = filtro('CIDADE', [{ op: 'in', values: ['Bauru', 'Jaú'] }]);
  const visual = filtro('CIDADE', [{ op: 'in', values: ['Jaú', 'Lins'] }]);
  assert.deepEqual(sobrevivem([pagina, visual]), [3, 4]);
});

/** O contraste que mostra que o de cima não passa por acidente de dados. */
test('em dois `with()` encadeados o de visual apagaria o de página', () => {
  const ev = montar();
  const pagina = traduzFiltros([filtro('CIDADE', [{ op: 'in', values: ['Bauru', 'Jaú'] }])], ev, 't');
  const visual = traduzFiltros([filtro('CIDADE', [{ op: 'in', values: ['Jaú', 'Lins'] }])], ev, 't');
  const raiz = ev.rootScope();
  const encadeado = raiz.filter.with(pagina).with(visual);
  assert.deepEqual(encadeado.rowsOf('OS').map((r) => r.id), [3, 4, 5]); // Lins entrou de volta
});

/** Duas condições no mesmo filtro são cláusulas do mesmo `Where`: valem juntas. */
test('as condições de um mesmo filtro valem todas (E)', () => {
  const f = filtro('VALOR', [
    { op: 'comparison', kind: 'gt', left_property: 'VALOR', left_aggregation: null, right: 60 },
    { op: 'comparison', kind: 'lt', left_property: 'VALOR', left_aggregation: null, right: 500 },
  ]);
  assert.deepEqual(sobrevivem([f]), [1, 2, 3]);
});

test('filtros sobre colunas diferentes se somam', () => {
  const a = filtro('CIDADE', [{ op: 'in', values: ['Jaú'] }]);
  const b = filtro('STATUS', [{ op: 'in', values: ['Instalado'] }]);
  assert.deepEqual(sobrevivem([a, b]), [3]);
});

// ---------------------------------------------------------------------------
// in / not_in
// ---------------------------------------------------------------------------

test('`in` mantém os valores listados e `not_in` os exclui', () => {
  assert.deepEqual(sobrevivem([filtro('STATUS', [{ op: 'in', values: ['Instalado'] }])]), [1, 3, 5]);
  assert.deepEqual(sobrevivem([filtro('STATUS', [{ op: 'not_in', values: ['Instalado'] }])]), [2, 4]);
});

/**
 * A comparação usa `identityKey`, que é a mesma do DAX: texto casa **sem
 * distinguir caixa**. Não é folga deste arquivo — é a regra do motor, e o modelo
 * real escreve a mesma coluna como `[Protocolo]` e `[protocolo]`.
 */
test('`in` casa texto sem distinguir caixa, como o DAX', () => {
  assert.deepEqual(sobrevivem([filtro('STATUS', [{ op: 'in', values: ['INSTALADO'] }])]), [1, 3, 5]);
});

/**
 * **`null` dentro da lista é a forma real, e é comum: 40 dos 104 valores de
 * `in`/`not_in` do relatório são `null`** (medido em cobertura.test.ts). É como o
 * painel do Power BI escreve "(Em branco)" entre as opções marcadas.
 *
 * Sem isso funcionar, o `not_in` mais frequente da base — "tudo menos estes, e
 * menos os vazios" — deixaria as linhas vazias passarem.
 */
test('`null` na lista casa a linha vazia', () => {
  assert.deepEqual(sobrevivem([filtro('SUPERVISOR', [{ op: 'in', values: [null] }])]), [3]);
  assert.deepEqual(sobrevivem([filtro('SUPERVISOR', [{ op: 'not_in', values: [null] }])]), [1, 2, 4, 5]);
});

test('`not_in` sem `null` na lista mantém a linha vazia', () => {
  const ids = sobrevivem([filtro('SUPERVISOR', [{ op: 'not_in', values: ['Ana'] }])]);
  assert.deepEqual(ids, [3, 4, 5]);
});

/**
 * `null` na lista **não** dispara a checagem de espécie: vazio não tem espécie, e
 * exigir que tivesse recusaria a forma mais comum de filtro da base.
 */
test('`null` misturado com texto não vira erro de espécie', () => {
  assert.deepEqual(sobrevivem([filtro('SUPERVISOR', [{ op: 'in', values: ['Ana', null] }])]), [1, 2, 3]);
});

// ---------------------------------------------------------------------------
// comparison contra literal
// ---------------------------------------------------------------------------

test('comparações de ordem contra número', () => {
  const cmp = (kind: string, right: number): CondicaoSpec => ({
    op: 'comparison', kind, left_property: 'VALOR', left_aggregation: null, right,
  });
  assert.deepEqual(sobrevivem([filtro('VALOR', [cmp('gt', 250)])]), [5]);
  assert.deepEqual(sobrevivem([filtro('VALOR', [cmp('ge', 250)])]), [2, 3, 5]);
  assert.deepEqual(sobrevivem([filtro('VALOR', [cmp('lt', 100)])]), [4]);
  assert.deepEqual(sobrevivem([filtro('VALOR', [cmp('le', 100)])]), [1, 4]);
  assert.deepEqual(sobrevivem([filtro('VALOR', [cmp('eq', 250)])]), [2, 3]);
});

test('`negado` inverte a comparação', () => {
  const f = filtro('VALOR', [
    { op: 'comparison', kind: 'eq', left_property: 'VALOR', left_aggregation: null, right: 250, negado: true },
  ]);
  assert.deepEqual(sobrevivem([f]), [1, 4, 5]);
});

/**
 * `coluna = null` é como o painel do Power BI escreve "é vazio", e aqui ele é
 * tratado como vazio mesmo — não pelo `=` do DAX, sob o qual BLANK equivale a 0.
 * Desvio deliberado, e é o que a intenção do painel pede.
 */
test('comparação contra null é "é vazio", não "igual a zero"', () => {
  const f = filtro('DATA', [
    { op: 'comparison', kind: 'eq', left_property: 'DATA', left_aggregation: null, right: null },
  ]);
  assert.deepEqual(sobrevivem([f]), [4]);
});

test('comparação de ordem contra null não tem leitura óbvia e erra alto', () => {
  const f = filtro('DATA', [
    { op: 'comparison', kind: 'gt', left_property: 'DATA', left_aggregation: null, right: null },
  ]);
  assert.throws(() => sobrevivem([f]), DaxEvalError);
});

/**
 * Linha vazia não passa em comparação de ordem — vazio não é "menor que tudo".
 *
 * O caso é montado sobre `VALOR` e não sobre `DATA` porque comparar data exige um
 * `DateSpan` do lado direito: nenhum literal de data em texto sobrevive à checagem
 * de espécie, e nenhum filtro da base tem um (medido em cobertura.test.ts).
 */
test('linha vazia não sobrevive a comparação de ordem', () => {
  const ev = montar([
    { ID: 1, STATUS: 'a', CIDADE: 'a', SUPERVISOR: 'a', DATA: null, VALOR: 10 },
    { ID: 2, STATUS: 'a', CIDADE: 'a', SUPERVISOR: 'a', DATA: null, VALOR: null },
  ]);
  const f = filtro('VALOR', [
    { op: 'comparison', kind: 'gt', left_property: 'VALOR', left_aggregation: null, right: 0 },
  ]);
  assert.deepEqual(sobrevivem([f], ev), [1]);
});

// ---------------------------------------------------------------------------
// comparison contra DateSpan
// ---------------------------------------------------------------------------

const spanMes = { anchor_kind: 'agora' as const, anchor: null, time_unit: 'month', time_unit_code: null };

/**
 * `coluna = DateSpan(agora, mês)` **não** é igualdade de instante: o span é um
 * intervalo, e `eq` contra intervalo é "cai dentro dele". É assim que o Power BI
 * escreve "este mês", e são 14 dos 16 `eq` do relatório.
 */
test('`eq` contra DateSpan de mês é "cai dentro do mês"', () => {
  const f = filtro('DATA', [
    { op: 'comparison', kind: 'eq', left_property: 'DATA', left_aggregation: null, right: spanMes },
  ]);
  assert.deepEqual(sobrevivem([f]), [1, 2]); // março/2026; a de 20/02 e a de 2025 ficam fora
});

test('`eq` contra DateSpan de ano pega o ano inteiro', () => {
  const f = filtro('DATA', [{
    op: 'comparison', kind: 'eq', left_property: 'DATA', left_aggregation: null,
    right: { ...spanMes, time_unit: 'year' },
  }]);
  assert.deepEqual(sobrevivem([f]), [1, 2, 3]); // 2026; a de 31/12/2025 fica fora
});

test('`eq` negado contra DateSpan devolve o complemento, com a linha vazia junto', () => {
  const f = filtro('DATA', [{
    op: 'comparison', kind: 'eq', left_property: 'DATA', left_aggregation: null,
    right: spanMes, negado: true,
  }]);
  assert.deepEqual(sobrevivem([f]), [3, 4, 5]);
});

/**
 * Ordem contra span **acima do dia** erra alto de propósito: "maior que este mês"
 * depende de o Power BI comparar com o início ou com o fim do intervalo, e as duas
 * leituras dão números diferentes. Nenhum filtro do relatório faz isso (medido em
 * cobertura.test.ts: os 12 de ordem são contra número ou contra span de segundo).
 */
test('ordem contra DateSpan de mês erra alto em vez de escolher a borda', () => {
  const f = filtro('DATA', [
    { op: 'comparison', kind: 'gt', left_property: 'DATA', left_aggregation: null, right: spanMes },
  ]);
  assert.throws(() => sobrevivem([f]), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /início ou com o fim/);
    return true;
  });
});

/** Abaixo do dia o span é um instante, e a comparação de ordem é exata. */
test('ordem contra DateSpan de segundo é comparação de instante', () => {
  const f = filtro('DATA', [{
    op: 'comparison', kind: 'lt', left_property: 'DATA', left_aggregation: null,
    right: { ...spanMes, time_unit: 'second' },
  }]);
  assert.deepEqual(sobrevivem([f]), [1, 2, 3, 5]); // tudo antes de agora; a vazia não conta
});

// ---------------------------------------------------------------------------
// between_relativo
// ---------------------------------------------------------------------------

test('`between_relativo` é inclusivo nas duas pontas', () => {
  const dia = (amount: number) => ({
    anchor_kind: 'agora' as const, anchor: null, truncate: 'day', truncate_code: null,
    offsets: [{ amount, time_unit: 'day', time_unit_code: null }],
  });
  // De 10/03 até 15/03, ambos inclusive.
  const f = filtro('DATA', [{ op: 'between_relativo', property: 'DATA', lower: dia(-5), upper: dia(0) }]);
  assert.deepEqual(sobrevivem([f]), [1, 2]);
});

test('janela invertida erra alto em vez de devolver vazio', () => {
  const borda = (amount: number) => ({
    anchor_kind: 'agora' as const, anchor: null, truncate: 'day', truncate_code: null,
    offsets: [{ amount, time_unit: 'day', time_unit_code: null }],
  });
  const f = filtro('DATA', [{ op: 'between_relativo', property: 'DATA', lower: borda(0), upper: borda(-5) }]);
  assert.throws(() => sobrevivem([f]), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /janela invertida/);
    return true;
  });
});

// ---------------------------------------------------------------------------
// O que o arquivo se recusa a fazer
// ---------------------------------------------------------------------------

test('filtro sem tabela ou coluna erra alto', () => {
  assert.throws(() => sobrevivem([{ ...filtro('STATUS', []), entity: null }]), DaxEvalError);
  assert.throws(() => sobrevivem([{ ...filtro('STATUS', []), property: null }]), DaxEvalError);
});

test('filtro sem condição erra alto — cartão vazio não deveria chegar aqui', () => {
  assert.throws(() => sobrevivem([filtro('STATUS', [])]), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /filters_vazios/);
    return true;
  });
});

/**
 * Condição sobre coluna diferente da do filtro. Hoje coincidem nos 108 filtros do
 * relatório; aplicar a condição na coluna errada daria um número plausível.
 */
test('condição que fala de outra coluna erra alto', () => {
  const f = filtro('STATUS', [
    { op: 'comparison', kind: 'eq', left_property: 'CIDADE', left_aggregation: null, right: 'Jaú' },
  ]);
  assert.throws(() => sobrevivem([f]), DaxEvalError);
});

test("condição `desconhecido` erra alto e aponta o extrator", () => {
  const f = filtro('STATUS', [{ op: 'desconhecido', raw: { algo: 1 } }]);
  assert.throws(() => sobrevivem([f]), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /tools\/extractor/);
    return true;
  });
});

test('comparação de tipo sem tradução erra alto', () => {
  const f = filtro('VALOR', [
    { op: 'comparison', kind: 'startsWith', left_property: 'VALOR', left_aggregation: null, right: 'a' },
  ]);
  assert.throws(() => sobrevivem([f]), DaxEvalError);
});

/**
 * Espécies diferentes nas duas pontas nunca casam, e o card sairia vazio como se o
 * filtro estivesse apenas apertado. É a mesma armadilha que a junção já cobre: a
 * coluna que chega como texto `DD/MM/YYYY` contra um valor de data.
 */
test('filtro que compara texto com número erra alto em vez de sair vazio', () => {
  const f = filtro('VALOR', [{ op: 'in', values: ['100'] }]);
  assert.throws(() => sobrevivem([f]), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /texto com número|número com texto/);
    return true;
  });
});

test('filtro de data sobre coluna de texto DD/MM/YYYY erra alto', () => {
  const ev = montar([{ ID: 1, STATUS: 'x', CIDADE: 'y', DATA: '15/03/2026', VALOR: 1 }]);
  const f = filtro('DATA', [
    { op: 'comparison', kind: 'eq', left_property: 'DATA', left_aggregation: null, right: spanMes },
  ]);
  assert.throws(() => sobrevivem([f], ev), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /DD\/MM\/YYYY/);
    return true;
  });
});

/**
 * A checagem de espécie olha a **primeira linha vista**, não o resultado: um
 * filtro que legitimamente não casa com nada é possível e não deve virar erro.
 */
test('filtro que não casa com nada, mas da espécie certa, devolve vazio sem erro', () => {
  assert.deepEqual(sobrevivem([filtro('CIDADE', [{ op: 'in', values: ['Marília'] }])]), []);
});

test('o `origem` do filtro diz tabela, coluna e tipo — é o que aparece no card', () => {
  const ev = montar();
  const [f] = traduzFiltros([filtro('CIDADE', [{ op: 'in', values: ['Jaú'] }])], ev, 'pagina/visual');
  assert.match(f!.origem, /pagina\/visual/);
  assert.match(f!.origem, /'OS'\[CIDADE\]/);
  assert.deepEqual([...f!.columns], ['cidade']);
  assert.equal(f!.table, 'os');
});
