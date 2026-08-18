// A mesclagem que não casa NADA tem de falar — e não pode se consertar sozinha.
//
// **O caso real.** Três `Table.NestedJoin` deste modelo declaram `Int64.Type` de um
// lado e deixam o outro em texto. Cada um casa zero linha, e a coluna expandida sai
// inteira nula: 87.805 linhas em `BACKLOG AGENDADO FUTURO`, 33.187 em
// `PROTOCOLOS GERAL`. Alguma página lê isso como BLANK, e ninguém soube por semanas.
//
// **As duas metades da regra, e por que as duas precisam de teste.**
//
//   1. Junção morta **sempre** emite nota, com o número que permite decidir. Sem
//      isso o defeito volta a ser invisível, que é o estado que custou o achado #64.
//   2. Reconciliar **só** com decisão registrada. O motor que reconcilia sozinho
//      troca uma junção morta por uma viva e possivelmente errada — dois espaços de
//      identificador que por acaso sejam inteiros pequenos casariam, e sairia um
//      número plausível. É o único erro que este projeto não pode cometer.
//
// O teste de mutação que importa: apague a checagem de `ctx.reconcilia` e o teste
// "sem decisão registrada, a junção morta continua morta" cai.

import assert from 'node:assert/strict';
import test from 'node:test';
import { MEvaluator, type NotaM } from '../src/evaluator.ts';
import { standardConstants, standardFunctions } from '../src/functions.ts';
import { linha, MTable, type MValue } from '../src/value.ts';

function tab(cols: string[], linhas: MValue[][]): MTable {
  return new MTable(cols, linhas.map((vs) => linha(cols.map((c, i) => [c, vs[i]] as const))));
}

interface Montado {
  ev: MEvaluator;
  notas: NotaM[];
  perguntas: { esq: readonly string[]; dir: readonly string[] }[];
}

function monta(queries: Record<string, MValue>, libera = false): Montado {
  const notas: NotaM[] = [];
  const perguntas: { esq: readonly string[]; dir: readonly string[] }[] = [];
  const ev = new MEvaluator({
    functions: standardFunctions(),
    constants: standardConstants(),
    query: (nome) => {
      if (nome in queries) return queries[nome];
      throw new Error(`query desconhecida: ${nome}`);
    },
    nota: (n) => notas.push(n),
    reconcilia: (esq, dir) => {
      perguntas.push({ esq, dir });
      return libera;
    },
  });
  return { ev, notas, perguntas };
}

const JUNTA = 'let m = Table.NestedJoin(E, {"ID"}, D, {"FK"}, "N") in m';

/** Quantas linhas do resultado trouxeram par. A coluna nova é uma tabela por linha. */
function comPar(t: MTable): number {
  return t.rows.filter((r) => {
    const n = r.get('N');
    return n instanceof MTable && n.rowCount > 0;
  }).length;
}

// ───────────────────────────────────────────── 1. a junção viva não muda de nada

test('junção que casa não gera nota nenhuma — o caminho normal fica intocado', () => {
  const { ev, notas, perguntas } = monta({
    E: tab(['ID'], [[1], [2], [3]]),
    D: tab(['FK'], [[1], [3]]),
  });
  const t = ev.avaliaTabela(JUNTA);
  assert.equal(comPar(t), 2);
  assert.deepEqual(notas, [], 'junção viva é silêncio');
  assert.deepEqual(perguntas, [], 'nem chega a perguntar se pode reconciliar');
});

test('ponta vazia não é defeito: zero casadas com a direita vazia não vira nota', () => {
  const { ev, notas } = monta({ E: tab(['ID'], [[1]]), D: tab(['FK'], []) });
  const t = ev.avaliaTabela(JUNTA);
  assert.equal(t.rowCount, 1);
  assert.deepEqual(notas, [], 'tabela vazia do outro lado é resultado, não sintoma');
});

// ───────────────────────────────────────────── 2. a junção morta fala, sempre

test('texto×número sem decisão: continua morta, e a nota traz o número que decidiria', () => {
  const { ev, notas } = monta({
    E: tab(['ID'], [[1001], [1002], [1003], [1004]]),
    D: tab(['FK'], [['1001'], ['1003']]),
  });
  const t = ev.avaliaTabela(JUNTA);

  assert.equal(comPar(t), 0, 'sem decisão registrada, o número NÃO muda');
  assert.equal(notas.length, 1);
  assert.match(notas[0]!.mensagem, /0 de 4 linhas casam por espécie/);
  assert.match(notas[0]!.mensagem, /2 \(50\.0%\) casariam/, 'o número que justifica a decisão');
  assert.match(notas[0]!.mensagem, /INTEIRA NULA/);
  assert.match(notas[0]!.mensagem, /juncoes\.yaml/, 'e diz onde registrar');
  assert.equal(notas[0]!.assunto, "'ID' × 'FK'");
});

