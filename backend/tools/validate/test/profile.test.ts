import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGolden,
  dataFingerprint,
  diffGolden,
  normalizeSql,
  profileColumn,
  profileRows,
  schemaFingerprint,
  wrapCount,
  wrapSample,
} from '../src/profile.ts';

const AT = '2026-08-04T12:00:00.000Z';

test('profileColumn: numéricos ganham soma; min/max exige --include-values', () => {
  const p = profileColumn('VALOR', [10, 20, null, 30]);
  assert.equal(p.type, 'number');
  assert.equal(p.nulls, 1);
  assert.equal(p.distinct, 3);
  assert.equal(p.sum, 60, 'soma é agregado — segura por padrão');
  assert.equal(p.min, undefined, 'min de número é valor de um registro (ex.: CPF)');
  assert.equal(p.max, undefined);

  const comValores = profileColumn('VALOR', [10, 20, null, 30], true);
  assert.equal(comValores.min, 10);
  assert.equal(comValores.max, 30);
});

test('profileColumn: CPF em coluna numérica não vaza no golden padrão', () => {
  const p = profileColumn('CPF', ['12345678901', '10987654321']);
  assert.equal(p.numericString, true);
  const json = JSON.stringify(p);
  assert.ok(!json.includes('12345678901'), 'min/max não pode expor o CPF');
  assert.ok(!json.includes('10987654321'));
});

test('profileColumn: soma arredonda para não sofrer com float binário', () => {
  const p = profileColumn('V', [0.1, 0.2]);
  assert.equal(p.sum, 0.3);
});

test('profileColumn: numeric do pg vem como string e é reconhecido', () => {
  // pg entrega numeric/bigint como string; sem isso toda coluna de valor
  // monetário perderia a soma, que é justamente o que valida paridade.
  const p = profileColumn('TOTAL', ['10.5', '20.25']);
  assert.equal(p.type, 'string');
  assert.equal(p.numericString, true);
  assert.equal(p.sum, 30.75);
});

test('profileColumn: string comum guarda comprimento, nunca o valor', () => {
  const p = profileColumn('CLIENTE', ['Maria', 'Joao da Silva']);
  assert.equal(p.type, 'string');
  assert.equal(p.numericString, undefined);
  assert.equal(p.minLength, 5);
  assert.equal(p.maxLength, 13);
  assert.equal(p.values, undefined, 'sem --include-values não grava valor');
  const json = JSON.stringify(p);
  assert.ok(!json.includes('Maria'), 'nome de cliente não pode entrar no golden');
  assert.ok(!json.includes('Joao'), 'nome de cliente não pode entrar no golden');
});

test('profileColumn: datas viram min/max ISO', () => {
  const p = profileColumn('DATA', [new Date('2024-03-01T00:00:00Z'), new Date('2026-01-15T00:00:00Z')]);
  assert.equal(p.type, 'date');
  assert.equal(p.min, '2024-03-01T00:00:00.000Z');
  assert.equal(p.max, '2026-01-15T00:00:00.000Z');
});

test('profileColumn: coluna toda nula tem type null', () => {
  const p = profileColumn('X', [null, null, undefined]);
  assert.equal(p.type, 'null');
  assert.equal(p.nulls, 3);
  assert.equal(p.distinct, 0);
});

test('profileColumn: tipos misturados viram mixed', () => {
  const p = profileColumn('X', [1, 'a', true]);
  assert.equal(p.type, 'mixed');
});

test('profileColumn: --include-values só em baixa cardinalidade', () => {
  const baixa = profileColumn('POSICAO', ['TERCEIRO', 'EFETIVO', 'EFETIVO'], true);
  assert.deepEqual(baixa.values, ['EFETIVO', 'TERCEIRO']);

  const alta = profileColumn('PROTOCOLO', Array.from({ length: 40 }, (_, i) => `p${i}`), true);
  assert.equal(alta.values, undefined, 'alta cardinalidade não grava valores');
  assert.equal(alta.distinct, 40);
});

test('profileRows: colunas são a união das chaves, na ordem de aparição', () => {
  const cols = profileRows([{ a: 1 }, { b: 2, a: 3 }]);
  assert.deepEqual(cols.map((c) => c.name), ['a', 'b']);
  // 'b' ausente na primeira linha conta como nulo
  assert.equal(cols[1].nulls, 1);
});

