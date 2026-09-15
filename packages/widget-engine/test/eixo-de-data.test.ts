// O eixo de datas: agrupar por `'T'[Data].[Mês]`, que não é uma coluna.
//
// **É o eixo de 10 dos 16 gráficos**, e a hierarquia chega na spec sempre inteira —
// Ano, Mês e Dia juntos, com `active` dizendo quais estão na tela (ACHADOS.md #32).
// Agrupar por ela é projetar o nível sobre a data linha a linha, e a projeção é a
// mesma que `FORMAT` e `.[Mês]` já usavam nas medidas: uma tabela de meses só, para
// não haver duas respostas possíveis para `março`.
//
// O dataset tem **duas datas no mesmo mês de anos diferentes** de propósito. É o
// único par que separa as duas leituras possíveis de um eixo com Ano e Mês ativos:
// agrupar pelos dois dá dois pontos, agrupar só pelo nível mais fino junta 2025 e
// 2026 em `janeiro` e some com um ponto sem dizer nada.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn } from '../../semantic-model/src/types.ts';
import { Dataset, type Row } from '../../measure-engine/src/dataset.ts';
import { Evaluator } from '../../measure-engine/src/evaluator.ts';
import { BLANK, DaxEvalError, makeDate } from '../../measure-engine/src/value.ts';
import { agrupar, leitorDaChave, valorDaChave, type Chave } from '../src/grupos.ts';

const AGORA = makeDate(2026, 8, 7);

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

const OS: Row[] = [
  { ID: 1, DATA: makeDate(2026, 1, 10), VALOR: 100 },
  { ID: 2, DATA: makeDate(2026, 1, 25), VALOR: 200 },
  { ID: 3, DATA: makeDate(2026, 3, 2), VALOR: 300 },
  { ID: 4, DATA: makeDate(2025, 1, 5), VALOR: 400 },
  { ID: 5, DATA: null, VALOR: 500 },
];

function montar(linhas: Row[] = OS) {
  const model = new SemanticModel();
  model.addTable({
    id: 'os', name: 'OS', queryRef: null,
    columns: [col('ID'), col('DATA', { type: 'dateTime' }), col('VALOR')],
  });
  model.addMeasure({ name: 'Total', table: 'OS', format: null, displayFolder: null, dax: "SUM('OS'[VALOR])" });
  const dataset = new Dataset();
  dataset.addTable('OS', linhas);
  return new Evaluator({ model, dataset, now: AGORA });
}

const nivel = (coluna: string, n: string | null): Chave => ({
  tabela: 'OS', coluna, nivel: n, nome: coluna,
});

/**
 * As linhas **como o dataset as guarda**.
 *
 * `Dataset.addTable` normaliza as chaves para minúsculas, então passar o literal
 * `OS[0]` direto devolve `null` em toda coluna — e `null` vira BLANK, que passa por
 * "linha sem data" em vez de por erro de teste. Já custou uma rodada.
 */
function linhas(ev: Evaluator): Row[] {
  return ev.rootScope().filter.rowsOf('OS');
}

/** Valores da chave + `[Total]` de cada grupo. */
function porGrupo(chaves: Chave[], ev = montar()) {
  return agrupar(chaves, ev.rootScope(), ev, 'teste').map((g) => [
    ...g.valores,
    ev.measureInScope('Total', g.escopo),
  ]);
}

// ---------------------------------------------------------------------------
// A projeção
// ---------------------------------------------------------------------------

test('o nível projeta a data, e o mês sai em pt-BR minúsculo', () => {
  const ev = montar();
  const linha = linhas(ev)[0]!;
  assert.equal(valorDaChave(nivel('DATA', 'Ano'), linha, ev, 't'), 2026);
  assert.equal(valorDaChave(nivel('DATA', 'Mês'), linha, ev, 't'), 'janeiro');
  assert.equal(valorDaChave(nivel('DATA', 'Dia'), linha, ev, 't'), 10);
  assert.equal(valorDaChave(nivel('DATA', 'Trimestre'), linha, ev, 't'), 'Trim 1');
});

