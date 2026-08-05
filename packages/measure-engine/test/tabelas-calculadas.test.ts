// Tabelas calculadas: as duas funções novas, a materialização e o que ela recusa.
//
// Os modelos aqui são de mão e mínimos — o teste contra as 7 tabelas reais está em
// `avaliador-cobertura.test.ts`. A divisão é a de sempre neste projeto: ali se mede
// a base, aqui se fixa a **regra**, incluindo as regras que só aparecem em caso que
// a base não tem hoje (ciclo, coluna que sobra, tabela nomeada em ADDCOLUMNS).

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn, ModelTable } from '../../semantic-model/src/types.ts';
import {
  calculatedTableDependencies,
  calculatedTableOrder,
  materializeCalculatedTable,
  materializeCalculatedTables,
} from '../src/calculated.ts';
import { Dataset, type Row } from '../src/dataset.ts';
import { Evaluator } from '../src/evaluator.ts';
import { makeDate, serialFromDate } from '../src/value.ts';

const HOJE = makeDate(2026, 8, 4);

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

function tab(name: string, columns: ModelColumn[], extra: Partial<ModelTable> = {}): ModelTable {
  return { id: name.toLowerCase(), name, queryRef: 'q', tableDax: null, columns, ...extra };
}

/** Modelo + dataset com uma tabela de fatos e as calculadas que o teste pedir. */
function monta(fatos: Row[], calculadas: ModelTable[], colunasDeFato = ['Data', 'Protocolo']) {
  const model = new SemanticModel();
  model.addTable(tab('FATOS', colunasDeFato.map((c) => col(c, { type: c === 'Data' ? 'dateTime' : 'string' }))));
  for (const c of calculadas) model.addTable(c);
  const dataset = new Dataset();
  dataset.addTable('FATOS', fatos);
  const ev = new Evaluator({ model, dataset, now: HOJE });
  return { model, dataset, ev };
}

const FATOS: Row[] = [
  { Data: makeDate(2026, 1, 10), Protocolo: 'P1' },
  { Data: makeDate(2026, 1, 12), Protocolo: 'P2' },
  { Data: makeDate(2026, 3, 5), Protocolo: 'P1' },
];

// ---------------------------------------------------------------------------
// CALENDAR
// ---------------------------------------------------------------------------

test('CALENDAR gera um dia por linha, inclusive nos dois extremos', () => {
  const { ev } = monta(FATOS, []);
  const tv = ev.evaluateTableExpression('CALENDAR(DATE(2026,1,1), DATE(2026,1,31))');
  assert.equal(tv.rows.length, 31);
  assert.deepEqual([...tv.columns], ['date']);
  assert.deepEqual(tv.rows[0]!['date'], makeDate(2026, 1, 1));
  assert.deepEqual(tv.rows[30]!['date'], makeDate(2026, 1, 31));
});

test('CALENDAR de um dia só devolve uma linha', () => {
  const { ev } = monta(FATOS, []);
  const tv = ev.evaluateTableExpression('CALENDAR(DATE(2026,2,3), DATE(2026,2,3))');
  assert.equal(tv.rows.length, 1);
});

test('CALENDAR atravessa o fim do ano e conta o dia bissexto', () => {
  const { ev } = monta(FATOS, []);
  // 2024 é bissexto: 366 dias.
  assert.equal(ev.evaluateTableExpression('CALENDAR(DATE(2024,1,1), DATE(2024,12,31))').rows.length, 366);
});

/**
 * O caso que motivou o desvio deliberado do Power BI. Lá BLANK vale 0, que é
 * 30/12/1899, e a tabela sairia com dezenas de milhares de linhas sem reclamar.
 */
test('CALENDAR com extremo BLANK erra alto em vez de gerar 46 mil dias', () => {
  const { ev } = monta(FATOS, []);
  assert.throws(
    () => ev.evaluateTableExpression('CALENDAR(BLANK(), DATE(2026,12,31))'),
    /BLANK.*1899/s,
  );
});

test('CALENDAR invertido é erro, não tabela vazia', () => {
  const { ev } = monta(FATOS, []);
  assert.throws(
    () => ev.evaluateTableExpression('CALENDAR(DATE(2026,12,31), DATE(2026,1,1))'),
    /depois do fim/,
  );
});

