// Propagação de filtro por relacionamento.
//
// O caso que motivou a fase inteira é o primeiro teste, e ele é o retrato do erro
// que este projeto mais teme: até aqui `Contagem Solicitacao 2026` **rodava** e
// devolvia a contagem de todos os anos. Filtro em `CALENDARIO INSTALADO`, contagem
// em `PROTOCOLOS GERAL`, e nada atravessava — número errado com cara de certo, sem
// erro nenhum para avisar.
//
// Os dois primeiros modelos replicam a forma real da base (nomes, cardinalidades e
// coluna de junção calculada). Os testes de direção e de erro usam nomes genéricos
// de propósito: ali o que está sendo fixado é a regra, e nome real só atrapalharia
// a leitura.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn, ModelRelationship } from '../../semantic-model/src/types.ts';
import { Dataset, type Row } from '../src/dataset.ts';
import { Evaluator } from '../src/evaluator.ts';
import { makeDate } from '../src/value.ts';

const HOJE = makeDate(2026, 8, 4);

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

function rel(r: Partial<ModelRelationship> & Pick<ModelRelationship,
  'id' | 'fromTable' | 'fromColumn' | 'toTable' | 'toColumn'>): ModelRelationship {
  return {
    fromCardinality: 'many',
    toCardinality: 'one',
    active: true,
    crossFilter: 'oneDirection',
    joinOnDateBehavior: null,
    ...r,
  };
}

// ---------------------------------------------------------------------------
// 1. O caso real: um salto, com coluna de junção CALCULADA
// ---------------------------------------------------------------------------

/**
 * `'PROTOCOLOS GERAL'[DATA INSTALAÇÃO]` é a coluna de junção com
 * `CALENDARIO INSTALADO`, e ela **não existe nos dados**: é calculada, e escolhe
 * entre três colunas de data conforme o tipo do protocolo. Aqui está a segunda
 * metade da regra real — o suficiente para que a linha S3 junte por uma data
 * diferente da que está guardada.
 *
 * É por isso que a propagação precisa do avaliador para ler coluna de junção. Ler
 * a linha crua devolveria vazio, e a junção não casaria nada.
 */
const DATA_INSTALACAO = `
IF(
    'PROTOCOLOS GERAL'[TIPO DE PROTOCOLO] IN { "TEC - Troca de Endereço" },
    'PROTOCOLOS GERAL'[DATA DA TROCA],
    'PROTOCOLOS GERAL'[DATA ALOCAÇÃO]
)`;

const CALENDARIO: Row[] = [
  { 'DATA INSTALADO': makeDate(2025, 12, 30) },
  { 'DATA INSTALADO': makeDate(2026, 1, 5) },
  { 'DATA INSTALADO': makeDate(2026, 2, 10) },
  { 'DATA INSTALADO': makeDate(2026, 3, 15) },
];

const PROTOCOLOS: Row[] = [
  // 2025: fica de fora do filtro.
  { SOLICITACAO: 'S1', 'TIPO DE PROTOCOLO': 'TEC - Instalação', 'DATA ALOCAÇÃO': makeDate(2025, 12, 30), 'DATA DA TROCA': null },
  { SOLICITACAO: 'S2', 'TIPO DE PROTOCOLO': 'TEC - Instalação', 'DATA ALOCAÇÃO': makeDate(2026, 1, 5), 'DATA DA TROCA': null },
  // Guardada em 2025, mas junta por DATA DA TROCA e portanto ENTRA. É esta linha
  // que separa "resolveu a coluna calculada" de "leu a linha crua".
  { SOLICITACAO: 'S3', 'TIPO DE PROTOCOLO': 'TEC - Troca de Endereço', 'DATA ALOCAÇÃO': makeDate(2025, 12, 30), 'DATA DA TROCA': makeDate(2026, 2, 10) },
  // Data que não existe no calendário: no Power BI cai na linha em branco do lado
  // "one" e sai quando esse lado é filtrado.
  { SOLICITACAO: 'S4', 'TIPO DE PROTOCOLO': 'TEC - Instalação', 'DATA ALOCAÇÃO': makeDate(2026, 9, 9), 'DATA DA TROCA': null },
  { SOLICITACAO: 'S5', 'TIPO DE PROTOCOLO': 'TEC - Instalação', 'DATA ALOCAÇÃO': null, 'DATA DA TROCA': null },
];

