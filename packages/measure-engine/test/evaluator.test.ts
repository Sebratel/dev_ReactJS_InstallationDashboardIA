// O avaliador sobre um modelo pequeno e controlado.
//
// Modelo de teste em vez do real de propósito: aqui cada resultado esperado é
// calculável à mão, então um teste que falha aponta a regra errada. A cobertura
// contra as 121 expressões reais é medida em cobertura.test.ts.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn } from '../../semantic-model/src/types.ts';
import { Dataset, type Row } from '../src/dataset.ts';
import { Evaluator } from '../src/evaluator.ts';
import { DaxEvalError, makeDate } from '../src/value.ts';

const HOJE = makeDate(2026, 8, 4); // terça-feira

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

/**
 * Modelo mínimo: uma tabela de vendas com uma coluna calculada, um calendário
 * com a regra de peso de dia útil, e medidas que dependem umas das outras.
 */
function montar(vendas: Row[] = VENDAS, datas: Row[] = DATAS) {
  const model = new SemanticModel();
  model.addTable({
    id: 'vendas',
    name: 'VENDAS',
    queryRef: null,
    columns: [
      col('Produto'),
      col('Valor'),
      col('Qtd'),
      col('DOBRO', { calculated: true, dax: "'VENDAS'[Valor] * 2" }),
    ],
  });
  model.addTable({
    id: 'cal',
    name: 'CAL',
    queryRef: null,
    columns: [
      col('Data', { type: 'dateTime' }),
      col('DIA_SEMANA', { calculated: true, dax: `FORMAT('CAL'[Data], "dddd")` }),
      col('PESO', {
        calculated: true,
        // A mesma forma da regra real de 'CALENDARIO CRIADO'[PESO].
        dax: `
VAR d = WEEKDAY('CAL'[Data], 2)
RETURN IF(d = 7, 0, IF(d = 6, 0.5, 1))`,
      }),
    ],
  });

  model.addMeasure({ name: 'Total', table: 'VENDAS', format: null, displayFolder: null, dax: "SUM('VENDAS'[Valor])" });
  model.addMeasure({ name: 'Itens', table: 'VENDAS', format: null, displayFolder: null, dax: "COUNTROWS('VENDAS')" });
  model.addMeasure({
    name: 'Ticket', table: 'VENDAS', format: null, displayFolder: null,
    dax: 'DIVIDE([Total], [Itens])',
  });
  model.addMeasure({ name: 'Ciclo A', table: 'VENDAS', format: null, displayFolder: null, dax: '[Ciclo B] + 1' });
  model.addMeasure({ name: 'Ciclo B', table: 'VENDAS', format: null, displayFolder: null, dax: '[Ciclo A] + 1' });

  const dataset = new Dataset();
  dataset.addTable('VENDAS', vendas);
  dataset.addTable('CAL', datas);
  return new Evaluator({ model, dataset, now: HOJE });
}

const VENDAS: Row[] = [
  { Produto: 'Fibra', Valor: 100, Qtd: 2 },
  { Produto: 'fibra', Valor: 50, Qtd: null },
  { Produto: 'Voz', Valor: null, Qtd: 1 },
];

const DATAS: Row[] = [
  { Data: makeDate(2026, 8, 3) }, // segunda
  { Data: makeDate(2026, 8, 8) }, // sábado
  { Data: makeDate(2026, 8, 9) }, // domingo
];

// ---------------------------------------------------------------------------

test('escalar literal e aritmética', () => {
  const ev = montar();
  assert.equal(ev.evaluateExpression('3000'), 3000);
  assert.equal(ev.evaluateExpression('2 + 3 * 4'), 14);
  assert.equal(ev.evaluateExpression('-2 ^ 2'), 4, 'sinal liga mais forte que a potência');
});

test('SUM ignora BLANK; agregação sobre nada devolve BLANK, não 0', () => {
  const ev = montar();
  assert.equal(ev.evaluateExpression("SUM('VENDAS'[Valor])"), 150);

  const vazio = montar([], []);
  assert.equal(vazio.evaluateExpression("SUM('VENDAS'[Valor])"), null);
  assert.equal(vazio.evaluateExpression("COUNTROWS('VENDAS')"), null);
  assert.equal(vazio.evaluateExpression("COUNT('VENDAS'[Valor])"), null);
});

test('COUNT conta não-vazios; COUNTROWS conta linhas', () => {
  const ev = montar();
  assert.equal(ev.evaluateExpression("COUNT('VENDAS'[Qtd])"), 2, 'uma Qtd é BLANK');
  assert.equal(ev.evaluateExpression("COUNTROWS('VENDAS')"), 3);
});