test('chaves que não são texto×número: nota diferente, e nenhuma promessa de conserto', () => {
  const { ev, notas, perguntas } = monta({
    E: tab(['ID'], [['a'], ['b']]),
    D: tab(['FK'], [['x'], ['y']]),
  });
  ev.avaliaTabela(JUNTA);
  assert.equal(notas.length, 1);
  assert.match(notas[0]!.mensagem, /não são texto×número/);
  assert.match(notas[0]!.mensagem, /INTEIRA NULA/);
  assert.deepEqual(perguntas, [], 'não pergunta o que não saberia aplicar');
});

test('texto×número de espaços diferentes: diz que nem como inteiro casaria', () => {
  const { ev, notas } = monta({
    E: tab(['ID'], [[1], [2]]),
    D: tab(['FK'], [['900'], ['901']]),
  });
  ev.avaliaTabela(JUNTA);
  assert.equal(notas.length, 1);
  assert.match(notas[0]!.mensagem, /nem comparando ID como inteiro/);
});

// ───────────────────────────────────────────── 3. só a decisão registrada conserta

test('com decisão registrada, a junção reconcilia e a nota assume a divergência', () => {
  const { ev, notas, perguntas } = monta(
    { E: tab(['ID'], [[1001], [1002], [1003], [1004]]), D: tab(['FK'], [['1001'], ['1003']]) },
    true,
  );
  const t = ev.avaliaTabela(JUNTA);

  assert.equal(comPar(t), 2, 'agora casa');
  assert.deepEqual(perguntas, [{ esq: ['ID'], dir: ['FK'] }], 'pergunta pelas chaves, na ordem');
  assert.equal(notas.length, 1);
  assert.match(notas[0]!.mensagem, /reconciliada por decisão registrada/);
  assert.match(notas[0]!.mensagem, /DIVERGE/, 'assume que o Power Query não faria isso');
});

test('o padrão do avaliador é NÃO reconciliar — quem não injeta nada não ganha o conserto', () => {
  const ev = new MEvaluator({
    functions: standardFunctions(),
    constants: standardConstants(),
    query: (nome) =>
      nome === 'E' ? tab(['ID'], [[1001]]) : tab(['FK'], [['1001']]),
  });
  assert.equal(comPar(ev.avaliaTabela(JUNTA)), 0);
});

// ───────────────────────────────────────────── 4. os limites do "como inteiro"

test('zero à esquerda e espaço em volta casam; fracionário e texto com letra não', () => {
  const { ev } = monta(
    {
      E: tab(['ID'], [[7], [8], [9.5], [10]]),
      D: tab(['FK'], [['007'], [' 8 '], ['9.5'], ['10x']]),
    },
    true,
  );
  const t = ev.avaliaTabela(JUNTA);
  const casadas = t.rows
    .filter((r) => (r.get('N') as MTable).rowCount > 0)
    .map((r) => r.get('ID'));
  assert.deepEqual(casadas, [7, 8], '9.5 não é identificador e "10x" não é inteiro');
});

test('nulo não casa com nulo nem na comparação frouxa', () => {
  const { ev } = monta(
    { E: tab(['ID'], [[null], [5]]), D: tab(['FK'], [[null], ['5']]) },
    true,
  );
  const t = ev.avaliaTabela(JUNTA);
  const casadas = t.rows
    .filter((r) => (r.get('N') as MTable).rowCount > 0)
    .map((r) => r.get('ID'));
  assert.deepEqual(casadas, [5], 'null casando com null inventaria par');
});

test('coluna de espécie misturada não é reconciliável — dois defeitos de uma vez, não', () => {
  const { ev, notas, perguntas } = monta(
    { E: tab(['ID'], [[1], ['2']]), D: tab(['FK'], [['9'], ['8']]) },
    true,
  );
  ev.avaliaTabela(JUNTA);
  assert.deepEqual(perguntas, [], 'nem pergunta: a ponta esquerda não tem uma espécie só');
  assert.match(notas[0]!.mensagem, /não são texto×número/);
});

// ───────────────────────────────────────────── 5. a chave composta

// ─────────────────────────────── 6. faixa de data que não se toca: a causa, não a pista
//
// Achado #73. `GESTORES EQUIPES` parou de ser alimentada em 16/07/2025 e
// `PROTOCOLOS GERAL` só tem 2026 — a junção nunca teve como casar. A nota antiga
// dizia "confira as duas pontas no m_expression", onde não havia nada errado, e
// descobrir isso levou uma manhã de medição. Estes testes são para que a próxima vez
// custe uma linha de saída.
//
// O teste de mutação: apague a chamada de `faixaDisjunta` no `Table.NestedJoin` e o
// primeiro teste daqui cai — a nota volta a ser a genérica.

const D = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const JUNTA_DATA = 'let m = Table.NestedJoin(E, {"DIA"}, D, {"DT"}, "N") in m';