test('profileRows: sem linhas, sem colunas', () => {
  assert.deepEqual(profileRows([]), []);
});

test('fingerprints: dataFingerprint independe da ordem das linhas', () => {
  const rows = [{ a: 1, d: 'x' }, { a: 2, d: 'y' }, { a: 3, d: 'z' }];
  const direto = buildGolden({
    queryId: 'q', datasource: 'dbVoalle', strategy: 'wrapped',
    rowCount: 3, truncated: false, rows, capturedAt: AT,
  });
  const invertido = buildGolden({
    queryId: 'q', datasource: 'dbVoalle', strategy: 'wrapped',
    rowCount: 3, truncated: false, rows: [...rows].reverse(), capturedAt: AT,
  });
  assert.equal(direto.dataFingerprint, invertido.dataFingerprint,
    'sem ORDER BY no SQL a ordem varia — o fingerprint não pode depender dela');
  assert.equal(direto.schemaFingerprint, invertido.schemaFingerprint);
});

test('fingerprints: schema muda quando o tipo da coluna muda', () => {
  const a = schemaFingerprint(profileRows([{ v: 1 }]));
  const b = schemaFingerprint(profileRows([{ v: 'texto nao numerico' }]));
  assert.notEqual(a, b);
});

test('fingerprints: dados mudam quando um agregado muda', () => {
  const a = dataFingerprint(2, profileRows([{ v: 1 }, { v: 2 }]));
  const b = dataFingerprint(2, profileRows([{ v: 1 }, { v: 99 }]));
  assert.notEqual(a, b);
});

// ------------------------------------------------- agregados de amostra

test('buildGolden: marca columnsFromSample quando o perfil não cobriu tudo', () => {
  const parcial = buildGolden({
    queryId: 'q', datasource: 'dbVoalle', strategy: 'wrapped',
    rowCount: 232994, truncated: false, rows: [{ a: 1 }], capturedAt: AT,
  });
  assert.equal(parcial.columnsFromSample, true);
  assert.equal(parcial.profiledRows, 1);

  const completo = buildGolden({
    queryId: 'q', datasource: 'dbVoalle', strategy: 'wrapped',
    rowCount: 1, truncated: false, rows: [{ a: 1 }], capturedAt: AT,
  });
  assert.equal(completo.columnsFromSample, false);
});

test('agregados de amostra ficam fora do dataFingerprint', () => {
  // Mesma query, mesmo total, amostras diferentes — porque o SQL não tem ORDER
  // BY e o banco devolveu outra ordem. Isso NÃO pode contar como mudança.
  const base = {
    queryId: 'base-categorias-field', datasource: 'dbVoalle',
    strategy: 'wrapped' as const, rowCount: 232994, truncated: false, capturedAt: AT,
  };
  const primeira = buildGolden({ ...base, rows: [{ DATA: new Date('2026-01-03') }] });
  const segunda = buildGolden({ ...base, rows: [{ DATA: new Date('2026-08-04') }] });

  assert.equal(primeira.columnsFromSample, true);
  assert.equal(
    primeira.dataFingerprint,
    segunda.dataFingerprint,
    'amostra diferente com o mesmo total não é mudança de dados',
  );
  assert.deepEqual(diffGolden(primeira, segunda), [], '--check não pode acusar regressão aqui');
});

test('com perfil completo os agregados voltam a contar', () => {
  const base = {
    queryId: 'q', datasource: 'dbVoalle', strategy: 'wrapped' as const,
    rowCount: 1, truncated: false, capturedAt: AT,
  };
  const a = buildGolden({ ...base, rows: [{ V: 10 }] });
  const b = buildGolden({ ...base, rows: [{ V: 99 }] });
  assert.equal(a.columnsFromSample, false);
  assert.notEqual(a.dataFingerprint, b.dataFingerprint);
});