test('DISTINCTCOUNT usa a mesma equivalência da comparação: "Fibra" e "fibra" são um', () => {
  const ev = montar();
  assert.equal(ev.evaluateExpression("DISTINCTCOUNT('VENDAS'[Produto])"), 2);
  // E conta BLANK como um valor distinto — é DISTINCTCOUNTNOBLANK que ignora.
  assert.equal(ev.evaluateExpression("DISTINCTCOUNT('VENDAS'[Qtd])"), 3);
});

test('MIN/MAX agregam uma coluna e comparam dois escalares', () => {
  const ev = montar();
  assert.equal(ev.evaluateExpression("MIN('VENDAS'[Valor])"), 50);
  assert.equal(ev.evaluateExpression("MAX('VENDAS'[Valor])"), 100);
  assert.equal(ev.evaluateExpression('MIN(7, 3)'), 3);
  assert.equal(ev.evaluateExpression('MAX(7, 3)'), 7);
});

test('DIVIDE protege o zero; o operador `/` não — são funções diferentes de propósito', () => {
  const ev = montar();
  assert.equal(ev.evaluateExpression('DIVIDE(10, 0)'), null);
  assert.equal(ev.evaluateExpression('DIVIDE(10, 0, -1)'), -1);
  assert.equal(ev.evaluateExpression('DIVIDE(10, BLANK())'), null);
  assert.equal(ev.evaluateExpression('DIVIDE(10, 4)'), 2.5);
  assert.equal(ev.evaluateExpression('10 / 0'), Infinity);
});

test('IF, SWITCH com valor e SWITCH(TRUE()) — o CASE WHEN do DAX', () => {
  const ev = montar();
  assert.equal(ev.evaluateExpression('IF(1 = 1, "sim", "não")'), 'sim');
  assert.equal(ev.evaluateExpression('IF(1 = 2, "sim")'), null, 'IF sem ELSE é BLANK');
  assert.equal(ev.evaluateExpression('SWITCH(2, 1, "um", 2, "dois", "outro")'), 'dois');
  assert.equal(ev.evaluateExpression('SWITCH(9, 1, "um", 2, "dois", "outro")'), 'outro');
  assert.equal(ev.evaluateExpression('SWITCH(9, 1, "um")'), null, 'sem casar e sem ELSE é BLANK');
  assert.equal(
    ev.evaluateExpression('SWITCH(TRUE(), 5 > 9, "a", 5 > 3, "b", "c")'),
    'b',
  );
});

test('VAR é escopo acumulativo: cada VAR vê as anteriores', () => {
  const ev = montar();
  assert.equal(
    ev.evaluateExpression('VAR a = 2 VAR b = a * 3 RETURN a + b'),
    8,
  );
});

test('`&` concatena convertendo pela cultura do modelo', () => {
  const ev = montar();
  assert.equal(ev.evaluateExpression('2 & "d " & 3 & "h"'), '2d 3h');
  assert.equal(ev.evaluateExpression('1.5 & ""'), '1,5', 'pt-BR usa vírgula');
  assert.equal(ev.evaluateExpression('BLANK() & "x"'), 'x');
});

test('MOD tem o sinal do divisor e INT difere de TRUNC nos negativos', () => {
  const ev = montar();
  assert.equal(ev.evaluateExpression('MOD(-3, 2)'), 1, 'não -1 como o % do JS');
  assert.equal(ev.evaluateExpression('MOD(100, 60)'), 40);
  assert.equal(ev.evaluateExpression('QUOTIENT(100, 60)'), 1);
  assert.equal(ev.evaluateExpression('INT(-2.5)'), -3);
  assert.equal(ev.evaluateExpression('TRUNC(-2.5)'), -2);
  assert.equal(ev.evaluateExpression('ROUND(-2.5, 0)'), -3, 'meio para longe do zero');
  assert.equal(ev.evaluateExpression('ROUND(2.345, 2)'), 2.35);
});

test('TODAY é injetado — teste de paridade não pode mudar de resposta à meia-noite', () => {
  const ev = montar();
  assert.equal((ev.evaluateExpression('TODAY()') as Date).getTime(), HOJE.getTime());
  assert.equal(ev.evaluateExpression('YEAR(TODAY())'), 2026);
  assert.equal(ev.evaluateExpression('MONTH(TODAY())'), 8);
  assert.equal(ev.evaluateExpression('DAY(TODAY())'), 4);
  assert.equal(ev.evaluateExpression('WEEKDAY(TODAY(), 2)'), 2, 'terça = 2 no tipo 2');
  assert.equal(ev.evaluateExpression('TODAY() + 7 - TODAY()'), 7, 'data é número de série');
});

