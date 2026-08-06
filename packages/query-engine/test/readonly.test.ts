// A plataforma NUNCA pode escrever no ERP. Estes testes travam essa garantia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertReadOnly, postgresRunner, mariaRunner, nomesSemDuplicata } from '../src/connectors-sql.ts';
import { loadDotEnv } from '../src/config.ts';

test('assertReadOnly: permite SELECT e CTE de leitura', () => {
  assertReadOnly('select 1');
  assertReadOnly('SELECT a, b FROM contracts WHERE x = 1');
  assertReadOnly('with p as (select 1) select * from p');
  assertReadOnly('select * from t order by a; '); // ponto-e-vírgula final é ok
});

test('assertReadOnly: bloqueia comandos de escrita', () => {
  const proibidos = [
    'insert into t values (1)',
    'update t set a = 1',
    'delete from t',
    'drop table t',
    'truncate t',
    'alter table t add column c int',
    'create table t (a int)',
    'grant select on t to u',
    'revoke select on t from u',
  ];
  for (const sql of proibidos) {
    assert.throws(() => assertReadOnly(sql), /somente-leitura/, `deveria bloquear: ${sql}`);
  }
});

test('assertReadOnly: bloqueia escrita escondida depois de SELECT', () => {
  assert.throws(() => assertReadOnly('select 1; drop table alunos'), /somente-leitura|múltiplos/);
});

test('assertReadOnly: bloqueia múltiplos statements', () => {
  assert.throws(() => assertReadOnly('select 1; select 2'), /múltiplos statements/);
});

test('assertReadOnly: não confunde palavra proibida dentro de string ou comentário', () => {
  // "update" aparece só como dado/comentário — deve passar
  assertReadOnly("select * from logs where acao = 'update'");
  assertReadOnly('select a from t -- update depois\n');
  assertReadOnly('/* delete antigo */ select 1');
});

test('assertReadOnly: não confunde coluna cujo nome contém palavra proibida', () => {
  assertReadOnly('select created, updated_at from t');
  assertReadOnly('select p.deleted_flag from people p');
});

test('postgresRunner: recusa SQL de escrita antes de tocar o banco', async () => {
  let chamou = false;
  const runner = postgresRunner({
    async query() {
      chamou = true;
      return { rows: [], fields: [] };
    },
    async end() {},
  });
  await assert.rejects(() => runner('delete from contracts'), /somente-leitura/);
  assert.equal(chamou, false, 'não pode chegar no banco');
});

test('mariaRunner: recusa SQL de escrita antes de tocar o banco', async () => {
  let chamou = false;
  const runner = mariaRunner({
    async query() {
      chamou = true;
      return [[], null];
    },
    async end() {},
  });
  await assert.rejects(() => runner('update Installation_Teams set x = 1'), /somente-leitura/);
  assert.equal(chamou, false, 'não pode chegar no banco');
});

test('postgresRunner: SELECT passa e devolve as linhas', async () => {
  const runner = postgresRunner({
    async query(c) {
      assert.equal(c.text, 'select 1');
      assert.equal(c.rowMode, 'array', 'precisa do modo array para não colar coluna repetida');
      return { rows: [[1]], fields: [{ name: 'n' }] };
    },
    async end() {},
  });
  assert.deepEqual(await runner('select 1'), [{ n: 1 }]);
});

test('postgresRunner: coluna repetida no SELECT vira nome+ocorrência, como o Power Query faz', () => {
  // ACHADOS.md #19: `ssc3.title categoria3, ssc4.title categoria3` no SQL de
  // `base-categorias-field` chega ao driver como duas colunas chamadas
  // `categoria3`. O modo objeto do `pg` colaria as duas e perderia a de ssc3
  // antes até de o M rodar; é isso que este teste impede.
  assert.deepEqual(nomesSemDuplicata(['protocol', 'categoria1', 'categoria2', 'categoria3', 'categoria3', 'categoria5']), [
    'protocol',
    'categoria1',
    'categoria2',
    'categoria3',
    'categoria32',
    'categoria5',
  ]);
});

test('postgresRunner: monta a linha com as colunas repetidas preservadas', async () => {
  const runner = postgresRunner({
    async query() {
      return {
        rows: [['P1', 'A', 'B']],
        fields: [{ name: 'protocol' }, { name: 'categoria3' }, { name: 'categoria3' }],
      };
    },
    async end() {},
  });
  assert.deepEqual(await runner('select protocol, categoria3, categoria3 from t'), [
    { protocol: 'P1', categoria3: 'A', categoria32: 'B' },
  ]);
});

// ---------------------------------------------------------------- .env

test('loadDotEnv: lê pares, ignora comentários e remove aspas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apenv-'));
  const file = path.join(dir, '.env');
  fs.writeFileSync(
    file,
    ['# comentario', '', 'A=1', 'B = dois ', 'C="com aspas"', "D='simples'", 'E=a=b', 'lixo'].join('\n'),
  );
  const env = loadDotEnv(file);
  assert.equal(env.A, '1');
  assert.equal(env.B, 'dois');
  assert.equal(env.C, 'com aspas');
  assert.equal(env.D, 'simples');
  assert.equal(env.E, 'a=b', 'só o primeiro = separa');
  assert.equal(env.lixo, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('loadDotEnv: arquivo ausente devolve objeto vazio', () => {
  assert.deepEqual(loadDotEnv(path.join(os.tmpdir(), 'nao-existe-x9.env')), {});
});
