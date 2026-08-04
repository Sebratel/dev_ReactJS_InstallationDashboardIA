import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTmdlTable, parseTmdlExpressions } from '../src/tmdl.mjs';
import { unescapeMString, detectSource, extractSourceTables } from '../src/mquery.mjs';
import { toYaml } from '../src/yaml.mjs';
import { locatePbip, build } from '../src/index.mjs';

// ---------- Unit: TMDL table ----------
const SAMPLE_TABLE = `table CONTRATOS
\tlineageTag: abc

\tcolumn CLIENTE
\t\tdataType: string
\t\tsummarizeBy: none
\t\tsourceColumn: CLIENTE

\tcolumn 'NUMERO CONTRATO'
\t\tdataType: int64
\t\tformatString: 0
\t\tsourceColumn: NUMERO CONTRATO

\tmeasure 'TOTAL' = COUNTROWS('CONTRATOS')
\t\tformatString: 0
\t\tlineageTag: def

\tmeasure MULTI =
\t\t\tCALCULATE(
\t\t\t    COUNTROWS('CONTRATOS'),
\t\t\t    CONTRATOS[CLIENTE] <> ""
\t\t\t)
\t\tdisplayFolder: KPIs
\t\tlineageTag: ghi

\tpartition CONTRATOS = m
\t\tmode: import
\t\tsource =
\t\t\t\tlet
\t\t\t\t    Fonte = Odbc.Query("dsn=dbVoalle", "select#(lf)#(tab)p.name ""CLIENTE""#(lf)from people p")
\t\t\t\tin
\t\t\t\t    Fonte
`;

test('parseTmdlTable: nome, colunas, medidas, partition', () => {
  const t = parseTmdlTable(SAMPLE_TABLE);
  assert.equal(t.name, 'CONTRATOS');
  assert.equal(t.columns.length, 2);
  assert.equal(t.columns[1].name, 'NUMERO CONTRATO');
  assert.equal(t.columns[1].dataType, 'int64');
  assert.equal(t.measures.length, 2);
  assert.equal(t.measures[0].name, 'TOTAL');
  assert.equal(t.measures[0].expression, "COUNTROWS('CONTRATOS')");
  assert.equal(t.measures[0].formatString, '0');
  assert.equal(t.measures[1].name, 'MULTI');
  assert.match(t.measures[1].expression, /CALCULATE\(/);
  assert.match(t.measures[1].expression, /CLIENTE\] <> ""/);
  assert.equal(t.measures[1].displayFolder, 'KPIs');
  assert.equal(t.partitions.length, 1);
  assert.match(t.partitions[0].source, /Odbc\.Query/);
});

// ---------- Unit: M string / source ----------
test('unescapeMString: converte escapes de M', () => {
  assert.equal(unescapeMString('a#(lf)b#(tab)c'), 'a\nb\tc');
  assert.equal(unescapeMString('diz ""oi""'), 'diz "oi"');
});

test('detectSource: ODBC extrai dsn e SQL legível', () => {
  const m = 'let Fonte = Odbc.Query("dsn=dbVoalle", "select#(lf)#(tab)p.name ""CLIENTE""#(lf)from people p") in Fonte';
  const src = detectSource(m);
  assert.equal(src.type, 'odbc');
  assert.equal(src.datasource, 'dbVoalle');
  assert.match(src.sql, /select/);
  assert.match(src.sql, /"CLIENTE"/);
  assert.match(src.sql, /from people p/);
  assert.ok(!src.sql.includes('#(lf)'));
});

test('detectSource: GoogleSheets', () => {
  const src = detectSource('let F = GoogleSheets.Contents("https://x/y") in F');
  assert.equal(src.type, 'googlesheets');
  assert.equal(src.datasource, 'gsheets');
  assert.match(src.url, /https/);
});

test('detectSource: Web.Contents vira type=web com endpoints', () => {
  const m = 'let d = Json.Document(Web.Contents("https://api.open-meteo.com", [Q=1])), '
    + 'e = Json.Document(Web.Contents("https://archive-api.open-meteo.com")) in d';
  const src = detectSource(m);
  assert.equal(src.type, 'web');
  assert.equal(src.datasource, 'web');
  assert.deepEqual(src.endpoints.sort(), [
    'https://api.open-meteo.com',
    'https://archive-api.open-meteo.com',
  ]);
});

