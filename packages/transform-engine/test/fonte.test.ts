// Testes do adaptador Query Engine -> runner de M.
//
// O teste que importa é o último: o M de `CAPACIDADE EQUIPE`, verbatim da spec,
// roda contra a navegação que o connector de Google Sheets devolve. É o que prova
// que as duas pontas se encaixam sem ninguém achatar a coluna `Data`.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import yaml from 'yaml';
import { fonteDoEngine, FonteError, type ExecutorDeQuery } from '../src/fonte.ts';
import { deLinhas, runQueries, type MQuerySpec } from '../src/runner.ts';
import { MTable } from '../src/value.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const spec = (over: Partial<MQuerySpec> = {}): MQuerySpec => ({
  id: 'q',
  name: 'Q',
  m_expression: 'let F = Odbc.Query("dsn=x","select 1") in F',
  ...over,
});

/** Executor falso com o mesmo contrato do `QueryEngine`. */
function executor(
  porId: Record<string, readonly Record<string, unknown>[] | Error>,
): ExecutorDeQuery & { chamadas: string[] } {
  const chamadas: string[] = [];
  return {
    chamadas,
    async execute(id) {
      chamadas.push(id);
      const r = porId[id];
      if (r === undefined) throw new Error(`Query não registrada: ${id}`);
      if (r instanceof Error) throw r;
      return { rows: r };
    },
  };
}

test('fonteDoEngine repassa as linhas pelo id da query', async () => {
  const eng = executor({ q: [{ ID: 1, NOME: 'x' }] });
  const linhas = await fonteDoEngine(eng)(spec());
  assert.deepEqual(linhas, [{ ID: 1, NOME: 'x' }]);
  assert.deepEqual(eng.chamadas, ['q']);
});

test('fonteDoEngine converte a coluna Data da navegação em tabela de M', async () => {
  // É o formato que o connector de planilha devolve: uma linha por aba, dados
  // dentro de `Data`. Sem esta conversão, `[Data]` daria uma lista de registros e
  // o passo seguinte (`Table.PromoteHeaders`) receberia o tipo errado.
  const eng = executor({
    q: [
      {
        name: 'STAGING',
        ItemKind: 'Table',
        Data: [
          { Column1: 'DATA', Column2: 'EQUIPE' },
          { Column1: 45000, Column2: 'A' },
        ],
      },
    ],
  });
  const linhas = await fonteDoEngine(eng)(spec());
  const dados = linhas[0].Data;
  assert.ok(dados instanceof MTable, 'Data virou MTable');
  assert.deepEqual(dados.columns, ['Column1', 'Column2']);
  assert.equal(dados.rowCount, 2);
  // Os outros campos passam intactos: o M filtra por eles.
  assert.equal(linhas[0].name, 'STAGING');
});

test('array de objetos fora da coluna Data continua recusado', async () => {
  // `jsonb` com `[{…}]` tem a mesma forma de uma grade de planilha. Converter por
  // forma daria uma tabela plausível a partir de um dado que ninguém pediu para
  // tabular; recusar deixa o caso aparecer.
  const eng = executor({ q: [{ PAYLOAD: [{ a: 1 }, { a: 2 }] }] });
  const linhas = await fonteDoEngine(eng)(spec());
  // O adaptador não mexe: passa adiante como veio…
  assert.deepEqual(linhas[0].PAYLOAD, [{ a: 1 }, { a: 2 }]);
  // …e a fronteira driver→M recusa, que é onde a decisão pertence.
  assert.throws(() => deLinhas(linhas), /não sabe representar/);
});

test('lista de escalares continua lista — não é tabela aninhada', async () => {
  const eng = executor({ q: [{ TAGS: ['a', 'b'] }] });
  const linhas = await fonteDoEngine(eng)(spec());
  assert.deepEqual(linhas[0].TAGS, ['a', 'b']);
});

test('data e null não são confundidos com tabela aninhada', async () => {
  const d = new Date(Date.UTC(2026, 0, 15));
  const eng = executor({ q: [{ D: d, N: null, VAZIO: [] }] });
  const linhas = await fonteDoEngine(eng)(spec());
  assert.equal(linhas[0].D, d);
  assert.equal(linhas[0].N, null);
  assert.deepEqual(linhas[0].VAZIO, []);
});

test('grade aninhada não retangular erra dizendo o que estava errado', async () => {
  const eng = executor({
    q: [{ name: 'A', Data: [{ Column1: 1 }, { Column1: 1, Column2: 2 }] }],
  });
  await assert.rejects(() => fonteDoEngine(eng)(spec()), /tabela aninhada inválida/);
});