/** Sem nível a chave é a coluna crua — o caminho que já existia. */
test('chave sem nível devolve a célula, não uma projeção', () => {
  const ev = montar();
  assert.deepEqual(valorDaChave(nivel('DATA', null), linhas(ev)[0]!, ev, 't'), makeDate(2026, 1, 10));
});

/**
 * Uma linha sem data não pertence a mês nenhum. Fazer BLANK cair em `janeiro`
 * (mês 0) somaria 500 ao primeiro ponto do gráfico — e janeiro é o ponto que
 * ninguém confere, porque é o primeiro.
 */
test('data em branco fica em branco, não vira janeiro', () => {
  const ev = montar();
  const semData = linhas(ev)[4]!;
  assert.equal(valorDaChave(nivel('DATA', 'Mês'), semData, ev, 't'), BLANK);
  assert.equal(valorDaChave(nivel('DATA', 'Ano'), semData, ev, 't'), BLANK);
});

test('nível sobre coluna que não é data erra alto e mostra o que veio', () => {
  const ev = montar();
  assert.throws(() => valorDaChave(nivel('VALOR', 'Mês'), linhas(ev)[0]!, ev, 't'), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /exige coluna de data/);
    assert.match(e.message, /100/);
    return true;
  });
});

// ---------------------------------------------------------------------------
// O agrupamento
// ---------------------------------------------------------------------------

test('agrupar por mês junta as linhas do mesmo mês', () => {
  // Janeiro tem 2026-01-10, 2026-01-25 e 2025-01-05 — os três caem em `janeiro`.
  assert.deepEqual(porGrupo([nivel('DATA', 'Mês')]), [
    ['janeiro', 700],
    ['março', 300],
    [BLANK, 500],
  ]);
});

/**
 * **O teste que separa as duas leituras.** Com Ano e Mês ativos o eixo é o par, e
 * `janeiro/2025` é um ponto diferente de `janeiro/2026`. Só com o nível mais fino
 * seriam 2 pontos em vez de 3, e os 400 de 2025 apareceriam somados a 2026.
 */
test('agrupar por ano e mês distingue janeiro de 2025 de janeiro de 2026', () => {
  assert.deepEqual(porGrupo([nivel('DATA', 'Ano'), nivel('DATA', 'Mês')]), [
    [2026, 'janeiro', 300],
    [2026, 'março', 300],
    [2025, 'janeiro', 400],
    [BLANK, BLANK, 500],
  ]);
});

test('agrupar por ano, mês e dia dá um ponto por data distinta', () => {
  const pontos = porGrupo([nivel('DATA', 'Ano'), nivel('DATA', 'Mês'), nivel('DATA', 'Dia')]);
  assert.equal(pontos.length, 5);
  assert.deepEqual(pontos[0], [2026, 'janeiro', 10, 100]);
  assert.deepEqual(pontos[1], [2026, 'janeiro', 25, 200]);
});

/** A mesma coluna pode ser chave crua e chave projetada no mesmo visual. */
test('nível e coluna crua da mesma coluna são chaves distintas', () => {
  const pontos = porGrupo([nivel('DATA', 'Mês'), nivel('DATA', null)]);
  assert.equal(pontos.length, 5);
});

// ---------------------------------------------------------------------------
// O que o grupo põe em escopo
// ---------------------------------------------------------------------------

/**
 * **Agrupar por `[DATA].[Mês]` não põe `[DATA]` em escopo.** Dentro do ponto
 * `janeiro` a data ainda varia — dia 10 e dia 25 —, então a coluna não está
 * determinada e `ISINSCOPE('OS'[DATA])` tem de responder FALSE. Registrar a coluna
 * base faria uma medida que testa `ISINSCOPE` mudar de ramo no ponto errado.
 */
test('o nível entra em escopo sob chave própria, não sob a da coluna base', () => {
  const ev = montar();
  const [primeiro] = agrupar([nivel('DATA', 'Mês')], ev.rootScope(), ev, 't');
  assert.equal(ev.evaluateExpression("ISINSCOPE('OS'[DATA])", primeiro!.escopo), false);
  assert.deepEqual([...primeiro!.escopo.agrupamento!], ['os[data].[mês]']);
});

