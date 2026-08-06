// Testes do avaliador de M e das funções.
//
// O que se prova aqui, em ordem de importância:
//
//   1. **Ordem de linha sobrevive aos passos.** É a propriedade que decide qual
//      supervisor fica preso a cada protocolo, e a única que não dá erro quando
//      quebra. Tem teste que reproduz a sequência `Sort → mesclagem → Distinct` de
//      `PROTOCOLOS GERAL`.
//   2. **Erro alto.** Função não implementada, coluna que não existe, conversão de
//      tipo ambígua: tudo erra dizendo o nome. Um engine que segue em frente
//      responderia "todas as colunas conferem" na query que não entendeu.
//   3. **Semântica de M, não de DAX.** null em condição não passa a linha, `&` não
//      concatena número, divisão por zero é erro.

import assert from 'node:assert/strict';
import test from 'node:test';
import { MEvaluator } from '../src/evaluator.ts';
import { standardConstants, standardFunctions } from '../src/functions.ts';
import {
  isTable,
  linha,
  MDuration,
  MTable,
  MTime,
  toDatasetRows,
  type MRow,
  type MValue,
} from '../src/value.ts';

const HOJE = new Date(Date.UTC(2026, 7, 5, 12, 30, 0));

function ev(queries: Record<string, MValue> = {}): MEvaluator {
  return new MEvaluator({
    functions: standardFunctions(),
    constants: standardConstants(),
    agora: HOJE,
    query: (nome) => {
      if (nome in queries) return queries[nome];
      throw new Error(`query desconhecida: ${nome}`);
    },
  });
}

/** Tabela de teste a partir de objetos, preservando a ordem das chaves. */
function tab(cols: string[], linhas: (MValue[])[]): MTable {
  return new MTable(cols, linhas.map((vs) => linha(cols.map((c, i) => [c, vs[i]] as const))));
}

/** Tabela como matriz, para comparar valor **e** ordem num deepEqual. */
function grade(t: MTable): { colunas: readonly string[]; linhas: MValue[][] } {
  return {
    colunas: t.columns,
    linhas: t.rows.map((r: MRow) => t.columns.map((c) => r.get(c) ?? null)),
  };
}

// ───────────────────────────────────────────────── escopo e passos

test('passo vê passo anterior por nome', () => {
  const { valor } = ev().avaliaQuery('let a = 2, b = a * 3, c = b + 1 in c');
  assert.equal(valor, 7);
});

test('let em M resolve por nome, não por posição: `a = b, b = 1` funciona', () => {
  // O Power Query gera em ordem, mas a linguagem é mutuamente recursiva. Depender
  // da ordem quebraria no dia em que ele parasse de gerar assim.
  assert.equal(ev().avaliaQuery('let a = b, b = 1 in a').valor, 1);
});

test('ciclo entre passos é erro nomeado, não pilha estourada', () => {
  assert.throws(() => ev().avaliaQuery('let a = b, b = a in a'), /Ciclo entre passos.*a|b/s);
  assert.throws(() => ev().avaliaQuery('let a = a in a'), /Ciclo entre passos/);
});

test('avaliaQuery devolve o valor de cada passo — é o que permite comparar com o Power Query', () => {
  const { passos } = ev().avaliaQuery('let Fonte = 1, #"Tipo Alterado" = Fonte + 1 in #"Tipo Alterado"');
  assert.deepEqual([...passos.keys()], ['Fonte', 'Tipo Alterado']);
  assert.equal(passos.get('Tipo Alterado'), 2);
});

test('nome desconhecido que não é passo nem função nem query erra dizendo o nome', () => {
  assert.throws(() => ev().avaliaQuery('let a = Inexistente in a'), /Inexistente/);
});

test('função não implementada erra com o nome, e não segue em frente', () => {
  assert.throws(
    () => ev().avaliaQuery('let a = Table.Pivot(1) in a'),
    /Função M não implementada: 'Table.Pivot'/,
  );
});

test('outra query entra por nome — é assim que a mesclagem entre queries chega', () => {
  const outra = tab(['ID'], [[1], [2]]);
  const t = ev({ 'GESTORES EQUIPES': outra }).avaliaQuery('let a = #"GESTORES EQUIPES" in a');
  assert.ok(isTable(t.valor));
});

// ───────────────────────────────────────────────── each e campo

