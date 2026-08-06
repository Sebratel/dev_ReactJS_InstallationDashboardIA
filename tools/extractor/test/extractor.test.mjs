import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTmdlTable,
  parseTmdlExpressions,
  parseTmdlRelationships,
  parseColumnRef,
} from '../src/tmdl.mjs';
import { unescapeMString, detectSource, extractSourceTables } from '../src/mquery.mjs';
import { toYaml } from '../src/yaml.mjs';
import {
  locatePbip,
  build,
  extractFilters,
  traduzCondicao,
  parseLiteral,
  descreveCampo,
  extractVisualFields,
} from '../src/index.mjs';

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

// ---------- Unit: cerca ``` do TMDL ----------
// O TMDL delimita expressão multi-linha com ```. Não é DAX. Enquanto vazava
// para a spec, 33 medidas e 11 colunas calculadas começavam e terminavam com
// "```" — qualquer parser de DAX morre na primeira linha.
const SAMPLE_FENCED = `table 'CALENDARIO INSTALADO'
\tlineageTag: abc

\tmeasure '# PROJEÇÃO' = \`\`\`
\t\t\t
\t\t\tDISTINCTCOUNT('PROTOCOLOS GERAL'[SOLICITACAO]) +
\t\t\t(
\t\t\t    [# MEDIA INSTALADO MENSAL] * 2
\t\t\t)
\t\t\t
\t\t\t\`\`\`
\t\tformatString: 0
\t\tlineageTag: def

\t\tannotation PBI_FormatHint = {"isDecimal":true}

\tcolumn 'DATA INSTALADO'
\t\tformatString: Short Date
\t\tsourceColumn: [Date]

\tcolumn DATA_VIGENTE = IF('CALENDARIO INSTALADO'[DATA INSTALADO] <= TODAY(), "Sim", "Não")
\t\tsummarizeBy: none

\tcolumn PESO = \`\`\`
\t\t\t
\t\t\tVAR DataAtual = TODAY()
\t\t\tRETURN
\t\t\t    IF(DataAtual > 0, 1, 0)
\t\t\t
\t\t\t\`\`\`
\t\tformatString: 0
\t\tsummarizeBy: sum

\tcolumn 'Semana Do Mes Texto' =
\t\t\t
\t\t\tVAR SemanaDoMesNum = [Num Semana]
\t\t\tRETURN
\t\t\t    CONCATENATE(SemanaDoMesNum, "ª Semana")
\t\tlineageTag: 6d6ee4ad
\t\tsummarizeBy: none
`;

