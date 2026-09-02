// Testes do orquestrador.
//
// O teste que importa é o último: as 23 queries do escopo rodam ponta a ponta com
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
  usaFonteExterna,
  type MQuerySpec,
} from '../src/runner.ts';
import { MDuration, MEvalError } from '../src/value.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HOJE = new Date(Date.UTC(2026, 7, 5, 12, 0, 0));

/** Culture do modelo, da spec gerada. `feriados` depende dela. */
function cultureDoModelo(): string | null {
  const m = yaml.parse(
    fs.readFileSync(path.join(ROOT, 'specs', '_catalog', 'model.yaml'), 'utf8'),
  ) as { culture?: string | null };
  return m.culture ?? null;
}

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

test('interval do Postgres vira duration — medido contra o driver pg', () => {
  // Forma real do `PostgresInterval` (`node --test` não tem banco, então o objeto é
  // reproduzido): só os campos não-zero como propriedade própria, e `toPostgres` no
  // protótipo — é por isso que ele não aparece em `Object.keys`.
  const proto = { toPostgres: () => 'x' };
  const intervalo = (campos: Record<string, number>) => Object.assign(Object.create(proto), campos);

  const t = deLinhas([
    { I: intervalo({ days: 201, hours: 3, minutes: 30 }) },
    { I: intervalo({ milliseconds: 250 }) },
    { I: intervalo({}) },
  ]);
  const ms = t.rows.map((r) => (r.get('I') as MDuration).ms);
  assert.deepEqual(ms, [201 * 86_400_000 + 3 * 3_600_000 + 30 * 60_000, 250, 0]);
});

test('interval com mês erra alto: mês não tem duração fixa', () => {
  const comMes = Object.assign(Object.create({ toPostgres: () => '2 mons 3 days' }), {
    months: 2,
    days: 3,
  });
  assert.throws(() => deLinhas([{ I: comMes }]), /mês não tem duração fixa/);
});

test('objeto sem toPostgres continua recusado — jsonb não é duration', () => {
  // `{}` de um `jsonb` é indistinguível de intervalo zero pelos campos; o que
  // separa os dois é o método do driver.
  assert.throws(() => deLinhas([{ J: {} }]), /não sabe representar/);
  assert.throws(() => deLinhas([{ J: { days: 1 } }]), /não sabe representar/);
});

test('usaFonteExterna separa quem lê fonte de quem traz a tabela embutida', () => {
  assert.equal(usaFonteExterna('let F = Odbc.Query("dsn=x","select 1") in F'), true);
  assert.equal(usaFonteExterna('let F = GoogleSheets.Contents("https://x") in F'), true);
  assert.equal(usaFonteExterna('let F = DateTime.LocalNow() in F'), false);
  // Nome de passo parecido não conta: quem decide é o identificador na expressão.
  assert.equal(usaFonteExterna('let #"Odbc.Query fake" = 1, b = #"Odbc.Query fake" in b'), false);
});

test('query que não lê fonte não chama a fonte injetada', async () => {
  let chamou = false;
  await runQueries({
    specs: [q('a', 'A', 'let F = #table({"X"}, {{1}}) in F')],
    fonte: async () => {
      chamou = true;
      return [];
    },
  });
  assert.equal(chamou, false, 'buscar fonte para query sem fonte pediria connector inexistente');
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
    culture: cultureDoModelo(),
    fonte: async () => [],
  });
  const t = feitas.get('feriados')!.tabela;
  assert.ok(t.rowCount > 0, 'feriados deveria ter linhas');
  assert.ok(t.columns.length > 0);
});