test('detectSource: dados embutidos no PBIX viram type=inline', () => {
  const m = 'let F = Table.FromRows(Json.Document(Binary.Decompress(Binary.FromText("AAA=", '
    + 'BinaryEncoding.Base64), Compression.Deflate))) in F';
  assert.equal(detectSource(m).type, 'inline');
});

test('detectSource: timestamp de refresh vira type=computed', () => {
  const m = 'let F = DateTimeZone.SwitchZone(DateTimeZone.LocalNow(), -3) in F';
  assert.equal(detectSource(m).type, 'computed');
});

test('extractSourceTables: pega tabelas de FROM/JOIN', () => {
  const sql = 'select * from assignments a left join assignment_incidents ai on ai.assignment_id = a.id';
  const tabs = extractSourceTables(sql);
  assert.ok(tabs.includes('assignments'));
  assert.ok(tabs.includes('assignment_incidents'));
});

// ---------- Unit: expressions ----------
test('parseTmdlExpressions: extrai nome e M', () => {
  const txt = `expression 'MINHA QUERY' =
\t\tlet
\t\t    Fonte = Odbc.Query("dsn=dbMaria", "select 1")
\t\tin
\t\t    Fonte
\tlineageTag: xyz
\tqueryGroup: Base

\tannotation PBI_ResultType = Table
`;
  const exprs = parseTmdlExpressions(txt);
  assert.equal(exprs.length, 1);
  assert.equal(exprs[0].name, 'MINHA QUERY');
  assert.match(exprs[0].source, /Odbc\.Query/);
  assert.ok(!exprs[0].source.includes('lineageTag'));
});

// ---------- Unit: YAML ----------
test('toYaml: objetos, arrays e multilinha', () => {
  const y = toYaml({ id: 'x', list: [1, 2], obj: { a: 'b' }, sql: 'linha1\nlinha2' });
  assert.match(y, /id: x/);
  assert.match(y, /- 1/);
  assert.match(y, /sql: \|-/);
  assert.match(y, /linha1/);
});

test('toYaml: objeto aninhado é indentado (+2)', () => {
  const y = toYaml({ size: { width: 100, height: 200 } });
  assert.match(y, /size:\n {2}width: 100\n {2}height: 200/);
});

test('toYaml: array vazio quebra linha (não gruda próxima chave)', () => {
  const y = toYaml({ a: [], b: 1 });
  assert.match(y, /a: \[\]\nb: 1/);
});

test('toYaml: string terminando em ":" é citada', () => {
  const y = toYaml({ name: 'INSTALADO POR:' });
  assert.match(y, /name: "INSTALADO POR:"/);
});

test('toYaml: array de objetos dentro de item de lista', () => {
  const y = toYaml({ visuals: [{ id: 'v1', fields: [{ role: 'x' }] }] });
  assert.match(y, /visuals:\n- id: v1\n {2}fields:\n {2}- role: x/);
});

// ---------- Integração: extrai o PBIP real (se presente) ----------
test('build: extrai o PBIP real com contagens esperadas', () => {
  let pbip;
  try {
    pbip = locatePbip();
  } catch {
    console.warn('PBIP não encontrado — pulando teste de integração.');
    return;
  }
  const model = build(pbip);
  // Contagens observadas na base atual (âncora de regressão)
  assert.equal(model.counts.tables, 25, 'tabelas');
  assert.equal(model.counts.measures, 78, 'medidas');
  assert.equal(model.counts.dashboards, 14, 'páginas');
  assert.equal(model.counts.visuals, 306, 'visuais');
  // datasources reais esperados
  const ids = model.datasources.map((d) => d.id);
  assert.ok(ids.includes('dbVoalle'), 'dbVoalle presente');
  assert.ok(ids.includes('dbMaria'), 'dbMaria presente');
  // toda query de expression/tabela tem id único
  const qIds = model.queries.map((q) => q.id);
  assert.equal(new Set(qIds).size, qIds.length, 'ids de query únicos');
});