test('agrupar pela coluna crua põe a coluna em escopo', () => {
  const ev = montar();
  const [primeiro] = agrupar([nivel('DATA', null)], ev.rootScope(), ev, 't');
  assert.equal(ev.evaluateExpression("ISINSCOPE('OS'[DATA])", primeiro!.escopo), true);
});

/**
 * O filtro do grupo restringe a **coluna base**, então um `CALCULATE` sobre ela
 * sobrepõe o eixo — que é o que uma medida de inteligência de tempo espera. Fosse
 * registrado sob a chave do nível, o filtro do eixo sobreviveria ao `CALCULATE` e o
 * número sairia menor sem nada apontar por quê.
 */
test('CALCULATE sobre a coluna de data sobrepõe o filtro do eixo', () => {
  const ev = montar();
  const grupos = agrupar([nivel('DATA', 'Mês')], ev.rootScope(), ev, 't');
  const janeiro = grupos[0]!;
  assert.equal(ev.measureInScope('Total', janeiro.escopo), 700);
  assert.equal(
    ev.evaluateExpression("CALCULATE([Total], ALL('OS'[DATA]))", janeiro.escopo),
    1500,
  );
});

/** A origem do filtro nomeia o nível — é o que se lê para conferir contra a tela. */
test('a origem do filtro de grupo diz o nível, não só a coluna', () => {
  const ev = montar();
  const [g] = agrupar([nivel('DATA', 'Mês')], ev.rootScope(), ev, 'pag/vis');
  const origens = g!.escopo.filter.filters.map((f) => f.origem);
  assert.ok(
    origens.some((o) => o.includes("'OS'[DATA].[Mês]")),
    `nenhuma origem cita o nível: ${JSON.stringify(origens)}`,
  );
});

// ---------------------------------------------------------------------------
// O leitor içado
// ---------------------------------------------------------------------------
//
// `leitorDaChave` existe para tirar a normalização do nome de dentro dos laços,
// e `valorDaChave` passou a ser um atalho para ele. O risco não é ficar lento: é
// os dois caminhos divergirem num nível pouco usado e o eixo do gráfico agrupar
// errado — sem erro nenhum, porque "Trim 1" e "Trim 2" são ambos plausíveis.

test('leitorDaChave concorda com valorDaChave em todos os níveis', () => {
  const ev = montar();
  const todas = linhas(ev);
  for (const n of [null, 'Ano', 'Mês', 'Dia', 'Trimestre']) {
    const c = nivel('DATA', n);
    const ler = leitorDaChave(c, ev, 't');
    assert.deepEqual(
      todas.map((l) => ler(l)),
      todas.map((l) => valorDaChave(c, l, ev, 't')),
      `nível ${n ?? '(cru)'}`,
    );
  }
});

test('o mesmo leitor serve linhas diferentes, e BLANK continua BLANK', () => {
  // Se o fecho capturasse o VALOR em vez do nome, a coluna inteira sairia com o
  // valor da primeira linha — um eixo constante, que ninguém lê como defeito.
  const ev = montar();
  const ler = leitorDaChave(nivel('DATA', 'Mês'), ev, 't');
  const todas = linhas(ev);
  assert.equal(ler(todas[0]!), 'janeiro');
  assert.equal(ler(todas[2]!), 'março');
  assert.equal(ler(todas[3]!), 'janeiro', 'ano diferente, mesmo mês');
  assert.equal(ler(todas[4]!), BLANK, 'linha sem data não pertence a mês nenhum');
  assert.equal(ler(todas[0]!), 'janeiro', 'e reler a primeira dá o mesmo');
});

test('o erro do nível sobre não-data sai na LEITURA, não ao pedir o leitor', () => {
  // O `keep` do filtro de grupo monta o leitor preguiçosamente, na primeira linha.
  // Se pedir o leitor já errasse, um grupo que o índice de igualdade resolve — e
  // que portanto não varre linha nenhuma — passaria a falhar onde hoje não falha.
  const ev = montar();
  assert.doesNotThrow(() => leitorDaChave(nivel('VALOR', 'Mês'), ev, 't'));
  const ler = leitorDaChave(nivel('VALOR', 'Mês'), ev, 't');
  assert.throws(() => ler(linhas(ev)[0]!), DaxEvalError);
});
