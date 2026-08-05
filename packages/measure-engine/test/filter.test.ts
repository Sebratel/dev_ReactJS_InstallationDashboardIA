// Contexto de filtro: `CALCULATE`, `FILTER`, `ALL`, transição de contexto.
//
// Aqui é onde a paridade se ganha ou se perde em silêncio. Uma agregação errada
// costuma dar erro; um contexto de filtro errado dá **outro número**, plausível, e
// ninguém percebe. Cada teste abaixo fixa uma regra do DAX em que a
// implementação "óbvia" daria resposta diferente.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn } from '../../semantic-model/src/types.ts';
import { Dataset, type Row } from '../src/dataset.ts';
import { Evaluator } from '../src/evaluator.ts';
import { makeDate } from '../src/value.ts';

const HOJE = makeDate(2026, 8, 4);

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

/**
 * Modelo com duas tabelas sem relacionamento — de propósito: `TREATAS` existe
 * justamente para cruzar tabelas sem relacionamento, e é o que a base faz entre
 * `FIELD AGENDA` e `PROTOCOLOS GERAL`.
 */
const VENDAS: Row[] = [
  { Protocolo: 'P1', Ano: 2025, Equipe: 'A', Valor: 10 },
  { Protocolo: 'P2', Ano: 2026, Equipe: 'A', Valor: 20 },
  { Protocolo: 'P3', Ano: 2026, Equipe: 'B', Valor: 30 },
  { Protocolo: 'P4', Ano: 2026, Equipe: 'B', Valor: 40 },
];

const AGENDA: Row[] = [
  { Protocolo: 'P2', Data: makeDate(2026, 8, 3) },
  { Protocolo: 'P3', Data: makeDate(2026, 8, 4) },
];

const FERIADOS: Row[] = [
  { Data: makeDate(2026, 9, 7), Feriado: 'Independência' },
  { Data: makeDate(2026, 12, 25), Feriado: 'Natal' },
];

function montar() {
  const model = new SemanticModel();
  model.addTable({
    id: 'v', name: 'VENDAS', queryRef: null,
    columns: [col('Protocolo'), col('Ano', { type: 'int64' }), col('Equipe'), col('Valor', { type: 'int64' })],
  });
  model.addTable({
    id: 'a', name: 'AGENDA', queryRef: null,
    columns: [col('Protocolo'), col('Data', { type: 'dateTime' })],
  });
  model.addTable({
    id: 'f', name: 'FERIADOS', queryRef: null,
    columns: [col('Data', { type: 'dateTime' }), col('Feriado')],
  });

  const m = (name: string, dax: string) =>
    model.addMeasure({ name, table: 'VENDAS', format: null, displayFolder: null, dax });

  m('Total', "SUM('VENDAS'[Valor])");
  m('Total 2026', "CALCULATE([Total], 'VENDAS'[Ano] = 2026)");
  m('Total 2026 pedido em 2025', "CALCULATE([Total 2026], 'VENDAS'[Ano] = 2025)");
  m('Total todos os anos', "CALCULATE([Total], ALL('VENDAS'[Ano]))");

  const dataset = new Dataset();
  dataset.addTable('VENDAS', VENDAS);
  dataset.addTable('AGENDA', AGENDA);
  dataset.addTable('FERIADOS', FERIADOS);
  return new Evaluator({ model, dataset, now: HOJE });
}

const ev = () => montar();

// ---------------------------------------------------------------------------
// CALCULATE
// ---------------------------------------------------------------------------

test('CALCULATE com filtro booleano estreita o contexto', () => {
  assert.equal(ev().evaluateExpression("CALCULATE(SUM('VENDAS'[Valor]), 'VENDAS'[Ano] = 2026)"), 90);
  assert.equal(ev().evaluateExpression("CALCULATE(SUM('VENDAS'[Valor]), 'VENDAS'[Equipe] = \"A\")"), 30);
});

test('filtros do MESMO CALCULATE se somam — dois valores na mesma coluna dá vazio', () => {
  // Dentro de um CALCULATE todos os argumentos de filtro valem juntos. É por isso
  // que pedir Ano=2025 E Ano=2026 ao mesmo tempo não devolve os dois: devolve nada.
  const e = ev();
  assert.equal(
    e.evaluateExpression("CALCULATE(SUM('VENDAS'[Valor]), 'VENDAS'[Ano] = 2026, 'VENDAS'[Equipe] = \"B\")"),
    70,
  );
  assert.equal(
    e.evaluateExpression("CALCULATE(SUM('VENDAS'[Valor]), 'VENDAS'[Ano] = 2026, 'VENDAS'[Ano] = 2025)"),
    null,
    'agregação sobre nenhuma linha é BLANK',
  );
});

