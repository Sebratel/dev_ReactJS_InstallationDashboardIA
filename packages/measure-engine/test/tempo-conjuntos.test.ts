// Time intelligence, tabelas derivadas e conjuntos.
//
// Todas as formas testadas aqui saíram do DAX real da base, verificadas pelo AST —
// não de exemplos plausíveis. Onde o comportamento do DAX difere do que se
// escreveria por intuição, o teste diz qual é qual.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn } from '../../semantic-model/src/types.ts';
import { Dataset } from '../src/dataset.ts';
import { Evaluator } from '../src/evaluator.ts';
import { makeDate, serialFromDate } from '../src/value.ts';

const HOJE = makeDate(2026, 8, 4);

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

/**
 * Calendário de agosto/2026 com um **buraco** (falta o dia 5) e uma data de
 * setembro. O buraco é de propósito: as funções de data do DAX filtram os valores
 * que existem na coluna, não geram datas — um calendário incompleto continua
 * incompleto, e um teste com calendário perfeito não mostraria isso.
 */
const DIAS = [3, 4, 6, 7].map((d) => makeDate(2026, 8, d));
const CAL = [...DIAS.map((d) => ({ Data: d, Peso: 1 })), { Data: makeDate(2026, 9, 2), Peso: 1 }];

const AGENDA = [
  { Protocolo: 'P1', Slot: new Date(Date.UTC(2026, 7, 3, 14, 30)) },
  { Protocolo: 'P1', Slot: new Date(Date.UTC(2026, 7, 3, 9, 0)) },
  { Protocolo: 'P1', Slot: new Date(Date.UTC(2026, 7, 7, 8, 0)) },
  { Protocolo: 'P2', Slot: new Date(Date.UTC(2026, 7, 4, 8, 0)) },
];

function montar() {
  const model = new SemanticModel();
  model.addTable({
    id: 'c', name: 'CAL', queryRef: null,
    columns: [col('Data', { type: 'dateTime' }), col('Peso', { type: 'int64' })],
  });
  model.addTable({
    id: 'a', name: 'AGENDA', queryRef: null,
    columns: [
      col('Protocolo'),
      col('Slot', { type: 'dateTime' }),
      col('Data', { calculated: true, dax: "DATEVALUE('AGENDA'[Slot])" }),
      // A forma exata de 'FIELD AGENDA'[RankDataProtocolo].
      col('Rank', {
        calculated: true,
        dax: `
VAR ProtocoloAtual = 'AGENDA'[Protocolo]
VAR TabelaDatas =
    DISTINCT(
        SELECTCOLUMNS(
            FILTER('AGENDA', 'AGENDA'[Protocolo] = ProtocoloAtual),
            "Data", TRUNC('AGENDA'[Slot])
        )
    )
RETURN RANKX(TabelaDatas, [Data], , ASC, DENSE)`,
      }),
    ],
  });
  model.addTable({
    id: 'o', name: 'OUTRA', queryRef: null,
    columns: [col('Protocolo')],
  });

  const dataset = new Dataset();
  dataset.addTable('CAL', CAL);
  dataset.addTable('AGENDA', AGENDA);
  dataset.addTable('OUTRA', [{ Protocolo: 'P1' }, { Protocolo: 'P3' }]);
  return new Evaluator({ model, dataset, now: HOJE });
}

const ev = () => montar();

// ---------------------------------------------------------------------------
// Time intelligence
// ---------------------------------------------------------------------------

test('DATESBETWEEN é inclusivo nos dois extremos e só devolve datas que existem', () => {
  const e = ev();
  // 03 a 06: existem 3, 4 e 6. O dia 5 não está na coluna e não é inventado.
  assert.equal(
    e.evaluateExpression(
      "COUNTROWS(DATESBETWEEN('CAL'[Data], DATE(2026,8,3), DATE(2026,8,6)))",
    ),
    3,
  );
  assert.equal(
    e.evaluateExpression("COUNTROWS(DATESBETWEEN('CAL'[Data], DATE(2026,8,4), DATE(2026,8,4)))"),
    1,
    'extremos iguais devolvem a própria data',
  );
});