test('`each [Coluna]` resolve campo do `_` implícito', () => {
  const e = ev({ T: tab(['STATUS', 'N'], [['ok', 1], ['Cancelado', 2], ['ok', 3]]) });
  const t = e.avaliaTabela('let a = Table.SelectRows(T, each [STATUS] <> "Cancelado") in a');
  assert.deepEqual(grade(t).linhas, [['ok', 1], ['ok', 3]]);
});

test('`_` explícito é o mesmo valor que `[Coluna]` usa', () => {
  const e = ev({ T: tab(['A'], [[1], [2]]) });
  const t = e.avaliaTabela('let a = Table.AddColumn(T, "R", each Record.Field(_, "A") * 10) in a');
  assert.deepEqual(grade(t).linhas, [[1, 10], [2, 20]]);
});

test('condição null não passa a linha — e condição não-logical é erro', () => {
  const e = ev({ T: tab(['A'], [[1], [null]]) });
  const t = e.avaliaTabela('let a = Table.SelectRows(T, each [A] > 0) in a');
  assert.deepEqual(grade(t).linhas, [[1]]);
  assert.throws(
    () => ev({ T: tab(['A'], [[1]]) }).avaliaTabela('let a = Table.SelectRows(T, each [A]) in a'),
    /esperava logical/,
  );
});

test('campo ausente é erro; com `?` é null', () => {
  const e = ev({ T: tab(['A'], [[1]]) });
  assert.throws(() => e.avaliaTabela('let a = Table.SelectRows(T, each [B] = 1) in a'), /'B'/);
  assert.equal(
    e.avaliaQuery('let a = Table.AddColumn(T, "R", each [B]?) in a').valor instanceof MTable,
    true,
  );
});

// ───────────────────────────────────────────────── ORDEM (o ponto da fase)

test('Table.Sort preserva empate na ordem anterior (estável)', () => {
  const e = ev({ T: tab(['G', 'N'], [['b', 1], ['a', 2], ['b', 3], ['a', 4]]) });
  const t = e.avaliaTabela('let a = Table.Sort(T, {{"G", Order.Ascending}}) in a');
  // Dentro de cada grupo, a ordem original (2,4) e (1,3) tem que sobreviver.
  assert.deepEqual(grade(t).linhas, [['a', 2], ['a', 4], ['b', 1], ['b', 3]]);
});

test('Table.Distinct mantém a PRIMEIRA da ordem corrente', () => {
  const e = ev({ T: tab(['K', 'V'], [['x', 'primeiro'], ['x', 'segundo'], ['y', 'só']]) });
  const t = e.avaliaTabela('let a = Table.Distinct(T, {"K"}) in a');
  assert.deepEqual(grade(t).linhas, [['x', 'primeiro'], ['y', 'só']]);
});

test('Sort antes de Distinct muda QUAL linha sobra — a sequência de PROTOCOLOS GERAL', () => {
  // Reproduz o fato decisivo 3 da decisão: a ordem de um Sort decide o valor que
  // sobrevive a um Distinct posterior, e a contagem é a mesma nos dois casos.
  const dados = tab(['SOLICITACAO', 'INSTALADO POR'], [
    [1, 'ANA'], [1, 'ZE'], [2, 'BIA'],
  ]);
  const asc = ev({ T: dados }).avaliaTabela(
    'let s = Table.Sort(T, {{"INSTALADO POR", Order.Ascending}}), d = Table.Distinct(s, {"SOLICITACAO"}) in d',
  );
  const desc = ev({ T: dados }).avaliaTabela(
    'let s = Table.Sort(T, {{"INSTALADO POR", Order.Descending}}), d = Table.Distinct(s, {"SOLICITACAO"}) in d',
  );
  assert.equal(asc.rowCount, desc.rowCount, 'a contagem é igual nas duas ordens');
  const quem = (t: MTable): MValue[] =>
    t.rows.filter((r) => r.get('SOLICITACAO') === 1).map((r) => r.get('INSTALADO POR') ?? null);
  assert.deepEqual(quem(asc), ['ANA']);
  assert.deepEqual(quem(desc), ['ZE']);
});

test('ordem de coluna é preservada e ReorderColumns manda as não citadas para o fim', () => {
  const e = ev({ T: tab(['A', 'B', 'C'], [[1, 2, 3]]) });
  assert.deepEqual(
    grade(e.avaliaTabela('let a = Table.ReorderColumns(T, {"C", "A"}) in a')).colunas,
    ['C', 'A', 'B'],
  );
});

