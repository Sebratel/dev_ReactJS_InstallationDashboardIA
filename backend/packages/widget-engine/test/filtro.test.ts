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
import { ehFiltroDeGrupo, predicadoDeGrupo, separaFiltros, traduzFiltros } from '../src/filtro.ts';
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
 * **Filtro sobre valor agregado (`COUNT(x) > 0`) é recusado pelo nome.**
 *
 * São 10 no relatório, e o dano de aceitá-los é o maior deste arquivo: aplicado ao
 * valor cru, `COUNT(protocolo) > 0` vira `protocolo > 0`, que num campo numérico
 * aceita quase toda linha. O filtro sumiria sem deixar erro.
 *
 * Ele não é um predicado de linha: decide quais **grupos** o visual mostra, e isso
 * exige o agrupamento, que é a próxima fatia. Nenhum dos 10 está em card — travado
 * em cobertura.test.ts.
 */
test('filtro sobre valor agregado erra alto — é HAVING, não predicado de linha', () => {
  const f = filtro('VALOR', [
    { op: 'comparison', kind: 'gt', left_property: 'VALOR', left_aggregation: 'count', right: 0 },
  ]);
  assert.throws(() => sobrevivem([f]), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /HAVING/);
    assert.match(e.message, /COUNT/);
    return true;
  });
});

/**
 * Sem `left_aggregation`, a mesma comparação passa — é o contraste que mostra o
 * que o guarda pega. E aqui o predicado aceita as cinco linhas, que é exatamente o
 * dano: se o guarda não existisse, o filtro sumiria sem deixar erro.
 */