test('falha de fonte vira FonteError, distinguível de erro de M', async () => {
  const eng = executor({ q: new Error('Sem connector para datasource "gsheets"') });
  await assert.rejects(
    () => fonteDoEngine(eng)(spec()),
    (err: Error) => {
      assert.ok(err instanceof FonteError);
      assert.match(err.message, /Falha ao ler a fonte da query 'q'/);
      assert.match(err.message, /Sem connector/);
      return true;
    },
  );
});

test('onBusca recebe contagem no sucesso e motivo na falha', async () => {
  const eventos: unknown[] = [];
  const eng = executor({ a: [{ X: 1 }], b: new Error('timeout') });
  const fonte = fonteDoEngine(eng, { onBusca: (e) => eventos.push(e) });
  await fonte(spec({ id: 'a' }));
  await assert.rejects(() => fonte(spec({ id: 'b' })));
  assert.deepEqual(eventos, [
    { id: 'a', linhas: 1 },
    { id: 'b', erro: 'timeout' },
  ]);
});

test('forceRefresh chega no Engine', async () => {
  const vistos: unknown[] = [];
  const eng: ExecutorDeQuery = {
    async execute(id, options) {
      vistos.push({ id, options });
      return { rows: [] };
    },
  };
  await fonteDoEngine(eng, { forceRefresh: true })(spec());
  assert.deepEqual(vistos, [{ id: 'q', options: { forceRefresh: true } }]);
});

// ───────────────────────────────────────────── ponta a ponta com o M real

/** M da spec gerada, sem reescrever nada. */
function mDaSpec(id: string): MQuerySpec {
  const p = path.join(ROOT, 'specs', '_catalog', 'queries', `${id}.spec.yaml`);
  return yaml.parse(fs.readFileSync(p, 'utf8')) as MQuerySpec;
}

test('CAPACIDADE EQUIPE roda sobre a navegação do connector, com data serial', async () => {
  const s = mDaSpec('capacidade-equipe');
  // Cabeçalho + duas linhas, como a aba STAGING chega da API: `Column1..N`,
  // primeira linha é cabeçalho (o M promove), data como número de série.
  const cabecalho = [
    'DATA', 'TÉCNICO 1', 'TÉCNICO 2', 'EQUIPE', 'BASE DE ORIGEM', 'GERENTE/SUPERVISOR',
    'CAPACIDADE MANHÃ', 'CAPACIDADE TARDE', 'COLOR', 'TÉCNICO (OPCIONAL)', 'EDITOR',
    'DATA MODIFICAÇÃO',
  ];
  // Dias desde 1899-12-30: 46037 = 2026-01-15, 45998 = 2025-12-07. A segunda cai
  // no filtro `[DATA] > #date(2025,12,31)` do M.
  const linha = (serial: number) => [
    serial, 'T1', 'T2', 'EQ', 'BASE', 'SUP', 4, 3, null, null, 'e', serial + 0.5,
  ];
  const grade = [cabecalho, linha(46037), linha(45998)];

  const eng = executor({
    'capacidade-equipe': [
      {
        name: 'STAGING',
        ItemKind: 'Table',
        Data: grade.map((l) => Object.fromEntries(l.map((v, i) => [`Column${i + 1}`, v]))),
      },
    ],
  });

  const feitas = await runQueries({
    specs: [s],
    fonte: fonteDoEngine(eng),
    culture: 'pt-BR',
  });
  const t = feitas.get('capacidade-equipe')!.tabela;

  // O filtro do M (`[DATA] > #date(2025,12,31)`) derrubou a linha de dezembro:
  // prova que a data serial virou data de verdade, não texto.
  assert.equal(t.rowCount, 1);
  assert.deepEqual(t.columns, [
    'DATA', 'TÉCNICO 1', 'TÉCNICO 2', 'EQUIPE', 'BASE DE ORIGEM', 'GERENTE/SUPERVISOR',
    'CAPACIDADE MANHÃ', 'CAPACIDADE TARDE',
  ]);
  const data = t.rows[0].get('DATA');
  assert.ok(data instanceof Date);
  assert.equal(data.toISOString().slice(0, 10), '2026-01-15');
  assert.equal(t.rows[0].get('CAPACIDADE MANHÃ'), 4);
});

test('query sem fonte externa não chama o Engine', async () => {
  // `feriados` traz a tabela embutida no M. Chamar o Engine para ela pediria um
  // connector de datasource `inline`, que não existe nem deve existir.
  const eng = executor({});
  const feitas = await runQueries({
    specs: [mDaSpec('feriados')],
    fonte: fonteDoEngine(eng),
    culture: 'pt-BR',
  });
  assert.ok(feitas.get('feriados')!.tabela.rowCount > 0);
  assert.deepEqual(eng.chamadas, [], 'nenhuma chamada ao Engine');
});
