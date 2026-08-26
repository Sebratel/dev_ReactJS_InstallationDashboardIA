// Testes do orquestrador.
//
// O teste que importa é o último: as 22 queries do escopo rodam ponta a ponta com
// linhas sintéticas, na ordem de dependência, e devolvem tabela. Sem credencial.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import yaml from 'yaml';
import { parseM } from '../src/parser.ts';
import {
  deLinhas,
  queryDependencies,
  queryOrder,
  runQueries,
  type MQuerySpec,
} from '../src/runner.ts';
import { MEvalError } from '../src/value.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HOJE = new Date(Date.UTC(2026, 7, 5, 12, 0, 0));

function corpus(): MQuerySpec[] {
  const dir = path.join(ROOT, 'specs', '_catalog', 'queries');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.spec.yaml'))
    .map((f) => yaml.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as MQuerySpec)
    .filter((s) => Boolean(s.m_expression));
}

// ───────────────────────────────────────────────── dependências

test('queryDependencies acha a query citada e não confunde com passo local', () => {
  const m = 'let Fonte = Odbc.Query("d","s"), m = Table.NestedJoin(Fonte, {"A"}, #"OUTRA Q", {"B"}, "N") in m';
  const { dependencias, orfaos } = queryDependencies(m, new Set(['OUTRA Q']));
  assert.deepEqual(dependencias, ['OUTRA Q']);
  assert.deepEqual(orfaos, []);
});

test('nome de parâmetro de função não vira dependência', () => {
  // Sem o escopo local, `x` seria contado como query externa.
  const { orfaos } = queryDependencies('let f = (x) => x + 1, r = f(1) in r', new Set());
  assert.deepEqual(orfaos, []);
});

test('nome de passo de let aninhado não vira dependência', () => {
  const { orfaos } = queryDependencies('let a = let y = 1 in y, b = a in b', new Set());
  assert.deepEqual(orfaos, []);
});

test('função não implementada aparece como órfão, não como dependência', () => {
  const { dependencias, orfaos } = queryDependencies('let a = Table.Pivot(1) in a', new Set());
  assert.deepEqual(dependencias, []);
  assert.deepEqual(orfaos, ['Table.Pivot']);
});

// ───────────────────────────────────────────────── ordenação

const q = (id: string, name: string, m: string): MQuerySpec => ({ id, name, m_expression: m });

test('queryOrder põe a dependência antes do dependente', () => {
  const ordem = queryOrder([
    q('b', 'B', 'let x = A in x'),
    q('a', 'A', 'let x = 1 in x'),
  ]);
  assert.deepEqual(ordem.map((s) => s.id), ['a', 'b']);
});

test('ciclo entre queries erra nomeando o ciclo', () => {
  assert.throws(
    () => queryOrder([q('a', 'A', 'let x = B in x'), q('b', 'B', 'let x = A in x')]),
    /Ciclo entre queries M: A → B → A|B → A → B/,
  );
});

test('órfão erra dizendo que é provável função não implementada', () => {
  assert.throws(
    () => queryOrder([q('a', 'A', 'let x = Table.Pivot(1) in x')]),
    /Table.Pivot.*não implementada/s,
  );
});

test('a ordem do corpus real coloca as 6 dependentes depois das suas fontes', () => {
  const ordem = queryOrder(corpus().filter((s) => s.id !== 'clima-tempo'));
  const posicao = new Map(ordem.map((s, i) => [s.name, i]));
  const nomes = new Set(ordem.map((s) => s.name));
  for (const s of ordem) {
    for (const dep of queryDependencies(s.m_expression!, nomes).dependencias) {
      assert.ok(
        posicao.get(dep)! < posicao.get(s.name)!,
        `${s.name} roda antes da sua dependência ${dep}`,
      );
    }
  }
});

// ───────────────────────────────────────────────── linhas da fonte

test('deLinhas usa a ordem de coluna da primeira linha', () => {
  const t = deLinhas([{ B: 1, A: 2 }, { A: 4, B: 3 }]);
  assert.deepEqual(t.columns, ['B', 'A']);
  assert.deepEqual(t.rows.map((r) => [r.get('B'), r.get('A')]), [[1, 2], [3, 4]]);
});

