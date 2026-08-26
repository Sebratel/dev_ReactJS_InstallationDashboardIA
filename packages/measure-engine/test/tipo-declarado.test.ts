// O tipo declarado de uma coluna calculada vale na hora de materializar.
//
// **É a correção do ACHADOS.md #31, e o cuidado está em onde ela mora.**
// `'PROTOCOLOS GERAL'[CONTAGEM]` é a expressão DAX `"1"` — texto — declarada
// `int64`, e `SUM` sobre ela soma no relatório. A leitura errada seria "SUM converte
// texto": aí qualquer texto que chegasse a qualquer agregação viraria número, e numa
// base `pt-BR` isso é a porta para `"1.234"` virar 1,234 — mil vezes menor, sem
// nada avisar.
//
// A leitura certa é a do Power BI: a expressão produz um valor e **a coluna o
// armazena no tipo em que foi declarada**. A conversão é da coluna, não da soma.
//
// Medido na base: das 49 colunas calculadas, só **3** declaram tipo, e só **uma**
// devolve texto onde declarou número. O raio de alcance desta regra é uma coluna.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn } from '../../semantic-model/src/types.ts';
import { Dataset } from '../src/dataset.ts';
import { Evaluator } from '../src/evaluator.ts';
import { DaxEvalError, makeDate } from '../src/value.ts';

const AGORA = makeDate(2026, 8, 7);

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

/** Uma tabela com uma coluna física e uma calculada, cujo tipo e DAX variam. */
function montar(tipo: string | null, dax: string) {
  const model = new SemanticModel();
  model.addTable({
    id: 'os', name: 'OS', queryRef: null,
    columns: [col('VALOR'), col('C', { type: tipo, calculated: true, dax })],
  });
  const dataset = new Dataset();
  dataset.addTable('OS', [{ VALOR: 10 }, { VALOR: 20 }]);
  return new Evaluator({ model, dataset, now: AGORA });
}

// ---------------------------------------------------------------------------
// O caso do relatório
// ---------------------------------------------------------------------------

/** É `'PROTOCOLOS GERAL'[CONTAGEM]` inteiro: DAX `"1"`, declarada `int64`. */
test('coluna declarada int64 com DAX de texto vira número, e SUM soma', () => {
  const ev = montar('int64', '"1"');
  assert.equal(ev.evaluateExpression("SUM('OS'[C])"), 2);
  assert.equal(ev.evaluateExpression("COUNTROWS('OS')"), 2);
});

/** Sem a regra, é o erro que travava duas tabelas — fica aqui como contraste. */
test('a mesma coluna sem tipo declarado continua texto, e SUM erra alto', () => {
  const ev = montar(null, '"1"');
  assert.throws(() => ev.evaluateExpression("SUM('OS'[C])"), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /esperava número e recebeu o texto "1"/);
    return true;
  });
});

test('double e decimal também convertem', () => {
  assert.equal(montar('double', '"1.5"').evaluateExpression("SUM('OS'[C])"), 3);
  assert.equal(montar('decimal', '"-2"').evaluateExpression("SUM('OS'[C])"), -4);
});

// ---------------------------------------------------------------------------
// O que a regra NÃO faz — e é onde ela ganha o direito de existir
// ---------------------------------------------------------------------------

/**
 * **O separador de milhar erra alto.** `"1.234"` é mil duzentos e trinta e quatro
 * para quem escreveu numa base `pt-BR` e um vírgula duzentos e trinta e quatro para
 * o `Number()` do JavaScript. As duas leituras são defensáveis, a diferença é de
 * mil vezes, e nenhuma delas pode ser escolhida em silêncio.
 */
test('texto com separador de milhar erra alto em vez de escolher uma leitura', () => {
  for (const texto of ['1.234,56', '1,234.56', '1 234', 'R$ 10']) {
    const ev = montar('int64', `"${texto}"`);
    assert.throws(() => ev.evaluateExpression("SUM('OS'[C])"), (e: unknown) => {
      assert.ok(e instanceof DaxEvalError, texto);
      assert.match(e.message, /não é um literal numérico/);
      return true;
    }, texto);
  }
});

test('texto que não é número nenhum erra alto nomeando a coluna', () => {
  const ev = montar('int64', '"abc"');
  assert.throws(() => ev.evaluateExpression("SUM('OS'[C])"), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /'OS'\[C\] é declarada int64/);
    assert.match(e.message, /"abc"/);
    return true;
  });
});

/**
 * A conversão é **da coluna**, não da agregação. Uma expressão solta que soma texto
 * continua errando alto — que é o comportamento do DAX e o que impede a regra de
 * virar uma conversão implícita geral.
 */
test('SUM continua sem converter texto que não veio de coluna tipada', () => {
  const ev = montar('int64', '"1"');
  assert.throws(() => ev.evaluateExpression('1 + "2"'), /esperava número e recebeu o texto/);
});

test('coluna declarada texto não é tocada', () => {
  const ev = montar('string', '"1"');
  assert.equal(ev.evaluateExpression("CONCATENATEX('OS', 'OS'[C], \",\")"), '1,1');
});

/** BLANK continua BLANK: coluna numérica vazia não vira zero na materialização. */
test('BLANK atravessa a conversão sem virar zero', () => {
  const ev = montar('int64', 'BLANK()');
  assert.equal(ev.evaluateExpression("COUNTA('OS'[C])"), 0);
});