test('faixas de data que não se tocam: a nota diz a causa, com as duas faixas', () => {
  const { ev, notas, perguntas } = monta({
    E: tab(['DIA'], [[D('2026-01-02')], [D('2026-08-18')]]),
    D: tab(['DT'], [[D('2024-08-01')], [D('2025-07-16')]]),
  });
  const t = ev.avaliaTabela(JUNTA_DATA);

  assert.equal(comPar(t), 0, 'o resultado não muda: a nota explica, não conserta');
  assert.equal(notas.length, 1);
  assert.match(notas[0]!.mensagem, /NÃO SE TOCAM/);
  assert.match(notas[0]!.mensagem, /esquerda de 2026-01-02 a 2026-08-18/);
  assert.match(notas[0]!.mensagem, /direita de 2024-08-01 a 2025-07-16/);
  assert.match(notas[0]!.mensagem, /dado que parou de chegar, não chave errada/);
  assert.doesNotMatch(
    notas[0]!.mensagem,
    /m_expression/,
    'não manda procurar defeito onde não tem',
  );
  assert.deepEqual(perguntas, [], 'reconciliação não tem nada a oferecer aqui');
});

test('faixas que se sobrepõem sem casar nenhum dia: a nota volta a ser a genérica', () => {
  // Mesmo período dos dois lados, dias diferentes. Aqui "confira as duas pontas" é o
  // conselho certo — a hipótese de dado parado está descartada pela própria faixa.
  const { ev, notas } = monta({
    E: tab(['DIA'], [[D('2026-01-02')], [D('2026-01-04')]]),
    D: tab(['DT'], [[D('2026-01-03')], [D('2026-01-05')]]),
  });
  ev.avaliaTabela(JUNTA_DATA);
  assert.equal(notas.length, 1);
  assert.match(notas[0]!.mensagem, /não são texto×número/);
  assert.doesNotMatch(notas[0]!.mensagem, /NÃO SE TOCAM/);
});

test('faixas que só encostam pelas pontas não são disjuntas', () => {
  // max da direita == min da esquerda. Não casa nenhuma linha por outro motivo, e
  // afirmar "faixas não se tocam" aqui seria mentira.
  const { ev, notas } = monta({
    E: tab(['DIA'], [[D('2026-01-03')], [D('2026-01-04')]]),
    D: tab(['DT'], [[D('2026-01-01')], [D('2026-01-03')]]),
  });
  const t = ev.avaliaTabela(JUNTA_DATA);
  assert.equal(comPar(t), 1, 'o dia que encosta casa de verdade');
  assert.deepEqual(notas, [], 'junção viva é silêncio');
});

test('faixa disjunta é diagnosticada de qualquer lado — direita à frente também', () => {
  const { ev, notas } = monta({
    E: tab(['DIA'], [[D('2024-01-01')]]),
    D: tab(['DT'], [[D('2026-05-05')]]),
  });
  ev.avaliaTabela(JUNTA_DATA);
  assert.match(notas[0]!.mensagem, /NÃO SE TOCAM/);
  assert.match(notas[0]!.mensagem, /esquerda de 2024-01-01 a 2024-01-01/);
});

test('coluna de data misturada com texto não tem faixa — e não ganha o diagnóstico', () => {
  const { ev, notas } = monta({
    E: tab(['DIA'], [[D('2026-01-02')], ['2026-01-03']]),
    D: tab(['DT'], [[D('2024-08-01')]]),
  });
  ev.avaliaTabela(JUNTA_DATA);
  assert.equal(notas.length, 1);
  assert.doesNotMatch(
    notas[0]!.mensagem,
    /NÃO SE TOCAM/,
    'espécie misturada é outro defeito; afirmar faixa aqui seria resolver dois de uma vez',
  );
});

test('chave composta: basta UMA posição de data impossível para explicar a morte', () => {
  const { ev, notas } = monta({
    E: tab(['NOME', 'DIA'], [['ana', D('2026-01-02')], ['bia', D('2026-03-04')]]),
    D: tab(['N2', 'DT'], [['ana', D('2025-01-02')], ['bia', D('2025-03-04')]]),
  });
  ev.avaliaTabela('let m = Table.NestedJoin(E, {"NOME", "DIA"}, D, {"N2", "DT"}, "N") in m');
  assert.equal(notas.length, 1);
  assert.match(notas[0]!.mensagem, /NÃO SE TOCAM/);
  assert.match(notas[0]!.mensagem, /'DIA' × 'DT'/, 'nomeia a posição impossível, não a chave toda');
});

// ───────────────────────────────────────────── 7. a chave composta

test('chave composta reconcilia só a posição que é texto×número', () => {
  const { ev, notas } = monta(
    {
      E: tab(['NOME', 'ID'], [['ana', 10], ['bia', 11]]),
      D: tab(['N2', 'FK'], [['ana', '10'], ['zoe', '11']]),
    },
    true,
  );
  const t = ev.avaliaTabela('let m = Table.NestedJoin(E, {"NOME", "ID"}, D, {"N2", "FK"}, "N") in m');
  assert.equal(comPar(t), 1, "só 'ana' casa: o nome continua comparado por espécie");
  assert.match(notas[0]!.mensagem, /comparando ID como inteiro/, 'nomeia só a coluna afrouxada');
});