test('deLinhas erra se uma linha tem coluna que a primeira não tinha', () => {
  assert.throws(() => deLinhas([{ A: 1 }, { A: 2, B: 3 }]), /não é retangular/);
});

test('deLinhas converte bigint e recusa o que não cabe', () => {
  assert.equal(deLinhas([{ N: 10n }]).rows[0].get('N'), 10);
  assert.throws(() => deLinhas([{ N: 2n ** 60n }]), /sem perder precisão/);
});

test('tabela vazia da fonte não é erro', () => {
  assert.equal(deLinhas([]).rowCount, 0);
});

// ───────────────────────────────────────────────── execução

test('runQueries resolve a citação entre queries', async () => {
  const specs = [
    q('base', 'BASE', 'let F = Odbc.Query("d","s") in F'),
    q('dep', 'DEP', 'let m = Table.NestedJoin(Odbc.Query("d","s"), {"ID"}, BASE, {"ID"}, "N", JoinKind.Inner),' +
      ' x = Table.ExpandTableColumn(m, "N", {"V"}, {"V"}) in x'),
  ];
  const feitas = await runQueries({
    specs,
    agora: HOJE,
    fonte: async (s) =>
      s.id === 'base' ? [{ ID: 1, V: 'da base' }] : [{ ID: 1 }],
  });
  assert.deepEqual([...feitas.keys()], ['base', 'dep']);
  const dep = feitas.get('dep')!.tabela;
  assert.deepEqual(dep.columns, ['ID', 'V']);
  assert.equal(dep.rows[0].get('V'), 'da base');
});

test('`apenas` roda a query pedida e as dependências dela, e mais nada', async () => {
  const buscadas: string[] = [];
  const specs = [
    q('a', 'A', 'let F = Odbc.Query("d","s") in F'),
    q('b', 'B', 'let x = A in x'),
    q('c', 'C', 'let F = Odbc.Query("d","s") in F'),
  ];
  const feitas = await runQueries({
    specs,
    apenas: ['b'],
    fonte: async (s) => {
      buscadas.push(s.id);
      return [{ ID: 1 }];
    },
  });
  assert.deepEqual([...feitas.keys()].sort(), ['a', 'b']);
  assert.ok(!buscadas.includes('c'), 'C não deveria ter sido buscada');
});

test('query pedida que não existe erra dizendo o id', async () => {
  await assert.rejects(
    () => runQueries({ specs: [q('a', 'A', 'let x = 1 in x')], apenas: ['zz'], fonte: async () => [] }),
    /Query 'zz' não está nas specs/,
  );
});

test('query que não devolve tabela erra — toda query do modelo vira tabela', async () => {
  await assert.rejects(
    () => runQueries({ specs: [q('a', 'A', 'let x = 1 in x')], fonte: async () => [] }),
    /não é tabela/,
  );
});

test('feriados roda inteira sem fonte externa: base64 + deflate + JSON', async () => {
  // É a única query do escopo cuja tabela está embutida no próprio M. Se isto
  // passa, as três funções binárias estão certas contra dado real do PBIP.
  const spec = corpus().find((s) => s.id === 'feriados');
  assert.ok(spec, 'feriados saiu do corpus');
  const feitas = await runQueries({
    specs: [spec!],
    agora: HOJE,
    fonte: async () => [],
  });
  const t = feitas.get('feriados')!.tabela;
  assert.ok(t.rowCount > 0, 'feriados deveria ter linhas');
  assert.ok(t.columns.length > 0);
});

test('as 22 queries do escopo rodam ponta a ponta com linha sintética', async () => {
  // Sintética, mas não arbitrária: as colunas vêm do que o próprio M cita, então
  // cada passo encontra o que procura. O que se prova é que os 303 passos
  // executam e produzem tabela — não que os valores estão certos, que é 2b.9.
  const specs = corpus().filter((s) => s.id !== 'clima-tempo');
  const feitas = await runQueries({
    specs,
    agora: HOJE,
    fonte: async (s) => linhasSinteticas(s.m_expression!),
  });
  assert.equal(feitas.size, 22);
  for (const [id, r] of feitas) {
    assert.ok(r.tabela.columns.length > 0, `${id} devolveu tabela sem coluna`);
    assert.ok(r.passos.size > 0, `${id} não registrou passos`);
  }
});