test('FORMAT("dddd") sai em português — sem isso o SWITCH do PESO nunca casa', () => {
  const ev = montar();
  assert.equal(ev.evaluateExpression('FORMAT(DATE(2026, 8, 9), "dddd")'), 'domingo');
  assert.equal(ev.evaluateExpression('FORMAT(DATE(2026, 8, 8), "dddd")'), 'sábado');
  assert.equal(ev.evaluateExpression('FORMAT(3.7, "0")'), '4');
  assert.throws(() => ev.evaluateExpression('FORMAT(TODAY(), "MMMM")'), /não implementado/);
});

test('coluna calculada é avaliada em contexto de linha e memorizada', () => {
  const ev = montar();
  // 'VENDAS'[DOBRO] não existe nos dados: vem do DAX, linha a linha.
  assert.deepEqual(ev.columnValues('VENDAS', 'DOBRO'), [200, 100, 0]);
  assert.equal(ev.evaluateExpression("SUM('VENDAS'[DOBRO])"), 300);
});

test('a regra de peso de dia útil roda sobre a coluna calculada de FORMAT', () => {
  const ev = montar();
  assert.deepEqual(ev.columnValues('CAL', 'DIA_SEMANA'), ['segunda-feira', 'sábado', 'domingo']);
  assert.deepEqual(ev.columnValues('CAL', 'PESO'), [1, 0.5, 0]);
  assert.equal(ev.evaluateExpression("SUM('CAL'[PESO])"), 1.5);
});

test('medida que depende de medida', () => {
  const ev = montar();
  assert.equal(ev.measure('Total'), 150);
  assert.equal(ev.measure('Itens'), 3);
  assert.equal(ev.measure('Ticket'), 50);
});

test('ciclo entre medidas é detectado, não estoura a pilha', () => {
  const ev = montar();
  assert.throws(() => ev.measure('Ciclo A'), /Ciclo entre medidas/);
});

test('IN com construtor de tabela usa equivalência de `=`', () => {
  const ev = montar();
  assert.equal(ev.evaluateExpression('2 IN {1, 2, 3}'), true);
  assert.equal(ev.evaluateExpression('9 IN {1, 2, 3}'), false);
  assert.equal(
    ev.evaluateExpression('DATE(2026, 6, 4) IN {DATE(2026, 1, 1), DATE(2026, 6, 4)}'),
    true,
  );
});

test('.[Dia] da hierarquia de datas é DAY, não a data — lido do LocalDateTable do PBIP', () => {
  const ev = montar();
  // As três datas são 3, 8 e 9 de agosto: dias distintos 3.
  assert.equal(ev.evaluateExpression("DISTINCTCOUNT('CAL'[Data].[Dia])"), 3);
  assert.equal(ev.evaluateExpression("MAX('CAL'[Data].[Dia])"), 9);
  assert.equal(ev.evaluateExpression("MIN('CAL'[Data].[Ano])"), 2026);
});

// ---------------------------------------------------------------------------
// Falhar alto
// ---------------------------------------------------------------------------

test('função não implementada erra com o nome dela', () => {
  // Toda função que a base usa já está implementada (ver avaliador-cobertura.test),
  // então só um nome inventado exercita este caminho de erro.
  const ev = montar();
  assert.throws(() => ev.evaluateExpression('ALGUMACOISA(1)'), /ALGUMACOISA/);
  assert.throws(() => ev.evaluateExpression('ALGUMACOISA(1)'), /não implementada/i);
});

test('coluna com vários valores usada como escalar erra em vez de escolher um', () => {
  const ev = montar();
  assert.throws(
    () => ev.evaluateExpression("'VENDAS'[Valor] + 1"),
    /valores distintos no contexto/,
  );
});

test('referência inexistente erra alto', () => {
  const ev = montar();
  assert.throws(() => ev.evaluateExpression("SUM('VENDAS'[NaoExiste])"), /não existe no modelo/);
  assert.throws(() => ev.evaluateExpression("SUM('NAOEXISTE'[X])"), DaxEvalError);
  assert.throws(() => ev.evaluateExpression('[Medida Inventada]'), /não resolve/);
});

test('comparar coluna de texto DD/MM/YYYY com data erra — não ordena por dia calado', () => {
  const model = new SemanticModel();
  model.addTable({
    id: 't', name: 'T', queryRef: null,
    columns: [col('DataTexto'), col('Vence', { calculated: true, dax: "IF('T'[DataTexto] <= TODAY(), 1, 0)" })],
  });
  const dataset = new Dataset();
  dataset.addTable('T', [{ DataTexto: '04/08/2026' }]);
  const ev = new Evaluator({ model, dataset, now: HOJE });
  assert.throws(() => ev.columnValues('T', 'Vence'), /texto e número|DD\/MM\/YYYY/);
});