function montarInstalado() {
  const model = new SemanticModel();
  model.addTable({
    id: 'ci', name: 'CALENDARIO INSTALADO', queryRef: null,
    columns: [col('DATA INSTALADO', { type: 'dateTime' })],
  });
  model.addTable({
    id: 'pg', name: 'PROTOCOLOS GERAL', queryRef: null,
    columns: [
      col('SOLICITACAO'),
      col('TIPO DE PROTOCOLO'),
      col('DATA ALOCAÇÃO', { type: 'dateTime' }),
      col('DATA DA TROCA', { type: 'dateTime' }),
      col('DATA INSTALAÇÃO', { calculated: true, dax: DATA_INSTALACAO }),
    ],
  });
  model.relationships.push(rel({
    id: 'b1a0883e', fromTable: 'PROTOCOLOS GERAL', fromColumn: 'DATA INSTALAÇÃO',
    toTable: 'CALENDARIO INSTALADO', toColumn: 'DATA INSTALADO',
  }));

  const m = (name: string, dax: string) =>
    model.addMeasure({ name, table: 'PROTOCOLOS GERAL', format: null, displayFolder: null, dax });

  m('Contagem Solicitacao', "COUNT('PROTOCOLOS GERAL'[SOLICITACAO])");
  // DAX real da base, palavra por palavra.
  m('Contagem Solicitacao 2026', `CALCULATE(
        COUNT('PROTOCOLOS GERAL'[SOLICITACAO]),
        'CALENDARIO INSTALADO'[DATA INSTALADO] >= DATE(2026,1,1)
    )`);
  m('Dias do calendario', "COUNTROWS('CALENDARIO INSTALADO')");
  // Sentido proibido: `oneDirection` não anda do "many" para o "one".
  m('Dias com S1', "CALCULATE([Dias do calendario], 'PROTOCOLOS GERAL'[SOLICITACAO] = \"S1\")");
  // `ALL` devolve tudo, logo não restringe, logo não propaga.
  m('Contagem com ALL', "CALCULATE([Contagem Solicitacao], ALL('CALENDARIO INSTALADO'[DATA INSTALADO]))");

  const dataset = new Dataset();
  dataset.addTable('CALENDARIO INSTALADO', CALENDARIO);
  dataset.addTable('PROTOCOLOS GERAL', PROTOCOLOS);
  return new Evaluator({ model, dataset, now: HOJE });
}

test('o caso da fase: filtro no calendário atravessa e chega em PROTOCOLOS GERAL', () => {
  const ev = montarInstalado();
  // As 5 linhas, sem filtro.
  assert.equal(ev.measure('Contagem Solicitacao'), 5);
  // S2 (janeiro) e S3 (fevereiro, pela DATA DA TROCA). Antes desta fase dava 5.
  assert.equal(ev.measure('Contagem Solicitacao 2026'), 2);
});

test('a junção usa a coluna CALCULADA, não a data guardada na linha', () => {
  const ev = montarInstalado();
  // S3 está guardada em 30/12/2025 e ainda assim conta como 2026. Se a propagação
  // lesse `DATA ALOCAÇÃO` — ou lesse `DATA INSTALAÇÃO` crua da linha, que vem
  // vazia — o resultado seria 1, e pareceria razoável.
  assert.equal(ev.measure('Contagem Solicitacao 2026'), 2);
  assert.equal(
    ev.evaluateExpression(
      "CALCULATE(COUNT('PROTOCOLOS GERAL'[SOLICITACAO]), 'CALENDARIO INSTALADO'[DATA INSTALADO] = DATE(2026,2,10))",
    ),
    1,
  );
});

test('linha do lado "many" sem correspondência sai quando o lado "one" é filtrado', () => {
  const ev = montarInstalado();
  // S4 (09/09/2026, dia que não existe no calendário) e S5 (data em branco) não
  // entram em nenhum filtro de calendário — nem no que aceita 2026 inteiro.
  assert.equal(ev.measure('Contagem Solicitacao 2026'), 2);
});

test('oneDirection não propaga de volta: filtrar PROTOCOLOS GERAL não mexe no calendário', () => {
  const ev = montarInstalado();
  assert.equal(ev.measure('Dias do calendario'), 4);
  // Se propagasse nos dois sentidos, daria 1 — o dia de S1.
  assert.equal(ev.measure('Dias com S1'), 4);
});

test('origem sem restrição não restringe ninguém — é o que faz ALL funcionar', () => {
  const ev = montarInstalado();
  // `ALL` deixa o calendário vendo tudo. Se a propagação virasse INNER JOIN, S4 e
  // S5 sumiriam e o resultado seria 3 em vez de 5.
  assert.equal(ev.measure('Contagem com ALL'), 5);
});