/**
 * Duas linhas com todas as colunas que o M da query menciona.
 *
 * O valor é escolhido pelo tipo que o próprio M pede em
 * `Table.TransformColumnTypes`: o engine recusa conversão implícita, então um
 * texto onde a query declara `type datetime` faria o passo errar alto — que é o
 * comportamento certo, e aqui atrapalharia o teste de execução.
 */
function linhasSinteticas(m: string): Record<string, unknown>[] {
  const tipos = new Map<string, string>();
  const colunas = new Set<string>();
  const anda = (no: unknown): void => {
    if (typeof no !== 'object' || no === null) return;
    const n = no as { type?: string; field?: string; callee?: { name?: string }; args?: unknown[] };
    if (n.type === 'Field' && n.field) colunas.add(n.field);
    // `Table.TransformColumnTypes(t, {{"COL", type X}, …})`: pega o par.
    if (n.type === 'Call' && n.callee?.name === 'Table.TransformColumnTypes') {
      const lista = n.args?.[1] as { items?: unknown[] } | undefined;
      for (const item of lista?.items ?? []) {
        const par = item as { items?: { value?: string; name?: string }[] };
        const nome = par.items?.[0]?.value;
        const tipo = par.items?.[1]?.name;
        if (typeof nome === 'string') {
          colunas.add(nome);
          if (tipo) tipos.set(nome, tipo);
        }
      }
    }
    // Toda função que recebe nome de coluna como texto literal.
    if (n.type === 'Call' && /^Table\./.test(n.callee?.name ?? '')) {
      for (const a of n.args ?? []) coleta(a, colunas);
      // Nome que o próprio M **cria** não pode vir da fonte, senão o passo que o
      // cria falha com "coluna já existe".
      const fn = n.callee?.name ?? '';
      const arg = (i: number): unknown => n.args?.[i];
      if (fn === 'Table.AddColumn') coleta(arg(1), criadas);
      if (fn === 'Table.DuplicateColumn') coleta(arg(2), criadas);
      if (fn === 'Table.NestedJoin') coleta(arg(4), criadas);
      if (fn === 'Table.ExpandTableColumn') coleta(arg(3) ?? arg(2), criadas);
      if (fn === 'Table.SplitColumn') coleta(arg(3), criadas);
      if (fn === 'Table.RenameColumns') {
        const lista = arg(1) as { items?: { items?: { value?: unknown }[] }[] } | undefined;
        for (const par of lista?.items ?? []) {
          const para = par.items?.[1]?.value;
          if (typeof para === 'string') criadas.add(para);
        }
      }
    }
    for (const v of Object.values(no) as unknown[]) {
      if (Array.isArray(v)) for (const x of v) anda(x);
      else anda(v);
    }
  };
  anda(parseM(m));

  const valor = (col: string): unknown => {
    const t = (tipos.get(col) ?? '').replace(/^nullable\s+/, '');
    if (/^(date|datetime|datetimezone|time)$/.test(t) || /^(Date|DateTime|DateTimeZone|Time)\.Type$/.test(t)) {
      return new Date(Date.UTC(2026, 0, 15, 8, 30, 0));
    }
    if (/^(number|Int64\.Type|Int32\.Type|Percentage\.Type|Currency\.Type|Double\.Type|Number\.Type)$/.test(t)) {
      return 1;
    }
    if (/^(logical|Logical\.Type)$/.test(t)) return true;
    if (/^(duration|Duration\.Type)$/.test(t)) return null;
    return `v ${col}`;
  };
  const uma = (): Record<string, unknown> => Object.fromEntries([...colunas].map((c) => [c, valor(c)]));
  return [uma(), uma()];
}

/** Strings literais dentro de listas e argumentos — são nomes de coluna. */
function coleta(no: unknown, dentro: Set<string>): void {
  if (typeof no !== 'object' || no === null) return;
  const n = no as { type?: string; value?: unknown; items?: unknown[] };
  if (n.type === 'Literal' && typeof n.value === 'string') dentro.add(n.value);
  if (n.type === 'List') for (const x of n.items ?? []) coleta(x, dentro);
}

test('erro de execução é MEvalError, para o chamador distinguir de falha de rede', async () => {
  await assert.rejects(
    () => runQueries({ specs: [q('a', 'A', 'let x = Table.Pivot(1) in x')], fonte: async () => [] }),
    MEvalError,
  );
});