test('rowCount ainda pega mudança real, mesmo com agregados de amostra', () => {
  const base = {
    queryId: 'q', datasource: 'dbVoalle', strategy: 'wrapped' as const,
    truncated: false, rows: [{ a: 1 }], capturedAt: AT,
  };
  const antes = buildGolden({ ...base, rowCount: 1000 });
  const depois = buildGolden({ ...base, rowCount: 1001 });
  const diffs = diffGolden(antes, depois);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].severity, 'data');
  assert.ok(diffs[0].message.includes('1000 -> 1001'));
});

test('buildGolden: capturedAt não entra nos fingerprints', () => {
  const base = {
    queryId: 'q', datasource: 'dbVoalle', strategy: 'wrapped' as const,
    rowCount: 1, truncated: false, rows: [{ a: 1 }],
  };
  const g1 = buildGolden({ ...base, capturedAt: AT });
  const g2 = buildGolden({ ...base, capturedAt: '2030-01-01T00:00:00.000Z' });
  assert.equal(g1.dataFingerprint, g2.dataFingerprint);
  assert.equal(g1.schemaFingerprint, g2.schemaFingerprint);
});

// ------------------------------------------------------------------ diff

function golden(rows: Record<string, unknown>[], rowCount = rows.length) {
  return buildGolden({
    queryId: 'q', datasource: 'dbVoalle', strategy: 'wrapped',
    rowCount, truncated: false, rows, capturedAt: AT,
  });
}

test('diffGolden: idêntico não gera diff', () => {
  assert.deepEqual(diffGolden(golden([{ a: 1 }]), golden([{ a: 1 }])), []);
});

test('diffGolden: coluna removida é regressão de schema', () => {
  const diffs = diffGolden(golden([{ a: 1, b: 2 }]), golden([{ a: 1 }]));
  assert.ok(diffs.some((d) => d.severity === 'schema' && d.message.includes('removida')));
});

test('diffGolden: coluna nova é regressão de schema', () => {
  const diffs = diffGolden(golden([{ a: 1 }]), golden([{ a: 1, novo: 2 }]));
  assert.ok(diffs.some((d) => d.severity === 'schema' && d.message.includes('nova')));
});

test('diffGolden: troca de tipo é regressão de schema', () => {
  const diffs = diffGolden(golden([{ a: 1 }]), golden([{ a: 'texto nao numerico' }]));
  assert.ok(diffs.some((d) => d.severity === 'schema' && d.message.includes('tipo')));
});

test('diffGolden: reordenar colunas é regressão de schema', () => {
  const antes = golden([{ a: 1, b: 2 }]);
  const depois = golden([{ b: 2, a: 1 }]);
  const diffs = diffGolden(antes, depois);
  assert.ok(diffs.some((d) => d.severity === 'schema' && d.message.includes('ordem')));
});

test('diffGolden: linha nova é mudança de dados, não de schema', () => {
  const diffs = diffGolden(golden([{ a: 1 }]), golden([{ a: 1 }, { a: 2 }]));
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].severity, 'data');
  assert.ok(diffs[0].message.includes('rowCount'));
});

test('diffGolden: mesmo rowCount com agregado diferente é mudança de dados', () => {
  const diffs = diffGolden(golden([{ a: 1 }]), golden([{ a: 2 }]));
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].severity, 'data');
  assert.ok(diffs[0].message.includes('agregados'));
});

// ------------------------------------------------------------------ SQL

test('normalizeSql: remove ; final', () => {
  assert.equal(normalizeSql('select 1 ;  '), 'select 1');
});

test('wrapCount: comentário na última linha não engole o parêntese', () => {
  const sql = "select * from t where id = 1 --- comentario do PBIP";
  const wrapped = wrapCount(sql);
  assert.ok(wrapped.includes('\n) as _t'), 'o ) precisa cair numa linha nova');
  const ultimaLinha = wrapped.split('\n').at(-1)!;
  assert.ok(!ultimaLinha.includes('---'));
});

test('wrapSample: limit é inteiro validado, não interpolação livre', () => {
  assert.ok(wrapSample('select 1', 100).endsWith('limit 100'));
  // blindagem: limite não-inteiro nunca chega ao SQL
  assert.throws(() => wrapSample('select 1', '5; drop table x' as unknown as number), /inválido/);
  assert.throws(() => wrapSample('select 1', 0), /inválido/);
  assert.throws(() => wrapSample('select 1', 1.5), /inválido/);
});