// ---------------------------------------------------------------------------
// 2. O caso real de DOIS saltos
// ---------------------------------------------------------------------------

/**
 * `calendar` → `Status Protocolo Dia` → `FIELD AGENDA`, os três com a
 * cardinalidade real (many-to-many, direção única). Este é o motivo de a
 * propagação ser recursiva: restringir só os vizinhos diretos deixaria
 * `FIELD AGENDA` de fora.
 */
const D1 = makeDate(2026, 8, 3);
const D2 = makeDate(2026, 8, 4);

function montarDoisSaltos() {
  const model = new SemanticModel();
  model.addTable({ id: 'c', name: 'calendar', queryRef: null, columns: [col('Data', { type: 'dateTime' })] });
  model.addTable({
    id: 's', name: 'Status Protocolo Dia', queryRef: null,
    columns: [col('Dia', { type: 'dateTime' }), col('protocolo')],
  });
  model.addTable({ id: 'f', name: 'FIELD AGENDA', queryRef: null, columns: [col('Protocolo')] });

  model.relationships.push(
    rel({
      id: '708032e7', fromTable: 'Status Protocolo Dia', fromColumn: 'Dia',
      toTable: 'calendar', toColumn: 'Data', toCardinality: 'many',
    }),
    rel({
      id: '143dde0e', fromTable: 'FIELD AGENDA', fromColumn: 'Protocolo',
      toTable: 'Status Protocolo Dia', toColumn: 'protocolo', toCardinality: 'many',
    }),
  );

  const m = (name: string, dax: string) =>
    model.addMeasure({ name, table: 'FIELD AGENDA', format: null, displayFolder: null, dax });
  m('Linhas agenda', "COUNTROWS('FIELD AGENDA')");
  m('Linhas status', "COUNTROWS('Status Protocolo Dia')");
  m('Agenda no dia 1', "CALCULATE([Linhas agenda], 'calendar'[Data] = DATE(2026,8,3))");
  m('Status no dia 1', "CALCULATE([Linhas status], 'calendar'[Data] = DATE(2026,8,3))");

  const dataset = new Dataset();
  dataset.addTable('calendar', [{ Data: D1 }, { Data: D2 }, { Data: makeDate(2026, 8, 5) }]);
  dataset.addTable('Status Protocolo Dia', [
    { Dia: D1, protocolo: 'PA' },
    { Dia: D2, protocolo: 'PB' },
    { Dia: D2, protocolo: 'PC' },
  ]);
  dataset.addTable('FIELD AGENDA', [
    { Protocolo: 'PA' },
    { Protocolo: 'PA' },
    { Protocolo: 'PB' },
    { Protocolo: 'PZ' },
  ]);
  return new Evaluator({ model, dataset, now: HOJE });
}

test('filtro atravessa dois relacionamentos em sequência', () => {
  const ev = montarDoisSaltos();
  assert.equal(ev.measure('Linhas agenda'), 4);
  // Primeiro salto: só a linha de PA no dia 1.
  assert.equal(ev.measure('Status no dia 1'), 1);
  // Segundo salto: as duas linhas de PA. `PZ` não aparece em Status Protocolo Dia
  // nenhum, então também sai.
  assert.equal(ev.measure('Agenda no dia 1'), 2);
});

test('many-to-many com direção única propaga só de "to" para "from"', () => {
  const ev = montarDoisSaltos();
  // Filtrar a agenda não estreita o calendário: as três datas continuam.
  assert.equal(
    ev.evaluateExpression("CALCULATE(COUNTROWS('calendar'), 'FIELD AGENDA'[Protocolo] = \"PA\")"),
    3,
  );
});

// ---------------------------------------------------------------------------
// 3. Regras de direção e de erro
// ---------------------------------------------------------------------------

function montarRegras(relacionamentos: ModelRelationship[], tipoChaveMuitos: string | null = null) {
  const model = new SemanticModel();
  model.addTable({ id: 'u', name: 'UM', queryRef: null, columns: [col('K'), col('Rotulo')] });
  model.addTable({
    id: 'm', name: 'MUITOS', queryRef: null,
    columns: [col('K', { type: tipoChaveMuitos }), col('V', { type: 'int64' })],
  });
  model.relationships.push(...relacionamentos);

  const dataset = new Dataset();
  dataset.addTable('UM', [{ K: 'a', Rotulo: 'primeira' }, { K: 'b', Rotulo: 'segunda' }]);
  dataset.addTable('MUITOS', [
    { K: 'a', V: 1 },
    { K: 'a', V: 2 },
    { K: 'b', V: 4 },
  ]);
  return new Evaluator({ model, dataset, now: HOJE });
}