/** A fonte pode ser `dateTime`: resto de hora deslocaria todos os dias gerados. */
test('CALENDAR trunca a hora dos extremos', () => {
  const { ev } = monta(FATOS, []);
  const tv = ev.evaluateTableExpression(
    'CALENDAR(DATE(2026,1,1) + TIME(23,30,0), DATE(2026,1,3) + TIME(1,0,0))',
  );
  assert.equal(tv.rows.length, 3);
  assert.deepEqual(tv.rows[0]!['date'], makeDate(2026, 1, 1));
});

// ---------------------------------------------------------------------------
// ADDCOLUMNS
// ---------------------------------------------------------------------------

test('ADDCOLUMNS mantém as colunas da origem e acrescenta as novas', () => {
  const { ev } = monta(FATOS, []);
  const tv = ev.evaluateTableExpression(
    'ADDCOLUMNS(SELECTCOLUMNS(FATOS, "p", FATOS[Protocolo]), "dobro", 2, "tres", 3)',
  );
  assert.deepEqual([...tv.columns], ['p', 'dobro', 'tres']);
  assert.equal(tv.rows.length, 3);
  assert.equal(tv.rows[0]!['p'], 'P1');
  assert.equal(tv.rows[0]!['dobro'], 2);
});

/** A coluna nova é avaliada no contexto de linha da origem. */
test('ADDCOLUMNS vê a linha da origem', () => {
  const { ev } = monta(FATOS, []);
  const tv = ev.evaluateTableExpression(
    'ADDCOLUMNS(SELECTCOLUMNS(FATOS, "p", FATOS[Protocolo]), "eco", [p] & "!")',
  );
  assert.deepEqual(tv.rows.map((r) => r['eco']), ['P1!', 'P2!', 'P1!']);
});

/**
 * Em DAX uma coluna acrescentada não vê as outras acrescentadas no mesmo
 * `ADDCOLUMNS`. Aqui isso aparece como erro de nome que não resolve — e é melhor
 * que resolver para a coluna errada.
 */
test('ADDCOLUMNS: uma coluna nova não vê a outra', () => {
  const { ev } = monta(FATOS, []);
  assert.throws(
    () => ev.evaluateTableExpression(
      'ADDCOLUMNS(SELECTCOLUMNS(FATOS, "p", FATOS[Protocolo]), "a", 1, "b", [a] + 1)',
    ),
    /\[a\] não resolve/,
  );
});

test('ADDCOLUMNS recusa sobrescrever coluna que já existe', () => {
  const { ev } = monta(FATOS, []);
  assert.throws(
    () => ev.evaluateTableExpression(
      'ADDCOLUMNS(SELECTCOLUMNS(FATOS, "p", FATOS[Protocolo]), "p", 1)',
    ),
    /já existe na origem/,
  );
});

/**
 * O limite declarado: coluna acrescentada não tem linhagem em DAX, e `TableValue`
 * não sabe dizer "estas colunas têm linhagem e aquelas não". Usar o resultado como
 * filtro restringiria por coluna inexistente no destino e zeraria a medida em
 * silêncio — daí recusar em vez de aceitar.
 */
test('ADDCOLUMNS sobre tabela nomeada é recusado, com o motivo', () => {
  const { ev } = monta(FATOS, []);
  assert.throws(
    () => ev.evaluateTableExpression('ADDCOLUMNS(FATOS, "x", 1)'),
    /linhagem/,
  );
});

// ---------------------------------------------------------------------------
// VAR ... RETURN <tabela>
// ---------------------------------------------------------------------------

/** É a forma de `Status Protocolo Dia`: o corpo do RETURN é a tabela. */
test('VAR ... RETURN devolve tabela quando o corpo é expressão de tabela', () => {
  const { ev } = monta(FATOS, []);
  const tv = ev.evaluateTableExpression(`
    VAR Base = SELECTCOLUMNS(FATOS, "p", FATOS[Protocolo])
    RETURN ADDCOLUMNS(Base, "n", 1)
  `);
  assert.deepEqual([...tv.columns], ['p', 'n']);
  assert.equal(tv.rows.length, 3);
});