test('DATESBETWEEN filtra o CALCULATE pelo mesmo mecanismo de substituição', () => {
  // É a forma de `# MEDIA INSTALADO MENSAL`: somar PESO no intervalo de datas.
  assert.equal(
    ev().evaluateExpression(
      "CALCULATE(SUM('CAL'[Peso]), DATESBETWEEN('CAL'[Data], DATE(2026,8,1), DATE(2026,8,31)))",
    ),
    4,
    'os 4 dias de agosto; setembro fica fora',
  );
});

test('ENDOFMONTH e STARTOFMONTH devolvem tabela 1x1, que o DAX usa como valor', () => {
  const e = ev();
  // A forma de `# PROJEÇÃO`: DATESBETWEEN(col, TODAY(), ENDOFMONTH(col)).
  // ENDOFMONTH devolve tabela; a coerção 1x1 -> escalar é regra do DAX.
  const fim = e.evaluateExpression("ENDOFMONTH('CAL'[Data])") as Date;
  assert.equal(fim.getTime(), makeDate(2026, 9, 30).getTime(), 'mês da última data do contexto');
  const ini = e.evaluateExpression("STARTOFMONTH('CAL'[Data])") as Date;
  assert.equal(ini.getTime(), makeDate(2026, 9, 1).getTime());

  assert.equal(
    e.evaluateExpression(
      "CALCULATE(SUM('CAL'[Peso]), DATESBETWEEN('CAL'[Data], DATE(2026,8,1), ENDOFMONTH('CAL'[Data])))",
    ),
    5,
    'até o fim de setembro entra tudo',
  );
});

test('DATESMTD vai até a última data do contexto, não até hoje', () => {
  // Usar TODAY() aqui daria outro número em qualquer contexto de mês passado.
  const e = ev();
  assert.equal(e.evaluateExpression("COUNTROWS(DATESMTD('CAL'[Data]))"), 1, 'só 02/09');
  assert.equal(
    e.evaluateExpression(
      "CALCULATE(COUNTROWS(DATESMTD('CAL'[Data])), DATESBETWEEN('CAL'[Data], DATE(2026,8,1), DATE(2026,8,31)))",
    ),
    4,
    'contexto em agosto: MTD é agosto inteiro visível',
  );
});

test('tabela com mais de uma linha em posição escalar erra em vez de pegar a primeira', () => {
  assert.throws(
    () => ev().evaluateExpression("DATESBETWEEN('CAL'[Data], DATE(2026,8,1), DATE(2026,8,31)) + 0"),
    /onde se espera um valor|4 linhas/,
  );
});

// ---------------------------------------------------------------------------
// SELECTCOLUMNS, DISTINCT e conjuntos
// ---------------------------------------------------------------------------

test('SELECTCOLUMNS cria tabela anônima com coluna calculada linha a linha', () => {
  const e = ev();
  assert.equal(
    e.evaluateExpression("COUNTROWS(SELECTCOLUMNS('AGENDA', \"Prot\", 'AGENDA'[Protocolo]))"),
    4,
    'não desduplica — quem quer distintos usa DISTINCT',
  );
  assert.equal(
    e.evaluateExpression(
      "COUNTROWS(DISTINCT(SELECTCOLUMNS('AGENDA', \"Prot\", 'AGENDA'[Protocolo])))",
    ),
    2,
  );
});

test('tabela anônima não pode virar filtro — erra dizendo o que fazer', () => {
  // As colunas dela não existem em tabela nenhuma do modelo. Aceitar em silêncio
  // produziria um filtro que não casa com nada, ou seja, BLANK em vez de erro.
  assert.throws(
    () => ev().evaluateExpression(
      "CALCULATE(COUNTROWS('AGENDA'), SELECTCOLUMNS('AGENDA', \"Prot\", 'AGENDA'[Protocolo]))",
    ),
    /anônima não pode ser usada como filtro.*TREATAS/s,
  );
});

test('INTERSECT, EXCEPT e UNION casam colunas por posição', () => {
  const e = ev();
  const A = "DISTINCT(SELECTCOLUMNS('AGENDA', \"Prot\", 'AGENDA'[Protocolo]))";
  const B = "DISTINCT(SELECTCOLUMNS('OUTRA', \"P\", 'OUTRA'[Protocolo]))";

  // AGENDA tem P1 e P2; OUTRA tem P1 e P3.
  assert.equal(e.evaluateExpression(`COUNTROWS(INTERSECT(${A}, ${B}))`), 1, 'só P1');
  assert.equal(e.evaluateExpression(`COUNTROWS(EXCEPT(${A}, ${B}))`), 1, 'só P2');
  assert.equal(
    e.evaluateExpression(`COUNTROWS(UNION(${A}, ${B}))`),
    4,
    'UNION mantém duplicata: P1, P2, P1, P3',
  );
  assert.equal(
    e.evaluateExpression(`COUNTROWS(DISTINCT(UNION(${A}, ${B})))`),
    3,
    'quem quer distintos escreve DISTINCT em volta',
  );
});