// ───────────────────────────────────────────────── mesclagem

test('NestedJoin aninha sem multiplicar; ExpandTableColumn é quem multiplica', () => {
  const esq = tab(['ID', 'X'], [[1, 'a'], [2, 'b']]);
  const dir = tab(['FK', 'SUP'], [[1, 'ANA'], [1, 'BIA'], [3, 'ZE']]);
  const e = ev({ E: esq, D: dir });

  const mesclada = e.avaliaTabela(
    'let m = Table.NestedJoin(E, {"ID"}, D, {"FK"}, "N", JoinKind.LeftOuter) in m',
  );
  // Continua com 2 linhas: a mesclagem por si não multiplica.
  assert.equal(mesclada.rowCount, 2);
  assert.deepEqual(mesclada.columns, ['ID', 'X', 'N']);

  const expandida = e.avaliaTabela(
    'let m = Table.NestedJoin(E, {"ID"}, D, {"FK"}, "N", JoinKind.LeftOuter),' +
      ' x = Table.ExpandTableColumn(m, "N", {"SUP"}, {"SUP"}) in x',
  );
  // ID 1 casa duas vezes → 2 linhas; ID 2 não casa → sobrevive com null.
  assert.deepEqual(grade(expandida).linhas, [
    [1, 'a', 'ANA'],
    [1, 'a', 'BIA'],
    [2, 'b', null],
  ]);
});

test('JoinKind.Inner descarta a linha sem par; LeftOuter mantém', () => {
  const e = ev({ E: tab(['ID'], [[1], [2]]), D: tab(['FK'], [[1]]) });
  const dentro = e.avaliaTabela(
    'let m = Table.NestedJoin(E, {"ID"}, D, {"FK"}, "N", JoinKind.Inner) in m',
  );
  assert.equal(dentro.rowCount, 1);
});

test('JoinKind não implementado erra listando os que existem', () => {
  const e = ev({ E: tab(['ID'], [[1]]), D: tab(['FK'], [[1]]) });
  assert.throws(
    () => e.avaliaTabela('let m = Table.NestedJoin(E, {"ID"}, D, {"FK"}, "N", JoinKind.FullOuter) in m'),
    /JoinKind.*não implementado/,
  );
});

test('a chave de junção distingue tipo: número 1 não casa com texto "1"', () => {
  // Se casasse, uma junção por código de equipe passaria a casar coisa errada
  // dependendo de a fonte devolver o campo como texto ou como inteiro.
  const e = ev({ E: tab(['ID'], [[1]]), D: tab(['FK'], [['1']]) });
  const t = e.avaliaTabela(
    'let m = Table.NestedJoin(E, {"ID"}, D, {"FK"}, "N", JoinKind.Inner) in m',
  );
  assert.equal(t.rowCount, 0);
});

// ───────────────────────────────────────────────── colunas e valores

test('RenameColumns recusa nome que ficaria duplicado', () => {
  const e = ev({ T: tab(['A', 'B'], [[1, 2]]) });
  assert.throws(
    () => e.avaliaTabela('let a = Table.RenameColumns(T, {{"A", "B"}}) in a'),
    /ficaria duplicado/,
  );
});

test('coluna citada que não existe erra listando as que existem', () => {
  const e = ev({ T: tab(['A'], [[1]]) });
  assert.throws(
    () => e.avaliaTabela('let a = Table.RemoveColumns(T, {"Z"}) in a'),
    /não tem a coluna 'Z'.*Colunas: A/s,
  );
});

test('AddColumn: coluna nova só é visível no passo seguinte, não no mesmo', () => {
  const e = ev({ T: tab(['A'], [[1]]) });
  // Encadeado em dois passos funciona: no 2º passo, B já é coluna da tabela.
  const ok = e.avaliaTabela(
    'let a = Table.AddColumn(T, "B", each [A] + 1), b = Table.AddColumn(a, "C", each [B] + 1) in b',
  );
  assert.deepEqual(grade(ok).linhas, [[1, 2, 3]]);

  // No MESMO passo não existe: o gerador vê a linha de origem. É o mesmo
  // contrato do ADDCOLUMNS no avaliador de DAX.
  assert.throws(
    () => e.avaliaTabela('let a = Table.AddColumn(T, "B", each [B]?  ?? 0) in a'),
    /Esperava|campo/,
  );
});