test('CALCULATE aninhado SUBSTITUI o filtro da mesma coluna, e quem vence é o de DENTRO', () => {
  // A regra mais importante deste arquivo, e a que engana: `[Total 2026 pedido em
  // 2025]` é CALCULATE([Total 2026], 'VENDAS'[Ano] = 2025). O filtro de fora põe
  // 2025; o CALCULATE de dentro de `[Total 2026]` põe 2026 e **substitui**. Dá 90,
  // o total de 2026 — o pedido de fora é simplesmente descartado.
  //
  // O que este número prova: se os filtros se intersectassem, Ano=2025 e Ano=2026
  // juntos dariam BLANK. 90 só sai se houver substituição.
  assert.equal(ev().measure('Total 2026 pedido em 2025'), 90);
});

test('filtro em coluna diferente se acumula com o de fora', () => {
  const e = ev();
  assert.equal(
    e.evaluateExpression(
      "CALCULATE(CALCULATE(SUM('VENDAS'[Valor]), 'VENDAS'[Equipe] = \"B\"), 'VENDAS'[Ano] = 2026)",
    ),
    70,
    'Ano=2026 e Equipe=B convivem: colunas diferentes',
  );
});

test('ALL da coluna remove o filtro dela, e só dela', () => {
  // `[Total todos os anos]` é CALCULATE([Total], ALL('VENDAS'[Ano])). Pedido dentro
  // de um contexto de 2026, ele desfaz esse filtro e soma tudo: 100.
  assert.equal(
    ev().evaluateExpression("CALCULATE([Total todos os anos], 'VENDAS'[Ano] = 2026)"),
    100,
    'ALL(Ano) desfaz o Ano = 2026 de fora',
  );
  assert.equal(
    ev().evaluateExpression(
      "CALCULATE([Total todos os anos], 'VENDAS'[Ano] = 2026, 'VENDAS'[Equipe] = \"A\")",
    ),
    30,
    'o filtro de Equipe sobrevive ao ALL(Ano): equipe A em todos os anos = 10 + 20',
  );
});

test('filtro booleano com função em volta da coluna — a forma que a base usa', () => {
  // `YEAR('T'[Data]) = 2026` e `TRUNC('T'[Data]) = x` são DAX real desta base.
  // Quem diz quais colunas o filtro restringe é o AST, não o formato da expressão.
  const e = ev();
  assert.equal(
    e.evaluateExpression("CALCULATE(COUNTROWS('AGENDA'), YEAR('AGENDA'[Data]) = 2026)"),
    2,
  );
  assert.equal(
    e.evaluateExpression("CALCULATE(COUNTROWS('AGENDA'), YEAR('AGENDA'[Data]) = 2025)"),
    null,
  );
});

test('filtro booleano que mistura tabelas erra alto', () => {
  assert.throws(
    () => ev().evaluateExpression(
      "CALCULATE(SUM('VENDAS'[Valor]), 'VENDAS'[Ano] = 2026 && 'AGENDA'[Protocolo] = \"P2\")",
    ),
    /uma só|2 tabelas/,
  );
});

// ---------------------------------------------------------------------------
// FILTER, VALUES, COUNTROWS
// ---------------------------------------------------------------------------

test('FILTER soma ao contexto em vez de substituir', () => {
  // Diferença deliberada em relação ao filtro booleano: FILTER itera o que já
  // está visível. Dentro de Ano=2026, FILTER por Ano=2025 não "reabre" 2025.
  const e = ev();
  assert.equal(e.evaluateExpression("COUNTROWS(FILTER('VENDAS', 'VENDAS'[Ano] = 2026))"), 3);
  assert.equal(
    e.evaluateExpression(
      "CALCULATE(COUNTROWS(FILTER('VENDAS', 'VENDAS'[Ano] = 2025)), 'VENDAS'[Ano] = 2026)",
    ),
    null,
  );
});

test('FILTER sobre ALL reabre a tabela — o idioma de "últimos 30 dias"', () => {
  assert.equal(
    ev().evaluateExpression(
      "CALCULATE(COUNTROWS(FILTER(ALL('VENDAS'), 'VENDAS'[Ano] = 2025)), 'VENDAS'[Ano] = 2026)",
    ),
    1,
  );
});

test('VALUES devolve valores distintos do contexto corrente', () => {
  const e = ev();
  assert.equal(e.evaluateExpression("COUNTROWS(VALUES('VENDAS'[Equipe]))"), 2);
  assert.equal(
    e.evaluateExpression("CALCULATE(COUNTROWS(VALUES('VENDAS'[Equipe])), 'VENDAS'[Ano] = 2025)"),
    1,
  );
});

test('IN sobre expressão de tabela', () => {
  assert.equal(ev().evaluateExpression("\"A\" IN VALUES('VENDAS'[Equipe])"), true);
  assert.equal(ev().evaluateExpression("\"Z\" IN VALUES('VENDAS'[Equipe])"), false);
});

// ---------------------------------------------------------------------------
// Transição de contexto
// ---------------------------------------------------------------------------