test('as 24 queries do escopo executam os passos; o que falha é tipo do dado sintético', async () => {
  // O que este teste PODE provar sem credencial: que nenhuma query para por função
  // faltando, semântica não implementada ou ordem errada entre queries.
  //
  // O que ele NÃO pode provar: que os valores estão certos — isso é a fase 2b.9,
  // com dado real. E há um limite claro: o dado sintético não sabe o tipo de toda
  // coluna. O tipo só é conhecido onde o próprio M declara
  // (`Table.TransformColumnTypes`) ou onde o uso revela (aritmética). Onde não sabe,
  // gera texto — e o engine então recusa comparar texto com data, **corretamente**.
  //
  // Por isso o teste classifica as falhas em vez de exigir zero. Falha de tipo do
  // fixture é aceitável e está listada; qualquer outra é bug de verdade e reprova.
  const specs = corpus().filter((s) => s.id !== 'clima-tempo');
  const culture = cultureDoModelo();

  const ok: string[] = [];
  const tipoDoFixture: string[] = [];
  const problemas: string[] = [];

  /**
   * Estava aqui `base-categorias-field`, por não achar a coluna `categoria32`
   * (ACHADOS #19). **Resolvido em 06/08/2026 e por isso a lista está vazia:** a
   * coluna faltava porque o `postgresRunner` pedia o resultado no modo objeto, que
   * colapsa duas colunas de mesmo nome antes de a linha existir; com
   * `rowMode: 'array'` ela passou a ser gravada, e o golden regravado a tem.
   *
   * A lista fica, vazia, porque o mecanismo é o certo para o próximo achado desta
   * natureza — divergência real entre o M e o que a fonte devolve, que não é
   * regressão do engine. O que **não** se faz é reintroduzir uma entrada para
   * silenciar falha nova sem registrar o achado.
   */
  const ACHADO_CONHECIDO = new Map<string, RegExp>();

  for (const spec of specs) {
    try {
      const feitas = await runQueries({
        specs,
        apenas: [spec.id],
        agora: HOJE,
        culture,
        fonte: async (s) => {
          // Golden primeiro: nome e tipo reais do SQL. Sem golden (planilha, tabela
          // embutida), cai para o que o texto do M revela.
          const g = colunasDoGolden(s.id);
          return g && g.length ? linhasDoGolden(g) : linhasSinteticas(s.m_expression!);
        },
      });
      const r = feitas.get(spec.id)!;
      assert.ok(r.tabela.columns.length > 0, `${spec.id} devolveu tabela sem coluna`);
      assert.ok(r.passos.size > 0, `${spec.id} não registrou passos`);
      ok.push(spec.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Tipo que o fixture não soube adivinhar. A mensagem do engine é o que
      // distingue: ela nomeia os dois tipos envolvidos.
      const conhecido = ACHADO_CONHECIDO.get(spec.id);
      if (conhecido?.test(msg)) {
        // Divergência real entre o M e o que a fonte devolve. Não é regressão.
        tipoDoFixture.push(`${spec.id} (achado registrado): ${msg}`);
      } else if (/entre string e|esperava (datetime|number|text|logical)|pede (date|datetime|number|text)/.test(msg)) {
        tipoDoFixture.push(`${spec.id}: ${msg}`);
      } else {
        problemas.push(`${spec.id}: ${msg}`);
      }
    }
  }

  const lista = (xs: string[]): string => xs.join('\n  ');

  assert.deepEqual(
    problemas,
    [],
    `falhas que NÃO são tipo do fixture (função faltando, semântica, ordem):\n  ${lista(problemas)}`,
  );
  assert.equal(ok.length + tipoDoFixture.length, 24);
  // Piso em 24 = **todas**. Era 23 antes de `field-agenda-slot` (ACHADOS #87) —
  // SQL de mão, sem golden, cai para dado sintético como qualquer query nova; e
  // era 22 antes disso, enquanto `base-categorias-field` esbarrava em
  // `categoria32`. Se cair, alguma coisa regrediu — e a mensagem diz qual query e
  // por quê.
  assert.ok(
    ok.length >= 24,
    `só ${ok.length} de 24 executaram inteiras. Barradas por tipo do fixture:\n  ${lista(tipoDoFixture)}`,
  );
});

/**
 * Nome da aba que a query navega: `Fonte{[name="X", ItemKind="Table"]}`.
 *
 * Existe porque o connector de Google Sheets **não** devolve os dados direto: ele
 * devolve uma tabela de navegação com uma linha por aba e a tabela de dados dentro
 * da coluna `Data`. O M da base sempre navega assim, e o runner só repassa o que a
 * fonte deu — então é a fonte que precisa entregar nesse formato.
 */
function abaNavegada(m: string): string | null {
  let achado: string | null = null;
  const anda = (no: unknown): void => {
    if (achado || typeof no !== 'object' || no === null) return;
    const n = no as { type?: string; fields?: { name: string; expr: { value?: unknown } }[] };
    if (n.type === 'Record' && n.fields?.some((f) => f.name === 'ItemKind')) {
      const nome = n.fields.find((f) => f.name === 'name')?.expr?.value;
      if (typeof nome === 'string') achado = nome;
      return;
    }
    for (const v of Object.values(no) as unknown[]) {
      if (Array.isArray(v)) for (const x of v) anda(x);
      else anda(v);
    }
  };
  anda(parseM(m));
  return achado;
}

/**
 * Duas linhas com todas as colunas que o M da query menciona.
 *
 * O valor é escolhido pelo tipo que o próprio M pede em
 * `Table.TransformColumnTypes`: o engine recusa conversão implícita, então um
 * texto onde a query declara `type datetime` faria o passo errar alto — que é o
 * comportamento certo, e aqui atrapalharia o teste de execução.
 */
/**
 * Colunas e tipos que o SQL da query devolve **de verdade**, lidos do golden.
 *
 * Isto é muito melhor que adivinhar a partir do texto do M: o golden foi gravado
 * executando a query contra a fonte real (`npm run validate:queries`) e registra
 * nome e tipo de cada coluna — só shape, nunca linha, por causa do PII. 18 das 24
 * queries têm golden; as outras 6 são as que não leem SQL (planilha, tabela
 * embutida, `DateTime.LocalNow`).
 */
function colunasDoGolden(
  id: string,
): { nome: string; tipo: string; numerica: boolean }[] | null {
  const p = path.join(ROOT, 'specs', 'golden', `${id}.golden.json`);
  if (!fs.existsSync(p)) return null;
  const g = JSON.parse(fs.readFileSync(p, 'utf8')) as {
    columns?: { name: string; type: string; numericString?: boolean }[];
  };
  return (g.columns ?? []).map((c) => ({
    nome: c.name,
    tipo: c.type,
    // O golden registra quais colunas de texto contêm número (`PROTOCOLO:`,
    // `NUMERO CONTRATO`). O M declara essas como Int64, e a conversão só funciona
    // se o dado sintético também for numérico — como o real é.
    numerica: c.numericString === true,
  }));
}

/** Linhas sintéticas a partir do golden: nome e tipo vêm do que o SQL devolveu. */
function linhasDoGolden(
  cols: { nome: string; tipo: string; numerica: boolean }[],
): Record<string, unknown>[] {
  const valor = (c: { tipo: string; numerica: boolean }): unknown => {
    if (c.tipo === 'date') return new Date(Date.UTC(2026, 0, 15, 8, 30, 0));
    if (c.tipo === 'number') return 1;
    if (c.tipo === 'null') return null;
    // `object` no golden é jsonb do Postgres; o M dessas queries não navega nele.
    if (c.tipo === 'object') return null;
    return c.numerica ? '1' : 'v';
  };
  const uma = (): Record<string, unknown> =>
    Object.fromEntries(cols.map((c) => [c.nome, valor(c)]));
  return [uma(), uma()];
}

function linhasSinteticas(m: string): Record<string, unknown>[] {
  // `Data` é a coluna em que a navegação do Sheets guarda a tabela; nunca é coluna
  // de dado, então fica fora da coleta.

  const tipos = new Map<string, string>();
  const colunas = new Set<string>();
  /** Nomes que o próprio M cria; não podem vir da fonte. */
  const criadas = new Set<string>();
  /** Colunas usadas em aritmética: precisam de número, não de texto. */
  const numericas = new Set<string>();
  const anda = (no: unknown): void => {
    if (typeof no !== 'object' || no === null) return;
    const n = no as { type?: string; field?: string; callee?: { name?: string }; args?: unknown[] };
    if (n.type === 'Field' && n.field) colunas.add(n.field);
    // `[A] + [B]` exige número dos dois lados — o engine recusa `+` entre textos,
    // que é a semântica de M. Então a fonte sintética tem que dar número aqui.
    const bin = no as { type?: string; op?: string; left?: { field?: string }; right?: { field?: string } };
    if (bin.type === 'Binary' && ['+', '-', '*', '/'].includes(bin.op ?? '')) {
      for (const lado of [bin.left, bin.right]) {
        if (lado?.field) numericas.add(lado.field);
      }
    }
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
    if (numericas.has(col) && !tipos.has(col)) return 1;
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
  for (const c of criadas) colunas.delete(c);
  const uma = (): Record<string, unknown> => Object.fromEntries([...colunas].map((c) => [c, valor(c)]));
  const dados = [uma(), uma()];

  // Query que promove cabeçalho (as de planilha) lê os nomes da **primeira linha**
  // que sobra depois do `Table.Skip`. `#APURAÇÃO PREMIAÇÃO` tem uma linha de título
  // acima do cabeçalho, e por isso pula 1 antes de promover — então o dado
  // sintético precisa ter a linha de título também, senão o cabeçalho é o que é
  // descartado e as colunas nascem com os valores como nome.
  if (/Table\.PromoteHeaders/.test(m)) {
    const cabecalho = Object.fromEntries([...colunas].map((c) => [c, c]));
    const lixo = Object.fromEntries([...colunas].map((c) => [c, null]));
    const pula = Number(/Table\.Skip\([^,]+,\s*(\d+)\s*\)/.exec(m)?.[1] ?? 0);
    dados.unshift(cabecalho);
    for (let i = 0; i < pula; i++) dados.unshift({ ...lixo });
  }

  // Google Sheets: a fonte devolve navegação, não dados.
  const aba = abaNavegada(m);
  if (aba) {
    return [{ name: aba, ItemKind: 'Table', Data: deLinhas(dados) }];
  }
  return dados;
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