test('AddColumn recusa nome de coluna que já existe', () => {
  const e = ev({ T: tab(['A'], [[1]]) });
  assert.throws(() => e.avaliaTabela('let a = Table.AddColumn(T, "A", each 1) in a'), /já existe/);
});

test('ReplaceValue troca valor exato; ReplaceText troca dentro do texto', () => {
  const e = ev({ T: tab(['A'], [['x-y'], ['x']]) });
  const exato = e.avaliaTabela(
    'let a = Table.ReplaceValue(T, "x", "Z", Replacer.ReplaceValue, {"A"}) in a',
  );
  assert.deepEqual(grade(exato).linhas, [['x-y'], ['Z']]);
  const dentro = e.avaliaTabela(
    'let a = Table.ReplaceValue(T, "x", "Z", Replacer.ReplaceText, {"A"}) in a',
  );
  assert.deepEqual(grade(dentro).linhas, [['Z-y'], ['Z']]);
});

test('TransformColumnTypes passa direto quando o valor já é do tipo pedido', () => {
  const e = ev({ T: tab(['N', 'S'], [[1.7, 'txt']]) });
  const t = e.avaliaTabela(
    'let a = Table.TransformColumnTypes(T, {{"N", Int64.Type}, {"S", type text}}) in a',
  );
  assert.deepEqual(grade(t).linhas, [[1, 'txt']]);
});

test('TransformColumnTypes NÃO adivinha data em texto — o erro cita a culture', () => {
  // É o achado 1 (o falso) em forma de guarda: "01/02/2026" é 1º de fevereiro ou
  // 2 de janeiro dependendo da culture, que não está na expressão M.
  const e = ev({ T: tab(['D'], [['01/02/2026']]) });
  assert.throws(
    () => e.avaliaTabela('let a = Table.TransformColumnTypes(T, {{"D", type date}}) in a'),
    /culture/,
  );
});

test('número vira data pela época 1899-12-30 — é como a planilha entrega', () => {
  // Com `valueRenderOption=UNFORMATTED_VALUE`, célula de data vem como dias desde
  // 1899-12-30 e a fração é a hora. Diferente de texto, aqui não há ambiguidade de
  // culture: número não tem formato. Por isso vale sem culture nenhuma.
  const e = ev({ T: tab(['D', 'H'], [[46037, 46037.5]]) });
  const t = e.avaliaTabela(
    'let a = Table.TransformColumnTypes(T, {{"D", type date}, {"H", type datetime}}) in a',
  );
  const [data, hora] = [t.rows[0].get('D'), t.rows[0].get('H')];
  assert.ok(data instanceof Date && hora instanceof Date);
  assert.equal(data.toISOString(), '2026-01-15T00:00:00.000Z');
  assert.equal(hora.toISOString(), '2026-01-15T12:00:00.000Z');
});

test('serial fracionário não perde o milissegundo por arredondamento binário', () => {
  // 0,354166… * 86 400 000 dá 30 599 999,99 em ponto flutuante; truncar faria
  // 08:30 virar 08:29:59.999.
  const e = ev({ T: tab(['H'], [[46037 + 30_600_000 / 86_400_000]]) });
  const t = e.avaliaTabela('let a = Table.TransformColumnTypes(T, {{"H", type datetime}}) in a');
  assert.equal((t.rows[0].get('H') as Date).toISOString(), '2026-01-15T08:30:00.000Z');
});

test('serial fora da faixa de data erra nomeando o número, não estoura depois', () => {
  const e = ev({ T: tab(['D'], [[1e15]]) });
  assert.throws(
    () => e.avaliaTabela('let a = Table.TransformColumnTypes(T, {{"D", type date}}) in a'),
    /não é um número de série de data válido/,
  );
});

test('Date.From aceita número de série, como no Excel', () => {
  const e = ev({});
  assert.equal(
    (e.avaliaQuery('let a = Date.From(46037) in a').valor as Date).toISOString(),
    '2026-01-15T00:00:00.000Z',
  );
});