test('AVERAGEX + CALCULATE calcula por linha do iterador, não o total repetido', () => {
  // Sem transição de contexto, o CALCULATE de dentro devolveria 100 em toda linha
  // e a média sairia 100. Com transição, dá a média de 10, 20+30+40 = (10+90)/2 = 50.
  assert.equal(
    ev().evaluateExpression(
      "AVERAGEX(VALUES('VENDAS'[Ano]), CALCULATE(SUM('VENDAS'[Valor])))",
    ),
    50,
  );
});

test('referência a medida traz CALCULATE implícito — transição sem escrever CALCULATE', () => {
  // Regra do DAX: `[Medida]` dentro de contexto de linha já vem embrulhada em
  // CALCULATE. Se não fosse, esta média daria 100 (o total, repetido 2 vezes).
  assert.equal(ev().evaluateExpression("AVERAGEX(VALUES('VENDAS'[Ano]), [Total])"), 50);
});

test('AVERAGEX ignora linha que dá BLANK em vez de contá-la como zero', () => {
  // Contar BLANK como 0 puxaria a média para baixo sem erro nenhum.
  assert.equal(
    ev().evaluateExpression(
      "AVERAGEX(VALUES('VENDAS'[Equipe]), CALCULATE(SUM('VENDAS'[Valor]), 'VENDAS'[Ano] = 2025))",
    ),
    10,
    'só a equipe A tem 2025; a B dá BLANK e fica fora',
  );
});

// ---------------------------------------------------------------------------
// TREATAS e LOOKUPVALUE
// ---------------------------------------------------------------------------

test('TREATAS cruza tabelas sem relacionamento', () => {
  // AGENDA tem P2 e P3; a soma em VENDAS desses dois é 20 + 30.
  assert.equal(
    ev().evaluateExpression(
      "CALCULATE(SUM('VENDAS'[Valor]), TREATAS(VALUES('AGENDA'[Protocolo]), 'VENDAS'[Protocolo]))",
    ),
    50,
  );
});

test('LOOKUPVALUE acha, e devolve BLANK quando não acha', () => {
  const e = ev();
  assert.equal(
    e.evaluateExpression("LOOKUPVALUE(FERIADOS[Feriado], FERIADOS[Data], DATE(2026, 12, 25))"),
    'Natal',
  );
  assert.equal(
    e.evaluateExpression("LOOKUPVALUE(FERIADOS[Feriado], FERIADOS[Data], DATE(2026, 8, 4))"),
    null,
  );
  // É assim que 'CALENDARIO INSTALADO'[PESO] decide se o dia é feriado.
  assert.equal(
    e.evaluateExpression(
      "NOT(ISBLANK(LOOKUPVALUE(FERIADOS[Feriado], FERIADOS[Data], DATE(2026, 9, 7))))",
    ),
    true,
  );
});

test('LOOKUPVALUE ambíguo erra em vez de escolher um resultado', () => {
  const model = new SemanticModel();
  model.addTable({
    id: 'f', name: 'FERIADOS', queryRef: null,
    columns: [col('Data', { type: 'dateTime' }), col('Feriado')],
  });
  const dataset = new Dataset();
  dataset.addTable('FERIADOS', [
    { Data: makeDate(2026, 9, 7), Feriado: 'Independência' },
    { Data: makeDate(2026, 9, 7), Feriado: 'Outro nome' },
  ]);
  const e = new Evaluator({ model, dataset, now: HOJE });
  assert.throws(
    () => e.evaluateExpression("LOOKUPVALUE(FERIADOS[Feriado], FERIADOS[Data], DATE(2026, 9, 7))"),
    /casou 2 valores diferentes/,
  );
});

test('LOOKUPVALUE ignora o contexto de filtro, como no DAX', () => {
  assert.equal(
    ev().evaluateExpression(
      "CALCULATE(LOOKUPVALUE(FERIADOS[Feriado], FERIADOS[Data], DATE(2026, 12, 25)), FERIADOS[Feriado] = \"Independência\")",
    ),
    'Natal',
  );
});

// ---------------------------------------------------------------------------
// SELECTEDVALUE
// ---------------------------------------------------------------------------

test('SELECTEDVALUE só devolve valor quando o contexto deixou exatamente um', () => {
  const e = ev();
  assert.equal(e.evaluateExpression("SELECTEDVALUE('VENDAS'[Equipe])"), null, '2 equipes visíveis');
  assert.equal(
    e.evaluateExpression("CALCULATE(SELECTEDVALUE('VENDAS'[Equipe]), 'VENDAS'[Ano] = 2025)"),
    'A',
  );
  assert.equal(
    e.evaluateExpression("SELECTEDVALUE('VENDAS'[Equipe], \"várias\")"),
    'várias',
    'com mais de um valor vem o alternativo, não o primeiro',
  );
});
