// O valor de um filtro NUNCA pode virar SQL. Estes testes travam essa garantia.
//
// A regra 3 do projeto tem quatro camadas contra escrita; esta é uma camada
// diferente, contra *leitura do conjunto errado* — e contra o dia em que um
// recorte da tela virar `WHERE`. Ver o cabeçalho de `connectors-sql.ts`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mariaRunner, postgresRunner, traduzParametros } from '../src/connectors-sql.ts';

const PG = (n: number) => `$${n}`;
const MY = () => '?';

// ------------------------------------------------------------------ tradução

test('traduzParametros: sem params, o texto sai como entrou', () => {
  const sql = 'select a from t where b = :nao_e_parametro';
  assert.deepEqual(traduzParametros(sql, undefined, PG), { text: sql, values: [] });
  assert.deepEqual(traduzParametros(sql, {}, PG), { text: sql, values: [] });
});

test('traduzParametros: :nome vira $1..$n na ordem de uso', () => {
  const r = traduzParametros(
    'select * from p where equipe = :equipe and dia >= :inicio',
    { equipe: 'FIELD 1', inicio: '2026-08-01' },
    PG,
  );
  assert.equal(r.text, 'select * from p where equipe = $1 and dia >= $2');
  assert.deepEqual(r.values, ['FIELD 1', '2026-08-01']);
});

test('traduzParametros: MariaDB usa ? e mantém a ordem', () => {
  const r = traduzParametros('select * from t where a = :a and b = :b', { a: 1, b: 2 }, MY);
  assert.equal(r.text, 'select * from t where a = ? and b = ?');
  assert.deepEqual(r.values, [1, 2]);
});

test('traduzParametros: o mesmo nome duas vezes vira dois marcadores e dois valores', () => {
  // `$1` repetido funcionaria no Postgres, mas `?` do MySQL é posicional: uma
  // regra só, e a que serve aos dois.
  const r = traduzParametros('select * from t where a = :x or b = :x', { x: 7 }, PG);
  assert.equal(r.text, 'select * from t where a = $1 or b = $2');
  assert.deepEqual(r.values, [7, 7]);
});

test('traduzParametros: `::time` é cast, não parâmetro', () => {
  // Três queries do catálogo dependem do cast. Tratá-lo como parâmetro quebraria
  // as três por um motivo que não é delas.
  const r = traduzParametros(
    "select (data_agenda::time) as hora from f where equipe = :equipe",
    { equipe: 'A' },
    PG,
  );
  assert.equal(r.text, "select (data_agenda::time) as hora from f where equipe = $1");
  assert.deepEqual(r.values, ['A']);
});

test('traduzParametros: não substitui dentro de literal, de identificador ou de comentário', () => {
  const sql = [
    "select 'texto com :nome dentro' as a,",
    '       "coluna :nome" as b,',
    '       c -- :nome no comentario de linha',
    '       /* :nome no comentario de bloco */',
    'from t where d = :real',
  ].join('\n');
  const r = traduzParametros(sql, { real: 1 }, PG);
  assert.ok(r.text.includes("'texto com :nome dentro'"), 'literal preservado');
  assert.ok(r.text.includes('"coluna :nome"'), 'identificador preservado');
  assert.ok(r.text.includes('-- :nome no comentario de linha'), 'comentário de linha preservado');
  assert.ok(r.text.includes('/* :nome no comentario de bloco */'), 'comentário de bloco preservado');
  assert.ok(r.text.endsWith('d = $1'));
  assert.deepEqual(r.values, [1]);
});

test("traduzParametros: aspa duplicada ('') não fecha o literal", () => {
  const r = traduzParametros("select 'n''ao :nome' , x from t where y = :y", { y: 2 }, PG);
  assert.ok(r.text.includes("'n''ao :nome'"));
  assert.deepEqual(r.values, [2]);
});

test('traduzParametros: dois-pontos que não inicia identificador fica como está', () => {
  const r = traduzParametros('select arr[1:3] from t where a = :a', { a: 1 }, PG);
  assert.ok(r.text.includes('arr[1:3]'));
  assert.deepEqual(r.values, [1]);
});

// ------------------------------------------------------------------ erra alto

test('traduzParametros: nome citado no SQL e ausente em params derruba', () => {
  assert.throws(
    () => traduzParametros('select * from t where a = :faltando', { outro: 1 }, PG),
    /faltando/,
  );
});

test('traduzParametros: parâmetro que veio e não foi usado derruba', () => {
  // Silenciar isso devolveria a consulta SEM o recorte pedido — número plausível
  // e errado, que é o que este projeto não pode produzir.
  assert.throws(
    () => traduzParametros('select * from t', { equipe: 'FIELD 1' }, PG),
    /sem uso no SQL/,
  );
});

// ------------------------------------------------------- o valor não vira SQL

test('postgresRunner: injeção no valor chega ao driver como valor, não como SQL', async () => {
  let visto: { text: string; values?: unknown[] } | null = null;
  const runner = postgresRunner({
    async query(c) {
      visto = c;
      return { rows: [], fields: [] };
    },
    async end() {},
  });

  const ataque = "x'; DROP TABLE alunos; --";
  await runner('select * from t where nome = :nome', { nome: ataque });

  assert.equal(visto!.text, 'select * from t where nome = $1');
  assert.deepEqual(visto!.values, [ataque]);
  assert.ok(!visto!.text.includes('DROP'), 'o texto enviado não pode conter o ataque');
});

test('postgresRunner: sem parâmetro, não manda values (protocolo simples, como antes)', async () => {
  let visto: { text: string; values?: unknown[] } | null = null;
  const runner = postgresRunner({
    async query(c) {
      visto = c;
      return { rows: [], fields: [] };
    },
    async end() {},
  });
  await runner('select 1');
  assert.equal(visto!.values, undefined);
});

test('postgresRunner: assertReadOnly roda sobre o texto traduzido', async () => {
  let chamou = false;
  const runner = postgresRunner({
    async query() {
      chamou = true;
      return { rows: [], fields: [] };
    },
    async end() {},
  });
  await assert.rejects(() => runner('delete from t where a = :a', { a: 1 }), /somente-leitura/);
  assert.equal(chamou, false, 'não pode chegar no banco');
});

test('mariaRunner: com parâmetro usa execute (prepared), não query', async () => {
  const chamadas: string[] = [];
  let vistos: unknown[] = [];
  const runner = mariaRunner({
    async query() {
      chamadas.push('query');
      return [[], null];
    },
    async execute(sql, values) {
      chamadas.push('execute');
      vistos = values;
      assert.equal(sql, 'select * from Installation_Teams where nome = ?');
      return [[], null];
    },
    async end() {},
  });

  const ataque = "a'; DROP TABLE Installation_Teams; --";
  await runner('select * from Installation_Teams where nome = :nome', { nome: ataque });
  assert.deepEqual(chamadas, ['execute']);
  assert.deepEqual(vistos, [ataque]);
});

test('mariaRunner: sem parâmetro continua em query, como antes', async () => {
  const chamadas: string[] = [];
  const runner = mariaRunner({
    async query() {
      chamadas.push('query');
      return [[], null];
    },
    async execute() {
      chamadas.push('execute');
      return [[], null];
    },
    async end() {},
  });
  await runner('select 1');
  assert.deepEqual(chamadas, ['query']);
});

test('mariaRunner: pool sem execute recebendo parâmetro derruba em vez de concatenar', async () => {
  const runner = mariaRunner({
    async query() {
      return [[], null];
    },
    async end() {},
  });
  await assert.rejects(() => runner('select * from t where a = :a', { a: 1 }), /execute\(\)/);
});