test('PromoteHeaders usa a primeira linha e recusa cabeçalho vazio', () => {
  const e = ev({
    T: tab(['Column1', 'Column2'], [['NOME', 'GESTOR'], ['ana', 'bia']]),
    V: tab(['Column1'], [[null], ['x']]),
  });
  const t = e.avaliaTabela('let a = Table.PromoteHeaders(T) in a');
  assert.deepEqual(t.columns, ['NOME', 'GESTOR']);
  assert.deepEqual(grade(t).linhas, [['ana', 'bia']]);
  assert.throws(() => e.avaliaTabela('let a = Table.PromoteHeaders(V) in a'), /cabeçalho está vazia/);
});

test('Table.Combine une colunas e preenche a que falta com null', () => {
  const e = ev({ A: tab(['X', 'Y'], [[1, 2]]), B: tab(['Y', 'Z'], [[3, 4]]) });
  const t = e.avaliaTabela('let c = Table.Combine({A, B}) in c');
  assert.deepEqual(t.columns, ['X', 'Y', 'Z']);
  assert.deepEqual(grade(t).linhas, [[1, 2, null], [null, 3, 4]]);
});

// ───────────────────────────────────────────────── semântica de M vs DAX

test('`&` não concatena número — em M isso é erro, não "12"', () => {
  assert.throws(() => ev().avaliaQuery('let a = 1 & 2 in a'), /`&` não combina number/);
  assert.equal(ev().avaliaQuery('let a = "1" & "2" in a').valor, '12');
});

test('divisão por zero é erro em M, não infinito', () => {
  assert.throws(() => ev().avaliaQuery('let a = 1 / 0 in a'), /Divisão por zero/);
});

test('aritmética com null dá null; `null = null` é true', () => {
  assert.equal(ev().avaliaQuery('let a = 1 + null in a').valor, null);
  assert.equal(ev().avaliaQuery('let a = null = null in a').valor, true);
});

test('condição do `if` exige logical', () => {
  assert.throws(() => ev().avaliaQuery('let a = if 1 then 2 else 3 in a'), /exige logical/);
  assert.equal(ev().avaliaQuery('let a = if true then 2 else 3 in a').valor, 2);
});

test('`and`/`or` curto-circuitam', () => {
  // Sem curto-circuito, o lado direito compararia null com número e erraria.
  assert.equal(ev().avaliaQuery('let a = false and (1/0 = 1) in a').valor, false);
  assert.equal(ev().avaliaQuery('let a = true or (1/0 = 1) in a').valor, true);
});

test('`as`/`is`/`meta` erram dizendo que só clima-tempo e feriados usam', () => {
  assert.throws(() => ev().avaliaQuery('let a = 1 as number in a'), /clima-tempo|feriados/);
});

// ───────────────────────────────────────────────── funções de valor

test('Text.Proper, Upper e os delimitadores', () => {
  const e = ev();
  assert.equal(e.avaliaQuery('let a = Text.Proper("JOSÉ DA silva") in a').valor, 'José Da Silva');
  assert.equal(e.avaliaQuery('let a = Text.Upper("josé") in a').valor, 'JOSÉ');
  assert.equal(e.avaliaQuery('let a = Text.BeforeDelimiter("a-b-c", "-") in a').valor, 'a');
  assert.equal(e.avaliaQuery('let a = Text.AfterDelimiter("a-b-c", "-") in a').valor, 'b-c');
  // Sem o delimitador, M devolve vazio — não o texto inteiro.
  assert.equal(e.avaliaQuery('let a = Text.BeforeDelimiter("abc", "-") in a').valor, '');
});

test('Text.Combine trata null como vazio', () => {
  assert.equal(ev().avaliaQuery('let a = Text.Combine({"a", null, "b"}, "-") in a').valor, 'a--b');
});

test('DateTime.Time devolve time, e DateTime.Date zera a hora', () => {
  const e = ev();
  const hora = e.avaliaQuery('let a = DateTime.Time(#datetime(2026,8,5,8,30,0)) in a').valor;
  assert.ok(hora instanceof MTime);
  assert.equal((hora as MTime).ms, (8 * 60 + 30) * 60_000);
  const data = e.avaliaQuery('let a = DateTime.Date(#datetime(2026,8,5,8,30,0)) in a').valor;
  assert.equal((data as Date).toISOString(), '2026-08-05T00:00:00.000Z');
});

test('Date.AddMonths satura no fim do mês: 31/01 + 1 = 28/02', () => {
  // `new Date` sozinho viraria 03/03, e o mês do relatório sairia deslocado.
  const v = ev().avaliaQuery('let a = Date.AddMonths(#date(2026,1,31), 1) in a').valor;
  assert.equal((v as Date).toISOString().slice(0, 10), '2026-02-28');
});