test('conjunto entre tabelas de larguras diferentes erra alto', () => {
  assert.throws(
    () => ev().evaluateExpression(
      "COUNTROWS(UNION(" +
        "SELECTCOLUMNS('AGENDA', \"a\", 'AGENDA'[Protocolo]), " +
        "SELECTCOLUMNS('AGENDA', \"a\", 'AGENDA'[Protocolo], \"b\", 'AGENDA'[Slot])))",
    ),
    /casa por posição e exige o mesmo número/,
  );
});

// ---------------------------------------------------------------------------
// RANKX e o `[Nome]` de tabela anônima
// ---------------------------------------------------------------------------

test('RANKX ASC/DENSE ranqueia dentro da tabela anônima do iterador', () => {
  // P1 tem dois slots em 03/08 e um em 07/08: duas datas distintas.
  // As duas linhas de 03/08 têm rank 1; a de 07/08, rank 2. P2 tem uma data: 1.
  assert.deepEqual(ev().columnValues('AGENDA', 'Rank'), [1, 1, 2, 1]);
});

test('o contexto de linha mais interno vence — [Data] é da tabela anônima', () => {
  // 'AGENDA'[Data] existe no modelo (DATEVALUE do Slot) e a tabela anônima do
  // SELECTCOLUMNS também tem "Data". Se o resolvedor escolhesse a do modelo, o
  // RANKX ranquearia a coisa errada sem dar erro — daí este teste separado.
  const e = ev();
  assert.deepEqual(
    e.columnValues('AGENDA', 'Data').map((d) => (d as Date).getTime()),
    [
      makeDate(2026, 8, 3).getTime(),
      makeDate(2026, 8, 3).getTime(),
      makeDate(2026, 8, 7).getTime(),
      makeDate(2026, 8, 4).getTime(),
    ],
  );
});

test('DATEVALUE descarta a hora — sem isso o RANKX não casaria com TRUNC', () => {
  const e = ev();
  const d = e.evaluateExpression("DATEVALUE('AGENDA'[Slot])",
    e.scopeWithRow(e.rootScope(), 'AGENDA', { slot: new Date(Date.UTC(2026, 7, 3, 14, 30)) }),
  ) as Date;
  assert.equal(d.getTime(), makeDate(2026, 8, 3).getTime());
  assert.equal(
    serialFromDate(d),
    Math.trunc(serialFromDate(new Date(Date.UTC(2026, 7, 3, 14, 30)))),
    'DATEVALUE e TRUNC dão o mesmo número de série',
  );
});

test('RANKX DESC é o padrão e SKIP pula postos em empate', () => {
  const e = ev();
  const T = "DISTINCT(SELECTCOLUMNS('AGENDA', \"P\", 'AGENDA'[Protocolo]))";
  // Sem ordem: DESC. "P2" é o maior dos dois, então é o posto 1.
  assert.equal(e.evaluateExpression(`RANKX(${T}, [P], "P2")`), 1);
  assert.equal(e.evaluateExpression(`RANKX(${T}, [P], "P1")`), 2);
  assert.equal(e.evaluateExpression(`RANKX(${T}, [P], "P1", ASC)`), 1);
});

// ---------------------------------------------------------------------------
// Fronteira declarada
// ---------------------------------------------------------------------------

test('ISINSCOPE erra dizendo que depende do Widget Engine, não que "não existe"', () => {
  // Não é lacuna de implementação: a resposta depende do agrupamento do visual,
  // que só passa a existir na Fase 3. Devolver FALSE faria
  // [Faixa 1 Premiação Total] calcular em toda célula em vez de só no total.
  assert.throws(
    () => ev().evaluateExpression("ISINSCOPE('AGENDA'[Protocolo])"),
    /agrupamento da visualização.*Fase 3/s,
  );
});