/** `RETURN x` onde `x` é o próprio VAR: a forma é a do VAR, sem avaliar duas vezes. */
test('VAR de tabela devolvido direto continua sendo tabela', () => {
  const { ev } = monta(FATOS, []);
  const tv = ev.evaluateTableExpression(`
    VAR Base = DISTINCT(SELECTCOLUMNS(FATOS, "p", FATOS[Protocolo]))
    VAR Apelido = Base
    RETURN Apelido
  `);
  assert.equal(tv.rows.length, 2);
});

// ---------------------------------------------------------------------------
// Materialização
// ---------------------------------------------------------------------------

const CAL = tab('CAL', [col('Dia', { sourceColumn: '[Date]' })], {
  queryRef: null,
  tableDax: 'CALENDAR(MIN(FATOS[Data]), DATE(2026,1,15))',
});

test('materializar troca o nome da coluna do DAX pelo nome da spec', () => {
  const { dataset, ev } = monta(FATOS, [CAL]);
  const m = materializeCalculatedTable(ev, CAL);

  assert.equal(m.rowCount, 6); // 10/01 a 15/01
  assert.deepEqual([...m.columnMap], [['dia', 'date']]);
  assert.ok(dataset.hasPhysicalColumn('CAL', 'Dia'));
  assert.deepEqual(dataset.rows('CAL')[0]!['dia'], makeDate(2026, 1, 10));
});

test('materializar duas vezes é erro, não sobrescrita', () => {
  const { ev } = monta(FATOS, [CAL]);
  materializeCalculatedTable(ev, CAL);
  assert.throws(() => materializeCalculatedTable(ev, CAL), /já está no dataset/);
});

test('coluna declarada que o DAX não devolve erra alto e diz o que ele devolve', () => {
  const errada = tab('X', [col('Dia', { sourceColumn: '[NaoExiste]' })], {
    queryRef: null,
    tableDax: 'CALENDAR(DATE(2026,1,1), DATE(2026,1,2))',
  });
  const { ev } = monta(FATOS, [errada]);
  assert.throws(() => materializeCalculatedTable(ev, errada), /não devolve nenhuma coluna 'naoexiste'.*Devolve: date/s);
});

/**
 * A outra metade da bijeção. Coluna que o DAX devolve e a spec não declara é
 * coluna que o extrator perdeu — foi assim que as 7 tabelas inteiras passaram
 * meses invisíveis, e aceitar em silêncio é o que permitiu isso.
 */
test('coluna do resultado que a spec não declara também erra alto', () => {
  const incompleta = tab('Y', [col('p', { sourceColumn: '[p]' })], {
    queryRef: null,
    tableDax: 'SELECTCOLUMNS(FATOS, "p", FATOS[Protocolo], "d", FATOS[Data])',
  });
  const { ev } = monta(FATOS, [incompleta]);
  assert.throws(() => materializeCalculatedTable(ev, incompleta), /devolve a\(s\) coluna\(s\) d que a tabela 'Y' não declara/);
});

test('coluna física sem sourceColumn erra alto: não há de onde tirar o valor', () => {
  const semOrigem = tab('Z', [col('Dia')], {
    queryRef: null,
    tableDax: 'CALENDAR(DATE(2026,1,1), DATE(2026,1,2))',
  });
  const { ev } = monta(FATOS, [semOrigem]);
  assert.throws(() => materializeCalculatedTable(ev, semOrigem), /não tem sourceColumn/);
});

/**
 * O caso real de `Status Protocolo Dia[Dia]`: `TRUNC` de um `dateTime` devolve
 * **número** (a série da data), e a coluna se liga a uma coluna de data. É o tipo
 * declarado que faz as duas pontas da junção serem da mesma espécie.
 */
test('tipo dateTime declarado converte série numérica em data', () => {
  const comTrunc = tab('T', [col('Dia', { type: 'dateTime', sourceColumn: '[d]' })], {
    queryRef: null,
    tableDax: 'SELECTCOLUMNS(FATOS, "d", TRUNC(FATOS[Data]))',
  });
  const { dataset, ev } = monta(FATOS, [comTrunc]);
  materializeCalculatedTable(ev, comTrunc);

  const valores = dataset.rows('T').map((r) => r['dia']);
  for (const v of valores) assert.ok(v instanceof Date, `esperava data e veio ${typeof v}`);
  assert.deepEqual(valores[0], makeDate(2026, 1, 10));
  // A série de onde ela veio, para deixar claro o que foi convertido.
  assert.equal(serialFromDate(makeDate(2026, 1, 10)), 46032);
});