test('#date recusa data que não existe', () => {
  assert.throws(() => ev().avaliaQuery('let a = #date(2026,2,30) in a'), /não é uma data válida/);
});

test('data menos data dá duração, e Duration.Days conta os dias', () => {
  const v = ev().avaliaQuery('let a = Duration.Days(#date(2026,8,5) - #date(2026,8,1)) in a').valor;
  assert.equal(v, 4);
});

test('DateTime.LocalNow usa o relógio injetado, não o do sistema', () => {
  assert.equal((ev().avaliaQuery('let a = DateTime.LocalNow() in a').valor as Date).getTime(), HOJE.getTime());
});

test('DateTimeZone.SwitchZone desloca as horas — o caso de hora-atualizado', () => {
  const v = ev().avaliaQuery('let a = DateTimeZone.SwitchZone(DateTimeZone.LocalNow(), -3) in a').valor;
  assert.equal((v as Date).getTime(), HOJE.getTime() - 3 * 3_600_000);
});

test('Number.From depende da culture: em pt-BR a vírgula é decimal e o ponto é milhar', () => {
  const br = new MEvaluator({
    functions: standardFunctions(),
    constants: standardConstants(),
    agora: HOJE,
    culture: 'pt-BR',
  });
  assert.equal(br.avaliaQuery('let a = Number.From("1,5") in a').valor, 1.5);
  assert.equal(br.avaliaQuery('let a = Number.From("1.234,56") in a').valor, 1234.56);
  assert.equal(br.avaliaQuery('let a = Number.From("7637491824") in a').valor, 7637491824);

  // Sem culture, só dígito puro passa: "1.5" seria 1,5 ou 15 dependendo de quem lê.
  assert.equal(ev().avaliaQuery('let a = Number.From("42") in a').valor, 42);
  assert.throws(() => ev().avaliaQuery('let a = Number.From("1.5") in a'), /culture/);
  assert.throws(() => ev().avaliaQuery('let a = Number.From("1,5") in a'), /culture/);
});

test('texto numérico vira Int64 quando a culture é conhecida — o caso de PROTOCOLO:', () => {
  // O golden registra `PROTOCOLO:` como string numérica e o M declara Int64.Type.
  // Sem a culture, isto erraria alto e 8 queries parariam aqui.
  const br = new MEvaluator({
    functions: standardFunctions(),
    constants: standardConstants(),
    culture: 'pt-BR',
    query: () => tab(['PROTOCOLO:'], [['7637491824']]),
  });
  const t = br.avaliaTabela('let a = Table.TransformColumnTypes(T, {{"PROTOCOLO:", Int64.Type}}) in a');
  assert.equal(t.rows[0].get('PROTOCOLO:'), 7637491824);
});

test('aridade errada erra citando o nome e o esperado', () => {
  assert.throws(() => ev().avaliaQuery('let a = Text.Upper() in a'), /Text.Upper espera/);
});

// ───────────────────────────────────────────────── acesso a item

test('tabela{[chave=valor]} exige exatamente uma linha', () => {
  const abas = tab(['name', 'ItemKind', 'Data'], [
    ['QUADRO FUNCIONAL', 'Table', tab(['A'], [[1]])],
    ['Outra', 'Table', tab(['A'], [[2]])],
  ]);
  const e = ev({ Fonte: abas });
  const t = e.avaliaTabela(
    'let a = Fonte{[name="QUADRO FUNCIONAL", ItemKind="Table"]}[Data] in a',
  );
  assert.equal(t.rowCount, 1);
  assert.throws(
    () => e.avaliaTabela('let a = Fonte{[name="Inexistente"]}[Data] in a'),
    /Nenhuma linha casa/,
  );
  assert.throws(
    () => e.avaliaTabela('let a = Fonte{[ItemKind="Table"]}[Data] in a'),
    /2 linhas casam.*exatamente uma/s,
  );
});

test('tabela[Coluna] é a lista dos valores daquela coluna', () => {
  const e = ev({ T: tab(['A'], [[1], [2], [3]]) });
  assert.deepEqual(ev({ T: tab(['A'], [[1], [2], [3]]) }).avaliaQuery('let a = T[A] in a').valor, [1, 2, 3]);
  assert.equal(e.avaliaQuery('let a = List.Count(T[A]) in a').valor, 3);
});

