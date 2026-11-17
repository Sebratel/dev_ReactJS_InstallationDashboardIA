// QA D-13 — por que a DATA INSTALADO dependia da sorte, e o que a janela do SQL conserta.
//
// **O defeito.** `DATA INSTALAÇÃO` (coluna DAX) cai em `[DATA ALOCAÇÃO]`, que vem da
// `alocacao-patrimonio` por `Table.NestedJoin` + `Table.ExpandTableColumn` + um
// `Table.Distinct(..., {"SOLICITACAO"})` lá embaixo. Um protocolo pode ter VÁRIAS
// alocações de patrimônio, e o `Distinct` guarda **a primeira linha da ordem corrente** —
// ordem que nem o SQL (sem `ORDER BY`) nem o M fixam. Resultado medido no snapshot de
// 20/10/2026: das 222 solicitações com mais de uma data, a plataforma ficou com a
// primeira em 148, com a última em 72 e com uma do meio em 1. Não era regra errada: era
// ausência de regra. O protocolo 1791835, que o QA conferiu, caiu no lado errado — 11/09
// no painel, 31/08 no Power BI.
//
// **O conserto** é dar a resposta antes do sorteio: a `alocacao-patrimonio` passa a
// trazer `min(out_date) OVER (PARTITION BY SOLICITACAO)`, igual em todas as linhas do
// protocolo, e o M expande essa coluna no lugar da de cada item. Qual linha sobrevive ao
// `Distinct` deixa de importar para a data.
//
// Este teste reproduz o mecanismo nas DUAS ordens possíveis — é o que mostra que o
// conserto não é "mudou o número", e sim "o número parou de depender da ordem".

import assert from 'node:assert/strict';
import test from 'node:test';
import { MEvaluator } from '../src/evaluator.ts';
import { standardConstants, standardFunctions } from '../src/functions.ts';
import { linha, MTable, type MRow, type MValue } from '../src/value.ts';

const HOJE = new Date(Date.UTC(2026, 10, 16, 12, 0, 0));

function ev(queries: Record<string, MValue>): MEvaluator {
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

function tab(cols: string[], linhas: MValue[][]): MTable {
  return new MTable(
    cols,
    linhas.map((vs) => linha(cols.map((c, i) => [c, vs[i]] as const))),
  );
}

const PRIMEIRA = new Date(Date.UTC(2026, 7, 31));
const SEGUNDA = new Date(Date.UTC(2026, 8, 11));

/**
 * As duas alocações do protocolo, nas duas ordens em que o banco pode devolvê-las.
 * `DATA SAIDA PRIMEIRA` é o que a janela do SQL calcula: igual nas duas linhas.
 */
function alocacoes(ordem: 'cronologica' | 'invertida'): MTable {
  const linhas: MValue[][] = [
    ['A-1791835', PRIMEIRA, PRIMEIRA],
    ['A-1791835', SEGUNDA, PRIMEIRA],
  ];
  return tab(
    ['SOLICITACAO', 'DATA SAIDA', 'DATA SAIDA PRIMEIRA'],
    ordem === 'cronologica' ? linhas : [...linhas].reverse(),
  );
}

/** O trecho real do M: mescla, expande UMA coluna de data, e deduplica por solicitação. */
function dataQueSobrevive(ordem: 'cronologica' | 'invertida', coluna: string): MValue {
  const protocolos = tab(['SOLICITACAO', 'N°PROTOCOLO'], [['A-1791835', 1791835]]);
  const t = ev({ P: protocolos, AL: alocacoes(ordem) }).avaliaTabela(
    'let m = Table.NestedJoin(P, {"SOLICITACAO"}, AL, {"SOLICITACAO"}, "AP", JoinKind.LeftOuter),' +
      ` x = Table.ExpandTableColumn(m, "AP", {"${coluna}"}, {"DT"}),` +
      ' d = Table.Distinct(x, {"SOLICITACAO"}) in d',
  );
  assert.equal(t.rowCount, 1, 'o Distinct deixa uma linha por solicitação');
  return (t.rows[0] as MRow).get('DT') ?? null;
}

test('o defeito: a data de cada item depende da ordem em que o banco devolveu as linhas', () => {
  const comOrdemBoa = dataQueSobrevive('cronologica', 'DATA SAIDA');
  const comOrdemRuim = dataQueSobrevive('invertida', 'DATA SAIDA');
  assert.deepEqual(comOrdemBoa, PRIMEIRA);
  assert.deepEqual(comOrdemRuim, SEGUNDA, 'mesma consulta, mesma data de instalação diferente');
  assert.notDeepEqual(
    comOrdemBoa,
    comOrdemRuim,
    'se estas duas passarem a ser iguais, o defeito mudou de forma — reveja o teste, não o apague',
  );
});

test('o conserto: a coluna da janela dá a MESMA data nas duas ordens', () => {
  assert.deepEqual(dataQueSobrevive('cronologica', 'DATA SAIDA PRIMEIRA'), PRIMEIRA);
  assert.deepEqual(dataQueSobrevive('invertida', 'DATA SAIDA PRIMEIRA'), PRIMEIRA);
});

test('a regra escolhida é a PRIMEIRA alocação — 31/08 no protocolo que o QA conferiu', () => {
  // O Power BI mostra 31/08 para o 1791835; o painel mostrava 11/09. A alocação
  // posterior é troca ou complemento de equipamento e não move a data da instalação.
  assert.deepEqual(dataQueSobrevive('invertida', 'DATA SAIDA PRIMEIRA'), PRIMEIRA);
});