test('parseTmdlTable: a cerca ``` do TMDL não entra no DAX da medida', () => {
  const t = parseTmdlTable(SAMPLE_FENCED);
  const m = t.measures.find((x) => x.name === '# PROJEÇÃO');
  assert.ok(m, 'medida cercada encontrada');
  assert.ok(!m.expression.includes('```'), `cerca vazou: ${JSON.stringify(m.expression)}`);
  assert.match(m.expression, /^DISTINCTCOUNT/, 'DAX começa na primeira linha real');
  assert.match(m.expression, /\[# MEDIA INSTALADO MENSAL\] \* 2/);
  assert.equal(m.formatString, '0', 'props depois da cerca continuam sendo lidas');
});

test('parseTmdlTable: coluna calculada multi-linha guarda o DAX inteiro', () => {
  const t = parseTmdlTable(SAMPLE_FENCED);
  const peso = t.columns.find((c) => c.name === 'PESO');
  assert.equal(peso.calculated, true);
  // Antes o corpo era descartado e a expressão virava literalmente "```":
  // a spec afirmava que PESO existia sem dizer como era calculada, e seis
  // medidas somam essa coluna.
  assert.ok(!peso.expression.includes('```'), 'cerca vazou na coluna');
  assert.match(peso.expression, /VAR DataAtual = TODAY\(\)/);
  assert.match(peso.expression, /IF\(DataAtual > 0, 1, 0\)/);
  assert.equal(peso.formatString, '0');
});

test('parseTmdlTable: coluna calculada de uma linha continua funcionando', () => {
  const t = parseTmdlTable(SAMPLE_FENCED);
  const c = t.columns.find((x) => x.name === 'DATA_VIGENTE');
  assert.equal(c.calculated, true);
  assert.equal(c.expression, `IF('CALENDARIO INSTALADO'[DATA INSTALADO] <= TODAY(), "Sim", "Não")`);
});

test('parseTmdlTable: nome citado com "=" no fim da linha guarda nome e DAX', () => {
  // A busca por `' = '` exigia espaço DEPOIS do `=`. Quando a linha termina no
  // `=` e o corpo vem indentado abaixo, nada casava: a coluna era gravada com o
  // nome literal "'Semana Do Mes Texto' =", calculated=false e DAX nenhum.
  // Seis colunas do modelo caíam nisso — e uma delas é a única que usa
  // CONCATENATE, função que por isso não entrava no escopo do avaliador.
  const t = parseTmdlTable(SAMPLE_FENCED);
  const c = t.columns.find((x) => x.name === 'Semana Do Mes Texto');
  assert.ok(c, `nome mal separado: ${JSON.stringify(t.columns.map((x) => x.name))}`);
  assert.equal(c.calculated, true);
  assert.match(c.expression, /VAR SemanaDoMesNum = \[Num Semana\]/);
  assert.match(c.expression, /CONCATENATE\(SemanaDoMesNum, "ª Semana"\)/);
  assert.ok(!c.expression.includes('lineageTag'), 'propriedade entrou no DAX');
  assert.equal(c.summarizeBy, 'none', 'props depois do corpo continuam sendo lidas');
});

test('parseTmdlTable: coluna sem "=" não é calculada e não tem DAX', () => {
  const t = parseTmdlTable(SAMPLE_FENCED);
  const c = t.columns.find((x) => x.name === 'DATA INSTALADO');
  assert.ok(!c.calculated);
  assert.equal(c.expression, undefined);
  assert.equal(c.sourceColumn, '[Date]');
});

test('parsePartition: source cercado também é limpo', () => {
  const txt = `table T
\tpartition T = m
\t\tmode: import
\t\tsource = \`\`\`
\t\t\t\tlet
\t\t\t\t    Fonte = Odbc.Query("dsn=dbVoalle", "select 1")
\t\t\t\tin
\t\t\t\t    Fonte
\t\t\t\t\`\`\`
`;
  const t = parseTmdlTable(txt);
  assert.ok(!t.partitions[0].source.includes('```'), 'cerca vazou no M');
  assert.match(t.partitions[0].source, /^let/);
});

// ---------- Unit: relacionamentos ----------
test('parseColumnRef: aspas simples e identificador nu', () => {
  assert.deepEqual(parseColumnRef("'PROTOCOLOS GERAL'.'DATA AGENDA'"), {
    table: 'PROTOCOLOS GERAL',
    column: 'DATA AGENDA',
  });
  assert.deepEqual(parseColumnRef('calendar.Data'), { table: 'calendar', column: 'Data' });
  assert.deepEqual(parseColumnRef("PROTOCOLOS.'TIPO DE PROTOCOLO'"), {
    table: 'PROTOCOLOS',
    column: 'TIPO DE PROTOCOLO',
  });
});

test('parseColumnRef: coluna cujo NOME contém ponto', () => {
  // Existe no modelo real. Um split('.') devolveria a coluna "PROTOCOLOS GERAL",
  // que também existe — relacionamento silenciosamente errado, não um erro.
  assert.deepEqual(
    parseColumnRef("'BACKLOG AGENDADO FUTURO'.'PROTOCOLOS GERAL.TIPO DE PROTOCOLO'"),
    { table: 'BACKLOG AGENDADO FUTURO', column: 'PROTOCOLOS GERAL.TIPO DE PROTOCOLO' },
  );
});

test('parseColumnRef: referência malformada estoura em vez de chutar', () => {
  assert.throws(() => parseColumnRef("'SEM PONTO'"), /sem ponto/i);
  assert.throws(() => parseColumnRef("'sem fechamento.x"), /aspa/i);
});

test('parseTmdlRelationships: propriedades e defaults do TMDL', () => {
  const txt = `relationship aaa-111
\tfromColumn: 'PROTOCOLOS GERAL'.'DATA INSTALAÇÃO'
\ttoColumn: 'CALENDARIO INSTALADO'.'DATA INSTALADO'

relationship bbb-222
\tisActive: false
\tcrossFilteringBehavior: bothDirections
\ttoCardinality: many
\tjoinOnDateBehavior: datePartOnly
\tfromColumn: CONTRATOS.CLIENTE
\ttoColumn: 'PROTOCOLOS PRODUTIVIDADE'.CLIENTE
`;
  const rels = parseTmdlRelationships(txt);
  assert.equal(rels.length, 2);

  // O TMDL só grava o que difere do default — os defaults precisam ser
  // explícitos aqui, senão o avaliador não sabe para onde o filtro propaga.
  assert.equal(rels[0].id, 'aaa-111');
  assert.deepEqual(rels[0].from, { table: 'PROTOCOLOS GERAL', column: 'DATA INSTALAÇÃO' });
  assert.deepEqual(rels[0].to, { table: 'CALENDARIO INSTALADO', column: 'DATA INSTALADO' });
  assert.equal(rels[0].isActive, true, 'ativo por default');
  assert.equal(rels[0].fromCardinality, 'many');
  assert.equal(rels[0].toCardinality, 'one');
  assert.equal(rels[0].crossFilteringBehavior, 'oneDirection');

  assert.equal(rels[1].isActive, false);
  assert.equal(rels[1].toCardinality, 'many');
  assert.equal(rels[1].crossFilteringBehavior, 'bothDirections');
  assert.equal(rels[1].joinOnDateBehavior, 'datePartOnly');
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

test('detectSource: guarda a aba que o M navega', () => {
  // O connector baixa só esta aba. As outras da mesma planilha têm CPF e RG, e
  // ler o que não se usa é risco sem contrapartida.
  const m = 'let Fonte = GoogleSheets.Contents("https://x/y"), '
    + 'T = Fonte{[name="#APURAÇÃO PREMIAÇÃO",ItemKind="Table"]}[Data] in T';
  assert.equal(detectSource(m).sheet, '#APURAÇÃO PREMIAÇÃO');
});

test('detectSource: aba com espaço em volta do = e aspas escapadas', () => {
  const m = 'let F = GoogleSheets.Contents("https://x"), '
    + 'T = F{[ name = "A ""B"" C" , ItemKind = "Table" ]}[Data] in T';
  assert.equal(detectSource(m).sheet, 'A "B" C');
});

test('detectSource: planilha sem navegação por nome fica sem aba, não chuta', () => {
  // Sem aba, o connector erra alto mandando rodar o extrator — melhor que baixar
  // a primeira aba e produzir uma tabela plausível e errada.
  assert.equal(detectSource('let F = GoogleSheets.Contents("https://x") in F').sheet, null);
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
  assert.equal(model.counts.calculated_columns, 49, 'colunas calculadas');
  assert.equal(model.counts.calculated_tables, 7, 'tabelas calculadas (partition = calculated)');
  assert.equal(model.counts.relationships, 22, 'relacionamentos (fora hierarquia de datas)');
  // datasources reais esperados
  const ids = model.datasources.map((d) => d.id);
  assert.ok(ids.includes('dbVoalle'), 'dbVoalle presente');
  assert.ok(ids.includes('dbMaria'), 'dbMaria presente');
  // toda query de expression/tabela tem id único
  const qIds = model.queries.map((q) => q.id);
  assert.equal(new Set(qIds).size, qIds.length, 'ids de query únicos');
});

test('build: nenhuma cerca ``` sobrevive no modelo real', () => {
  let pbip;
  try {
    pbip = locatePbip();
  } catch {
    console.warn('PBIP não encontrado — pulando teste de integração.');
    return;
  }
  const model = build(pbip);

  for (const f of model.measureFiles) {
    for (const m of f.measures) {
      assert.ok(!m.dax.includes('```'), `cerca no DAX de ${f.table}[${m.name}]`);
      assert.ok(m.dax.trim().length > 0, `DAX vazio em ${f.table}[${m.name}]`);
    }
  }
  for (const t of model.tableSpecs) {
    for (const c of t.columns) {
      if (!c.calculated) {
        assert.equal(c.dax, null, `coluna não calculada ${t.name}[${c.name}] com dax`);
        continue;
      }
      assert.ok(c.dax, `coluna calculada ${t.name}[${c.name}] sem DAX`);
      assert.ok(!c.dax.includes('```'), `cerca no DAX de ${t.name}[${c.name}]`);
    }
  }
  for (const q of model.queries) {
    assert.ok(!(q.m_expression || '').includes('```'), `cerca no M de ${q.id}`);
  }
});

// A tabela calculada é o outro tipo de DAX que a spec precisa carregar: aqui o
// DAX produz as LINHAS, não um valor por linha. Ficou de fora até a fase 2b.6 —
// a spec dizia `query_ref: null` e mais nada, e 'CALENDARIO INSTALADO' (por onde
// o filtro propaga) nasceria vazia contra dado real, zerando medida sem erro.
test('build: as 7 tabelas calculadas trazem o DAX que produz as linhas', () => {
  let pbip;
  try {
    pbip = locatePbip();
  } catch {
    console.warn('PBIP não encontrado — pulando teste de integração.');
    return;
  }
  const model = build(pbip);
  const calculadas = model.tableSpecs.filter((t) => t.table_dax);
  assert.deepEqual(
    calculadas.map((t) => t.name).sort(),
    [
      'BASE DE ORIGEM', 'CALENDARIO AGENDAMENTO', 'CALENDARIO CRIADO',
      'CALENDARIO INSTALADO', 'PROTOCOLOS', 'Status Protocolo Dia', 'calendar',
    ],
  );

  for (const t of calculadas) {
    assert.ok(!t.table_dax.includes('```'), `cerca no DAX da tabela ${t.name}`);
    assert.ok(t.table_dax.trim().length > 0, `DAX vazio na tabela ${t.name}`);
    assert.equal(t.query_ref, null, `${t.name} é calculada e não deveria ter query`);
  }

  // Tabela alimentada por query não pode ganhar DAX de tabela: seriam duas
  // origens para as mesmas linhas.
  for (const t of model.tableSpecs.filter((x) => x.query_ref)) {
    assert.equal(t.table_dax, null, `${t.name} tem query e DAX de tabela`);
  }

  const instalado = calculadas.find((t) => t.name === 'CALENDARIO INSTALADO');
  assert.match(instalado.table_dax, /CALENDAR\s*\(/, 'CALENDARIO INSTALADO usa CALENDAR');
  assert.match(
    instalado.table_dax,
    /'PROTOCOLOS GERAL'\[DATA INSTALAÇÃO\]/,
    'e o início do calendário depende de uma coluna CALCULADA de outra tabela',
  );
});

test('build: PESO carrega a regra de dia útil (a coluna que 6 medidas somam)', () => {
  let pbip;
  try {
    pbip = locatePbip();
  } catch {
    console.warn('PBIP não encontrado — pulando teste de integração.');
    return;
  }
  const model = build(pbip);
  const cal = model.tableSpecs.find((t) => t.name === 'CALENDARIO INSTALADO');
  const peso = cal.columns.find((c) => c.name === 'PESO');
  assert.ok(peso, 'coluna PESO existe');
  assert.match(peso.dax, /FERIADOS/, 'PESO depende da tabela FERIADOS (ver docs/ACHADOS.md)');
  assert.match(peso.dax, /DIA_SEMANA/, 'PESO depende de DIA_SEMANA');
});

test('build: relacionamentos reais aparecem e a hierarquia de datas fica contada', () => {
  let pbip;
  try {
    pbip = locatePbip();
  } catch {
    console.warn('PBIP não encontrado — pulando teste de integração.');
    return;
  }
  const model = build(pbip);

  // Nenhuma LocalDateTable_<guid> pode entrar no modelo semântico...
  for (const r of model.relationships) {
    assert.ok(!/^LocalDateTable_/.test(r.from_table), `auto-date em from: ${r.from_table}`);
    assert.ok(!/^LocalDateTable_/.test(r.to_table), `auto-date em to: ${r.to_table}`);
  }
  // ...mas também não podem sumir sem deixar rastro.
  assert.ok(model.autoDateRelationships > 0, 'hierarquia automática de datas contada');

  // Âncora concreta: o relacionamento que faz CALENDARIO INSTALADO filtrar
  // PROTOCOLOS GERAL — sem ele, medidas que cruzam as duas tabelas não podem
  // ser avaliadas.
  const chave = model.relationships.find(
    (r) => r.from_table === 'PROTOCOLOS GERAL' && r.to_table === 'CALENDARIO INSTALADO',
  );
  assert.ok(chave, 'PROTOCOLOS GERAL -> CALENDARIO INSTALADO presente');
  assert.equal(chave.from_column, 'DATA INSTALAÇÃO');
  assert.equal(chave.to_column, 'DATA INSTALADO');

  // O relacionamento inativo precisa continuar marcado como inativo: ele só
  // vale dentro de USERELATIONSHIP e tratá-lo como ativo mudaria os números.
  const inativo = model.relationships.filter((r) => !r.active);
  assert.equal(inativo.length, 1, 'exatamente um relacionamento inativo');
  assert.equal(inativo[0].from_table, 'PROTOCOLOS PRODUTIVIDADE');
});

// ---------- Unit: filtros de página e de visual ----------
//
// Cada tradução errada aqui vira número errado num visual, sem erro nenhum no
// caminho — daí uma asserção por forma de condição, não uma amostra.

test('parseLiteral cobre as 4 formas que o PBIP usa', () => {
  assert.equal(parseLiteral("'Instalado'"), 'Instalado');
  assert.equal(parseLiteral('null'), null);
  assert.equal(parseLiteral('0L'), 0);
  assert.equal(parseLiteral('true'), true);
  // Apóstrofo interno vem dobrado no PBIP.
  assert.equal(parseLiteral("'D''Oeste'"), "D'Oeste");
  assert.equal(parseLiteral("datetime'2026-01-31T00:00:00'"), '2026-01-31T00:00:00');
});

test('traduzCondicao: In vira in, e Not(In) vira not_in', () => {
  const inCond = {
    In: {
      Expressions: [{ Column: { Property: 'STATUS' } }],
      Values: [[{ Literal: { Value: "'Instalado'" } }], [{ Literal: { Value: 'null' } }]],
    },
  };
  assert.deepEqual(traduzCondicao(inCond), { op: 'in', values: ['Instalado', null] });

  // A seleção invertida do Power BI chega como Not(In) — e a diferença entre as duas
  // é o relatório inteiro: "só estes" contra "todos menos estes".
  assert.deepEqual(traduzCondicao({ Not: { Expression: inCond } }), {
    op: 'not_in',
    values: ['Instalado', null],
  });
});

test('traduzCondicao: Comparison guarda o lado esquerdo e o tipo', () => {
  const c = traduzCondicao({
    Comparison: {
      ComparisonKind: 1,
      Left: { Aggregation: { Expression: { Column: { Property: 'N°PROTOCOLO' } }, Function: 2 } },
      Right: { Literal: { Value: '0L' } },
    },
  });
  assert.equal(c.op, 'comparison');
  assert.equal(c.kind, 'gt');
  assert.equal(c.left_property, 'N°PROTOCOLO');
  // Mesmo vocabulário do campo de visual: `count`, não o número 2. Filtro e campo
  // que falam idiomas diferentes é convite a ler um pelo outro.
  assert.equal(c.left_aggregation, 'count');
  assert.equal(c.right, 0);
});

test('traduzCondicao: Not(Comparison) marca negado em vez de virar desconhecido', () => {
  // É como o Power BI escreve "não vazio": NOT(coluna = null).
  const c = traduzCondicao({
    Not: {
      Expression: {
        Comparison: {
          ComparisonKind: 0,
          Left: { Column: { Property: 'DATA INSTALADO' } },
          Right: { Literal: { Value: 'null' } },
        },
      },
    },
  });
  assert.equal(c.op, 'comparison');
  assert.equal(c.negado, true);
  assert.equal(c.right, null);
});

test('traduzCondicao: data relativa guarda o deslocamento, não a data resolvida', () => {
  // Resolver aqui congelaria "os últimos 7 dias" na data da extração — o filtro
  // passaria a significar outra coisa a cada dia que passa.
  const c = traduzCondicao({
    Between: {
      Expression: { Column: { Property: 'DATA INSTALADO' } },
      LowerBound: {
        DateSpan: {
          Expression: { DateAdd: { Expression: { Now: {} }, Amount: -7, TimeUnit: 0 } },
          TimeUnit: 0,
        },
      },
      UpperBound: { DateSpan: { Expression: { Now: {} }, TimeUnit: 0 } },
    },
  });
  assert.equal(c.op, 'between_relativo');
  assert.equal(c.property, 'DATA INSTALADO');
  assert.deepEqual(c.lower, [{ amount: -7, time_unit: 0 }]);
});

test('traduzCondicao: forma desconhecida preserva o JSON cru em vez de desaparecer', () => {
  const c = traduzCondicao({ FormaQueNaoExiste: { x: 1 } });
  assert.equal(c.op, 'desconhecido');
  assert.deepEqual(c.raw, { FormaQueNaoExiste: { x: 1 } });
});

test('extractFilters separa filtro com condição de cartão vazio', () => {
  const node = {
    filterConfig: {
      filters: [
        {
          name: 'a',
          type: 'Categorical',
          field: { Column: { Expression: { SourceRef: { Entity: 'FIELD AGENDA' } }, Property: 'Turno' } },
          filter: {
            Where: [{ Condition: { In: { Values: [[{ Literal: { Value: "'Manhã'" } }]] } } }],
          },
        },
        // Cartão de filtro aberto no Power BI e sem seleção: não muda número.
        { name: 'b', type: 'Advanced', field: { Column: { Property: 'X' } } },
      ],
    },
  };
  const { filters, filters_vazios } = extractFilters(node);
  assert.equal(filters_vazios, 1);
  assert.equal(filters.length, 1);
  assert.equal(filters[0].entity, 'FIELD AGENDA');
  assert.equal(filters[0].property, 'Turno');
  assert.deepEqual(filters[0].conditions, [{ op: 'in', values: ['Manhã'] }]);
});

test('integração: nenhum filtro do PBIP real fica sem tradução', () => {
  // A guarda que impede a Fase 3 de nascer errada. Um filtro que o extrator não
  // entende NÃO deixa de existir — ele chega como `op: desconhecido`, e este teste
  // falha dizendo em qual página e visual. O contrário (descartar em silêncio) daria
  // um card com número errado e nenhum erro no caminho.
  let pbip;
  try {
    pbip = locatePbip();
  } catch {
    console.warn('PBIP não encontrado — pulando teste de integração.');
    return;
  }
  const model = build(pbip);

  const desconhecidos = [];
  let comCondicao = 0;
  let vazios = 0;
  for (const d of model.dashboards) {
    const escopos = [
      { onde: `página ${d.id}`, f: d.filters, v: d.filters_vazios },
      ...d.visuals.map((v) => ({ onde: `${d.id}/${v.type} ${v.id}`, f: v.filters, v: v.filters_vazios })),
    ];
    for (const { onde, f, v } of escopos) {
      vazios += v ?? 0;
      for (const filtro of f ?? []) {
        comCondicao++;
        for (const c of filtro.conditions ?? []) {
          if (c.op === 'desconhecido') desconhecidos.push(`${onde}: ${JSON.stringify(c.raw)}`);
        }
      }
    }
  }

  assert.deepEqual(
    desconhecidos,
    [],
    `formas de filtro que o extrator não traduz:\n  ${desconhecidos.join('\n  ')}`,
  );
  // Prende as contagens medidas em 06/08/2026. Se subirem, alguém filtrou algo novo
  // no relatório e a paridade precisa acompanhar; se caírem, um filtro sumiu.
  assert.equal(comCondicao, 108, 'filtros que restringem de fato (6 de página + 102 de visual)');
  assert.equal(vazios, 176, 'cartões de filtro sem seleção — não mudam número');
});

// ---------- Unit: campos de visual ----------

test('descreveCampo: Aggregation guarda a função, nome e número', () => {
  // Sem a função, `agrega SOLICITACAO` não é calculável: contar distintos e contar
  // não-vazios dão números diferentes e ambos parecem certos na tela.
  const d = descreveCampo({
    Aggregation: {
      Expression: {
        Column: { Expression: { SourceRef: { Entity: 'PROTOCOLOS GERAL' } }, Property: 'CLIENTE' },
      },
      Function: 2,
    },
  });
  assert.equal(d.kind, 'aggregation');
  assert.equal(d.entity, 'PROTOCOLOS GERAL');
  assert.equal(d.property, 'CLIENTE');
  assert.equal(d.aggregation, 'count');
  // O número vem junto porque o nome é nossa leitura e o número é o dado.
  assert.equal(d.aggregation_code, 2);
});

test('descreveCampo: função fora do vocabulário fica visível', () => {
  // Mediana (6), desvio (7) e variância (8) não ocorrem hoje. Se ocorrerem, o nome
  // denuncia em vez de virar `null` e ser lido como "sem agregação".
  const d = descreveCampo({ Aggregation: { Expression: { Column: { Property: 'X' } }, Function: 6 } });
  assert.equal(d.aggregation, 'desconhecida6');
  assert.equal(d.aggregation_code, 6);
});

test('descreveCampo: HierarchyLevel resolve coluna de origem e nível', () => {
  // A hierarquia automática de datas do Power BI. Antes isto chegava com
  // entity/property nulos — 69 campos que a spec descrevia como "coluna nenhuma".
  const d = descreveCampo({
    HierarchyLevel: {
      Expression: {
        Hierarchy: {
          Expression: {
            PropertyVariationSource: {
              Expression: { SourceRef: { Entity: 'calendar' } },
              Name: 'Variation',
              Property: 'Data',
            },
          },
          Hierarchy: 'Hierarquia de datas',
        },
      },
      Level: 'Ano',
    },
  });
  assert.deepEqual(d, {
    kind: 'hierarchy_level',
    entity: 'calendar',
    property: 'Data',
    hierarchy: 'Hierarquia de datas',
    level: 'Ano',
  });
});

test('descreveCampo: Arithmetic descreve os dois lados, não vira coluna', () => {
  // `Divide(CountNonNull(x), ScopedEval(CountNonNull(x), []))` é o "% do total": o
  // denominador ignora o contexto do visual, e é o escopo vazio que diz isso.
  const agg = {
    Aggregation: {
      Expression: { Column: { Expression: { SourceRef: { Entity: 'REINCIDÊNCIA' } }, Property: 'solucao' } },
      Function: 5,
    },
  };
  const d = descreveCampo({
    Arithmetic: { Left: agg, Right: { ScopedEval: { Expression: agg, Scope: [] } }, Operator: 3 },
  });
  assert.equal(d.kind, 'arithmetic');
  assert.equal(d.operator, 'divide');
  assert.equal(d.left.aggregation, 'count_non_null');
  assert.equal(d.right.kind, 'scoped_eval');
  assert.deepEqual(d.right.scope, []);
  assert.equal(d.right.expression.aggregation, 'count_non_null');
});

test('descreveCampo: forma desconhecida preserva o JSON cru', () => {
  const d = descreveCampo({ AlgoNovo: { X: 1 } });
  assert.equal(d.kind, 'desconhecido');
  assert.deepEqual(d.raw, { AlgoNovo: { X: 1 } });
});

test('extractVisualFields usa displayName, e cai no nome da coluna quando não há', () => {
  const visual = {
    visual: {
      query: {
        queryState: {
          Values: {
            projections: [
              { field: { Measure: { Expression: { SourceRef: { Entity: 'T' } }, Property: 'M' } }, displayName: 'Rótulo' },
              { field: { Column: { Expression: { SourceRef: { Entity: 'T' } }, Property: 'C' } } },
            ],
          },
        },
      },
    },
  };
  const fs_ = extractVisualFields(visual);
  assert.equal(fs_[0].role, 'Values');
  assert.equal(fs_[0].name, 'Rótulo');
  assert.equal(fs_[1].name, 'C');
});

test('integração: todo campo de visual do PBIP real é calculável', () => {
  // Irmã da guarda dos filtros. Um campo cuja forma o extrator não conhece chega
  // como `kind: desconhecido` em vez de virar `column` com propriedade nula — que
  // era o comportamento antigo e produzia visual "sem coluna" sem ninguém notar.
  let pbip;
  try {
    pbip = locatePbip();
  } catch {
    console.warn('PBIP não encontrado — pulando teste de integração.');
    return;
  }
  const model = build(pbip);

  const problemas = [];
  const porKind = new Map();
  const porAgregacao = new Map();
  for (const d of model.dashboards) {
    for (const v of d.visuals) {
      for (const f of v.fields ?? []) {
        porKind.set(f.kind, (porKind.get(f.kind) ?? 0) + 1);
        if (f.kind === 'desconhecido') problemas.push(`${d.id}/${v.type} ${v.id}: ${JSON.stringify(f.raw)}`);
        if (f.kind === 'aggregation') {
          porAgregacao.set(f.aggregation, (porAgregacao.get(f.aggregation) ?? 0) + 1);
          if (String(f.aggregation).startsWith('desconhecida')) {
            problemas.push(`${d.id}/${v.type} ${v.id}: agregação ${f.aggregation_code} em ${f.entity}[${f.property}]`);
          }
        }
        // Campo que se refere a dado precisa dizer de onde. `arithmetic` é a
        // exceção legítima: quem tem entidade são os operandos dele.
        if (f.kind !== 'arithmetic' && f.entity === null) {
          problemas.push(`${d.id}/${v.type} ${v.id}: campo '${f.name}' (${f.kind}) sem entidade`);
        }
      }
    }
  }

  assert.deepEqual(problemas, [], `campos que a spec não descreve o bastante:\n  ${problemas.join('\n  ')}`);
  // Contagens de 06/08/2026. Prendem a distribuição: `hierarchy_level` virando
  // `column` outra vez, por exemplo, apareceria aqui e não numa medida errada.
  assert.deepEqual(
    [...porKind].sort(),
    [['aggregation', 84], ['arithmetic', 2], ['column', 252], ['hierarchy_level', 69], ['measure', 41]],
  );
  assert.deepEqual(
    [...porAgregacao].sort(),
    [['avg', 1], ['count', 34], ['count_non_null', 14], ['max', 3], ['min', 24], ['sum', 8]],
  );
});