// ───────────────────────────────────────────────── fronteira com o DAX

test('toDatasetRows normaliza nome e converte time para a época do Power BI', () => {
  const t = tab(['DATA CRIADO', 'HORA CRIADO'], [[new Date(Date.UTC(2026, 7, 5)), new MTime(30_600_000)]]);
  const { columns, rows } = toDatasetRows(t, 'teste');
  assert.deepEqual(columns, ['data criado', 'hora criado']);
  // 08:30 sobre 1899-12-30 — assim serialFromDate dá a fração do dia.
  const hora = rows[0]['hora criado'] as Date;
  assert.equal(hora.getTime(), Date.UTC(1899, 11, 30) + 30_600_000);
});

test('toDatasetRows recusa duas colunas que colidem depois de normalizar', () => {
  const t = tab(['Gestor', 'GESTOR'], [['a', 'b']]);
  assert.throws(() => toDatasetRows(t, 'teste'), /viram a mesma chave.*silêncio/s);
});

test('toDatasetRows recusa célula com tabela dentro — mesclagem sem expandir', () => {
  const t = tab(['A', 'N'], [[1, tab(['X'], [[1]])]]);
  assert.throws(() => toDatasetRows(t, 'teste'), /só aceita escalar.*ExpandTableColumn/s);
});

test('duração vira dias na fronteira, como o DAX espera', () => {
  const t = tab(['D'], [[new MDuration(2 * 86_400_000)]]);
  assert.equal(toDatasetRows(t, 'teste').rows[0]['d'], 2);
});

// ───────────────────────────────────────────────── uma query inteira

test('uma query realista roda ponta a ponta: filtro, renome, coluna, mesclagem, dedup', () => {
  // Reproduz a forma de `quadro-funcional` + a mesclagem que
  // `protocolos-produtividade` faz com ela, com dado sintético.
  const funcional = tab(['NOME', 'GESTOR', 'CARGO'], [
    ['ana silva', 'Luis Aranda', 'tec'],
    ['bia souza', 'Pablo Borges', 'tec'],
    ['ze mendes', 'Outro Gestor', 'tec'],
  ]);
  const protocolos = tab(['SOLICITACAO', 'TECNICO'], [
    [1, 'ANA SILVA'],
    [2, 'BIA SOUZA'],
    [3, 'ZE MENDES'],
  ]);

  const e = ev({ QF: funcional, PP: protocolos });
  const t = e.avaliaTabela(`
    let
      #"Linhas Filtradas" = Table.SelectRows(QF, each ([GESTOR] = "Luis Aranda" or [GESTOR] = "Pablo Borges")),
      #"Linhas Classificadas" = Table.Sort(#"Linhas Filtradas", {{"GESTOR", Order.Ascending}}),
      #"Personalização Adicionada" = Table.AddColumn(#"Linhas Classificadas", "upper_name", each Text.Upper([NOME])),
      #"Consultas Mescladas" = Table.NestedJoin(PP, {"TECNICO"}, #"Personalização Adicionada", {"upper_name"}, "QF", JoinKind.LeftOuter),
      #"QF Expandido" = Table.ExpandTableColumn(#"Consultas Mescladas", "QF", {"GESTOR"}, {"GESTOR"}),
      #"Colunas Renomeadas" = Table.RenameColumns(#"QF Expandido", {{"TECNICO", "INSTALADOR"}})
    in
      #"Colunas Renomeadas"
  `);

  assert.deepEqual(t.columns, ['SOLICITACAO', 'INSTALADOR', 'GESTOR']);
  // ZE MENDES foi filtrado do quadro (gestor fora dos dois), então sobrevive na
  // esquerda com GESTOR null — LeftOuter não descarta linha de protocolo.
  assert.deepEqual(grade(t).linhas, [
    [1, 'ANA SILVA', 'Luis Aranda'],
    [2, 'BIA SOUZA', 'Pablo Borges'],
    [3, 'ZE MENDES', null],
  ]);

  // E o resultado atravessa a fronteira para o avaliador de DAX.
  const { columns, rows } = toDatasetRows(t, 'protocolos');
  assert.deepEqual(columns, ['solicitacao', 'instalador', 'gestor']);
  assert.equal(rows.length, 3);
});