const R_ATIVO = rel({ id: 'r1', fromTable: 'MUITOS', fromColumn: 'K', toTable: 'UM', toColumn: 'K' });

test('relacionamento ativo propaga do "one" para o "many"', () => {
  const ev = montarRegras([R_ATIVO]);
  assert.equal(ev.evaluateExpression("SUM('MUITOS'[V])"), 7);
  assert.equal(ev.evaluateExpression("CALCULATE(SUM('MUITOS'[V]), 'UM'[Rotulo] = \"primeira\")"), 3);
});

test('relacionamento INATIVO não propaga — só valeria dentro de USERELATIONSHIP', () => {
  // A base tem um assim (`PROTOCOLOS PRODUTIVIDADE[SOLICITACAO]` →
  // `PROTOCOLOS GERAL[SOLICITACAO]`) e não usa `USERELATIONSHIP` em nenhuma das
  // 127 expressões. Tratá-lo como ativo mudaria números de verdade.
  const ev = montarRegras([rel({ ...R_ATIVO, active: false })]);
  assert.equal(ev.evaluateExpression("CALCULATE(SUM('MUITOS'[V]), 'UM'[Rotulo] = \"primeira\")"), 7);
});

test('bothDirections propaga também do "many" para o "one"', () => {
  const ev = montarRegras([rel({ ...R_ATIVO, crossFilter: 'bothDirections' })]);
  // Só `a` sobrevive em MUITOS, e isso volta para UM.
  assert.equal(
    ev.evaluateExpression("CALCULATE(COUNTROWS('UM'), 'MUITOS'[V] <= 2)"),
    1,
  );
  // E o mesmo relacionamento não é atravessado duas vezes: o filtro que saiu de
  // MUITOS não volta de UM para MUITOS estreitando ainda mais.
  assert.equal(
    ev.evaluateExpression("CALCULATE(SUM('MUITOS'[V]), 'MUITOS'[V] <= 2)"),
    3,
  );
});

test('caminho ambíguo erra alto em vez de escolher um dos dois', () => {
  // Dois relacionamentos distintos entre as mesmas tabelas, fechando ciclo. O
  // Power BI recusa esse modelo; o avaliador também recusa, em vez de devolver o
  // número de um dos caminhos.
  const ev = montarRegras([
    R_ATIVO,
    rel({ id: 'r2', fromTable: 'UM', fromColumn: 'Rotulo', toTable: 'MUITOS', toColumn: 'V' }),
  ]);
  assert.throws(
    () => ev.evaluateExpression("SUM('MUITOS'[V])"),
    /Caminho de filtro ambíguo/,
  );
});

test('junção entre tipos diferentes erra alto em vez de devolver vazio', () => {
  // A armadilha das colunas que chegam como texto `DD/MM/YYYY`: data de um lado,
  // texto do outro, nada casa, e o resultado sairia zero com cara de filtro
  // apertado. Foi esse tipo de comparação que gerou o achado 1 falso.
  const ev = montarRegras([R_ATIVO], 'dateTime');
  const dataset = ev.dataset;
  dataset.rows('MUITOS').forEach((r) => {
    r['k'] = makeDate(2026, 8, 3);
  });
  assert.throws(
    () => ev.evaluateExpression("CALCULATE(SUM('MUITOS'[V]), 'UM'[Rotulo] = \"primeira\")"),
    // A mensagem nomeia origem -> destino, nessa ordem: `UM` é o lado que filtra.
    /compara texto com data/,
  );
});

test('tabela fora do dataset não propaga — não é erro, é subconjunto do modelo', () => {
  // Vários testes carregam parte do modelo. Tabela que não está nos dados não tem
  // filtro nenhum, logo não restringe.
  const model = new SemanticModel();
  model.addTable({ id: 'u', name: 'UM', queryRef: null, columns: [col('K')] });
  model.addTable({ id: 'm', name: 'MUITOS', queryRef: null, columns: [col('K'), col('V', { type: 'int64' })] });
  model.relationships.push(R_ATIVO);
  const dataset = new Dataset();
  dataset.addTable('MUITOS', [{ K: 'a', V: 1 }, { K: 'b', V: 4 }]);
  const ev = new Evaluator({ model, dataset, now: HOJE });
  assert.equal(ev.evaluateExpression("SUM('MUITOS'[V])"), 5);
});