test('a mesma comparação sem agregação continua funcionando', () => {
  const f = filtro('VALOR', [
    { op: 'comparison', kind: 'gt', left_property: 'VALOR', left_aggregation: null, right: 0 },
  ]);
  assert.deepEqual(sobrevivem([f]), [1, 2, 3, 4, 5]);
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

// ---------------------------------------------------------------------------
// A separação entre filtro de linha e filtro de grupo
// ---------------------------------------------------------------------------

const havingSpec: FiltroSpec = {
  name: 'having', type: 'Advanced', entity: 'OS', property: 'VALOR',
  conditions: [{ op: 'comparison', kind: 'gt', left_property: 'VALOR', left_aggregation: 'count', right: 1 }],
};

test('separaFiltros põe cada filtro do lado certo', () => {
  const deLinhaSpec = filtro('CIDADE', [{ op: 'in', values: ['Jaú'] }]);
  const { deLinha, deGrupo } = separaFiltros([deLinhaSpec, havingSpec]);
  assert.deepEqual(deLinha, [deLinhaSpec]);
  assert.deepEqual(deGrupo, [havingSpec]);
});

test('ehFiltroDeGrupo só é verdade quando há left_aggregation', () => {
  assert.equal(ehFiltroDeGrupo(havingSpec), true);
  assert.equal(ehFiltroDeGrupo(filtro('CIDADE', [{ op: 'in', values: ['Jaú'] }])), false);
});

/**
 * O predicado de grupo avalia a agregação **dentro do escopo que recebe**. Sobre a
 * tabela inteira são 5 linhas com `VALOR` não vazio em 4 delas; `DISTINCTCOUNT`
 * conta 4 valores distintos + o vazio = 5.
 */
test('o predicado de grupo avalia a agregação no escopo dado', () => {
  const ev = montar();
  const h = predicadoDeGrupo(havingSpec, ev, 'teste');
  const total = ev.scopeWithGrouping(ev.rootScope(), []);
  assert.equal(h.passa(total), true);

  const alto = predicadoDeGrupo(
    { ...havingSpec, conditions: [{ ...havingSpec.conditions![0]!, right: 99 } as CondicaoSpec] },
    ev, 'teste',
  );
  assert.equal(alto.passa(total), false);
});

test('a origem do filtro de grupo se identifica como tal', () => {
  const ev = montar();
  assert.match(predicadoDeGrupo(havingSpec, ev, 'pag/vis').origem, /filtro de grupo/);
});

/**
 * Misturar condição de grupo com condição de linha no mesmo filtro exigiria aplicar
 * as duas em momentos diferentes — antes e depois de agrupar. Nenhum filtro do
 * relatório faz isso (todos têm uma condição só), e escolher um dos dois momentos
 * no escuro daria um número plausível.
 */
test('filtro que mistura condição de grupo e de linha erra alto', () => {
  const ev = montar();
  const misto: FiltroSpec = {
    ...havingSpec,
    conditions: [havingSpec.conditions![0]!, { op: 'in', values: ['x'] }],
  };
  assert.throws(() => predicadoDeGrupo(misto, ev, 't'), /momentos diferentes/);
});

test('filtro de grupo comparado com data ou null erra alto', () => {
  const ev = montar();
  const comNull: FiltroSpec = {
    ...havingSpec,
    conditions: [{ ...havingSpec.conditions![0]!, right: null } as CondicaoSpec],
  };
  assert.throws(() => predicadoDeGrupo(comNull, ev, 't'), /comparam com número/);
});

// ---------------------------------------------------------------------------
// Nível de hierarquia de datas — o filtro da segmentação da tela
// ---------------------------------------------------------------------------

/**
 * **A regra que este bloco guarda.**
 *
 * `f.nivel` faz o predicado comparar a **projeção** da coluna, não a coluna. Sem ele,
 * `DATA IN [2026]` compara o número 2026 contra um `Date` e não casa com linha
 * nenhuma — zero em toda a página, com a segmentação parecendo aplicada. É a única
 * razão de o campo existir, e o extrator nunca o escreve: dos 108 filtros do
 * relatório, 0 têm nível.
 */
test('nível Ano compara o ano, não a data', () => {
  // 2026 em três linhas (15/03, 10/03, 20/02); 2025 numa; uma sem data.
  assert.deepEqual(sobrevivem([filtro('DATA', [{ op: 'in', values: [2026] }], { nivel: 'Ano' })]), [1, 2, 3]);
  assert.deepEqual(sobrevivem([filtro('DATA', [{ op: 'in', values: [2025] }], { nivel: 'Ano' })]), [5]);
});

/**
 * **O mesmo filtro sem nível não devolve zero: ele erra alto.**
 *
 * Descobri isto escrevendo este teste, e a descoberta é boa notícia sobre o engine:
 * `confereEspecie` já compara as espécies dos dois lados e recusa número contra data,
 * com a frase exata do risco ("sairia vazio como se o filtro estivesse apenas
 * apertado"). Ou seja, o `nivel` não existe para **evitar um zero silencioso** — o
 * guarda dos filtros já cobria isso. Ele existe para tornar o filtro **possível**:
 * sem ele, a segmentação de Ano não tem como funcionar de jeito nenhum.
 *
 * Se este teste passar a devolver `[]` em vez de lançar, o guarda de espécie caiu — e
 * aí sim a classe de erro silencioso volta a existir, para todo filtro do relatório.
 */
test('sem nível, o mesmo filtro erra alto por comparar número com data', () => {
  assert.throws(
    () => sobrevivem([filtro('DATA', [{ op: 'in', values: [2026] }])]),
    (e: unknown) => e instanceof DaxEvalError && /compara número com data/.test((e as Error).message),
  );
});

test('nível Mês usa o nome do mês em português, o mesmo do eixo de gráfico', () => {
  assert.deepEqual(sobrevivem([filtro('DATA', [{ op: 'in', values: ['março'] }], { nivel: 'Mês' })]), [1, 2]);
  assert.deepEqual(sobrevivem([filtro('DATA', [{ op: 'in', values: ['fevereiro'] }], { nivel: 'Mês' })]), [3]);
});

test('nível Dia projeta o dia do mês', () => {
  assert.deepEqual(sobrevivem([filtro('DATA', [{ op: 'in', values: [15] }], { nivel: 'Dia' })]), [1]);
});

/**
 * BLANK continua BLANK. Projetar o vazio o transformaria no ano de 1970 — e pior,
 * `new Date(0)` daria 1970, então uma linha **sem data** casaria com um ano de
 * verdade se alguém marcasse 1970. A linha 4 não tem data e não pode entrar em
 * filtro de ano nenhum.
 */
test('linha sem data não casa com ano nenhum', () => {
  for (const ano of [2026, 2025, 1970]) {
    assert.ok(
      !sobrevivem([filtro('DATA', [{ op: 'in', values: [ano] }], { nivel: 'Ano' })]).includes(4),
      `ano ${ano} não pode trazer a linha sem data`,
    );
  }
});

test('nível sobre coluna que não é data erra alto, dizendo o tipo', () => {
  assert.throws(
    () => sobrevivem([filtro('STATUS', [{ op: 'in', values: [2026] }], { nivel: 'Ano' })]),
    (e: unknown) => e instanceof DaxEvalError && /não data|não é data/.test((e as Error).message),
  );
});

test('nível que a projeção não conhece erra alto e lista os suportados', () => {
  assert.throws(
    () => sobrevivem([filtro('DATA', [{ op: 'in', values: [1] }], { nivel: 'Semana' })]),
    (e: unknown) => e instanceof DaxEvalError && /não suportado.*Suportados:/s.test((e as Error).message),
  );
});

/** O nível não atrapalha o resto: filtro de coluna comum continua igual. */
test('filtro sem nível continua comparando a coluna crua', () => {
  assert.deepEqual(sobrevivem([filtro('CIDADE', [{ op: 'in', values: ['Bauru'] }])]), [1, 2]);
});