test('tipo dateTime declarado com texto no DAX erra alto', () => {
  const texto = tab('W', [col('Dia', { type: 'dateTime', sourceColumn: '[d]' })], {
    queryRef: null,
    tableDax: 'SELECTCOLUMNS(FATOS, "d", "10/01/2026")',
  });
  const { ev } = monta(FATOS, [texto]);
  assert.throws(() => materializeCalculatedTable(ev, texto), /declarada dateTime.*DATEVALUE/s);
});

// ---------------------------------------------------------------------------
// Ordem e ciclo
// ---------------------------------------------------------------------------

test('a dependência entre calculadas manda a ordem, não a ordem das specs', () => {
  const a = tab('A', [col('p', { sourceColumn: '[p]' })], {
    queryRef: null,
    // Depende de B, e é declarada primeiro.
    tableDax: 'SELECTCOLUMNS(B, "p", B[q])',
  });
  const b = tab('B', [col('q', { sourceColumn: '[q]' })], {
    queryRef: null,
    tableDax: 'SELECTCOLUMNS(FATOS, "q", FATOS[Protocolo])',
  });
  const { model, dataset, ev } = monta(FATOS, [a, b]);

  assert.deepEqual(calculatedTableDependencies(model, a), ['b']);
  assert.deepEqual(calculatedTableDependencies(model, b), []);
  assert.deepEqual(calculatedTableOrder(model).map((t) => t.name), ['B', 'A']);

  materializeCalculatedTables(ev);
  assert.equal(dataset.rows('A').length, 3);
});

/**
 * Ciclo erra alto **nomeando o caminho**. Sem isto ele apareceria como "tabela não
 * está no dataset" no meio de uma avaliação, longe da causa — e a tabela que
 * fechasse o ciclo por último nasceria vazia.
 */
test('ciclo entre tabelas calculadas erra alto e mostra o caminho', () => {
  const a = tab('A', [col('p', { sourceColumn: '[p]' })], {
    queryRef: null,
    tableDax: 'SELECTCOLUMNS(B, "p", B[q])',
  });
  const b = tab('B', [col('q', { sourceColumn: '[q]' })], {
    queryRef: null,
    tableDax: 'SELECTCOLUMNS(A, "q", A[p])',
  });
  const { model } = monta(FATOS, [a, b]);
  assert.throws(() => calculatedTableOrder(model), /Ciclo entre tabelas calculadas.*'a'.*'b'/s);
});

/**
 * A dependência atravessa **coluna calculada**: é o caso de
 * `CALENDARIO INSTALADO`, cujo DAX começa em `MIN('PROTOCOLOS GERAL'[DATA
 * INSTALAÇÃO])` — coluna calculada, com DAX próprio. Olhar só as referências
 * diretas pararia em `FATOS` e perderia a dependência de verdade.
 */
test('a dependência é seguida coluna calculada adentro', () => {
  const derivada = tab('D', [col('q', { sourceColumn: '[q]' })], {
    queryRef: null,
    tableDax: 'SELECTCOLUMNS(FATOS, "q", FATOS[Protocolo])',
  });
  const model = new SemanticModel();
  model.addTable(tab('FATOS', [
    col('Data', { type: 'dateTime' }),
    col('Protocolo', { type: 'string' }),
    // A coluna calculada é que menciona D; o table_dax de C não menciona.
    col('ViaD', { calculated: true, dax: 'COUNTROWS(D)' }),
  ]));
  model.addTable(derivada);
  const c = tab('C', [col('n', { sourceColumn: '[n]' })], {
    queryRef: null,
    tableDax: 'SELECTCOLUMNS(FATOS, "n", FATOS[ViaD])',
  });
  model.addTable(c);

  assert.deepEqual(calculatedTableDependencies(model, c), ['d']);
  assert.deepEqual(calculatedTableOrder(model).map((t) => t.name), ['D', 'C']);
});
