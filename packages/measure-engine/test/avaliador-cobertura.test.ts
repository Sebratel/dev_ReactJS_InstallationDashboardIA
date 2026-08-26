// Quantas das 127 expressões reais o avaliador consegue EXECUTAR.
//
// O QUE ESTE TESTE PROVA E O QUE NÃO PROVA. Ele prova que a expressão roda de
// ponta a ponta sem construção não suportada, sem referência que não resolve e
// sem tipo incompatível. Ele **não** prova paridade: os dados aqui são
// sintéticos, então o número que sai não é o número do Power BI. Paridade exige
// dado real e é a etapa adiada (ver specs/golden/README.md).
//
// A distinção importa porque "o avaliador roda 59 expressões" e "59 expressões
// batem com o relatório" são afirmações muito diferentes, e confundir as duas é
// como um projeto de migração se declara pronto sem estar.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelTable } from '../../semantic-model/src/types.ts';
import { walk } from '../src/ast.ts';
import {
  calculatedTableDependencies,
  calculatedTableOrder,
  materializeCalculatedTables,
} from '../src/calculated.ts';
import { Dataset, type Row } from '../src/dataset.ts';
import { Evaluator } from '../src/evaluator.ts';
import { isTableValue } from '../src/filter.ts';
import { lookupFunction } from '../src/functions.ts';
import { parseDax } from '../src/parser.ts';
import { type DaxValue, makeDate } from '../src/value.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SPECS = path.join(ROOT, 'specs');
const HOJE = makeDate(2026, 8, 4);

/**
 * Tipo das colunas físicas que o TMDL não declara (o Power BI infere da fonte).
 * Explícito e nomeado em vez de heurística por nome de coluna: uma heurística que
 * erra faz uma expressão falhar por motivo inventado, e a contagem de cobertura
 * deixa de significar algo.
 *
 * **Eram 10 antes da fase 2b.7, e 9 delas eram colunas de tabela calculada** —
 * `calendar[Data]`, os três `CALENDARIO ...`, `BASE DE ORIGEM`, `PROTOCOLOS`,
 * `Status Protocolo Dia`. Não faltava declaração nenhuma nessas: o tipo delas vem
 * do DAX que produz a tabela, e o que faltava era avaliar esse DAX. Agora que a
 * materialização existe, o palpite caiu para **uma** coluna — e ela é o achado 15,
 * `PROTOCOLOS GERAL[EQUIPE_BASE]`, declarada `calculated` no TMDL sem expressão
 * nenhuma.
 */
const TIPO_NAO_DECLARADO: Record<string, 'data' | 'texto'> = {
  'protocolos geral[equipe_base]': 'texto',
};

/**
 * Datas com segunda, sexta, sábado e domingo — a regra de dia útil precisa das
 * quatro — e **uma fora de 2026**.
 *
 * A de 2025 entrou depois, e por um motivo medido: com as quatro datas todas em
 * agosto de 2026, todo filtro de ano do tipo `>= DATE(2026,1,1)` aceitava as
 * quatro linhas. Calendário aceito por inteiro não restringe nada, então a
 * propagação por relacionamento **nunca disparava** e o teste de efeito da
 * propagação media zero. O zero era sobre os dados, não sobre a propagação.
 *
 * 04/08/2025 também é segunda, então a cobertura de dia da semana continua igual.
 */
const DATAS = [
  makeDate(2025, 8, 4),
  makeDate(2026, 8, 3),
  makeDate(2026, 8, 7),
  makeDate(2026, 8, 8),
  makeDate(2026, 8, 9),
];

function valorSintetico(tipo: string | null, chave: string, i: number): DaxValue {
  const efetivo = tipo ?? (TIPO_NAO_DECLARADO[chave] === 'data' ? 'dateTime' : 'string');
  switch (efetivo) {
    case 'dateTime':
      return DATAS[i % DATAS.length]!;
    case 'int64':
      return (i + 1) * 10;
    case 'double':
      return (i + 1) * 1.5;
    default:
      return `v${i % 2}`;
  }
}

/**
 * Dataset com uma linha por data em `DATAS`, tipado pelas specs — e **só das 18
 * tabelas que vêm de query**.
 *
 * As 7 calculadas ficam de fora de propósito, e isso é a mudança da fase 2b.7.
 * Antes elas entravam aqui com linhas inventadas, o que escondia duas coisas de
 * uma vez: que o avaliador não sabia materializá-las, e que três delas são o
 * caminho de propagação de filtro. Inventar linha para `CALENDARIO INSTALADO` é
 * inventar o calendário que divide as médias.
 */
function datasetSintetico(model: SemanticModel): Dataset {
  const dataset = new Dataset();
  for (const t of model.tables.values() as Iterable<ModelTable>) {
    if (t.tableDax) continue; // as linhas vêm do DAX; ver `ambiente`
    const rows: Row[] = [];
    for (let i = 0; i < DATAS.length; i++) {
      const row: Row = {};
      for (const c of t.columns) {
        if (c.calculated) continue; // vem do DAX, não dos dados
        const chave = `${t.name.toLowerCase()}[${c.name.toLowerCase()}]`;
        row[c.name] = valorSintetico(c.type, chave, i);
      }
      rows.push(row);
    }
    dataset.addTable(t.name, rows);
  }
  return dataset;
}

/**
 * Avaliador pronto para uso: dataset sintético das 18 + as 7 calculadas
 * materializadas a partir do DAX.
 *
 * A materialização acontece **dentro** do ambiente e não num passo separado
 * porque ela depende do avaliador: as linhas das 7 saem de avaliar DAX sobre as
 * 18. É a mesma ordem que o Power BI segue no refresh.
 */
function ambiente(model: SemanticModel, propagation?: Propagation) {
  const dataset = datasetSintetico(model);
  const ev = new Evaluator({ model, dataset, now: HOJE, propagation });
  const materializadas = materializeCalculatedTables(ev);
  return { dataset, ev, materializadas };
}

interface Expressao {
  nome: string;
  dax: string;
  medida: boolean;
  tabela: string;
}

function todasAsExpressoes(model: SemanticModel): Expressao[] {
  return [
    ...model.measures.map((m) => ({ nome: `${m.table}[${m.name}]`, dax: m.dax, medida: true, tabela: m.table })),
    ...model.calculatedColumns.map(({ table, column }) => ({
      nome: `${table.name}[${column.name}] (coluna)`,
      dax: column.dax!,
      medida: false,
      tabela: table.name,
    })),
  ];
}

/**
 * Funções que faltam para avaliar a expressão — seguindo **tudo de que ela
 * depende**: medidas referenciadas e colunas calculadas usadas, recursivamente.
 *
 * As duas travessias existem porque as duas foram necessárias, e cada uma foi
 * descoberta pelo teste de execução, não por leitura:
 *
 *  - medidas: `[Porcentagem]` é só `DIVIDE([A], [B])`, mas `[B]` usa CALCULATE —
 *    a contagem ingênua dizia 69 quando eram 62;
 *  - colunas calculadas: `SUM('CALENDARIO INSTALADO'[PESO])` não mostra nada
 *    além de SUM, e o DAX de `[PESO]` usa LOOKUPVALUE — de 62 para 60.
 *
 * É a razão de existir um teste que executa em vez de só analisar: análise
 * estática que esquece uma aresta reporta cobertura maior do que a real, e
 * cobertura inflada é pior que cobertura desconhecida.
 */
function funcoesQueFaltam(dax: string, model: SemanticModel, visitadas = new Set<string>()): string[] {
  const faltam = new Set<string>();
  const dependencias: (() => string | null)[] = [];

  walk(parseDax(dax), (n) => {
    if (n.type === 'Call' && !lookupFunction(n.name)) faltam.add(n.name.toUpperCase());
    if (n.type === 'NameRef') {
      dependencias.push(() => (`m:${n.name.toLowerCase()}`));
    }
    if (n.type === 'ColumnRef') {
      dependencias.push(() => `c:${n.table.toLowerCase()}[${n.column.toLowerCase()}]`);
    }
  });

  for (const chaveDe of dependencias) {
    const chave = chaveDe();
    if (chave === null || visitadas.has(chave)) continue; // ciclo: quem reprova é o avaliador
    visitadas.add(chave);

    if (chave.startsWith('m:')) {
      const m = model.measure(chave.slice(2));
      if (m) for (const f of funcoesQueFaltam(m.dax, model, visitadas)) faltam.add(f);
      continue;
    }

    const [tabela, coluna] = chave.slice(2).replace(/\]$/, '').split('[') as [string, string];
    const col = model.column(tabela, coluna);
    if (col?.calculated && col.dax) {
      for (const f of funcoesQueFaltam(col.dax, model, visitadas)) faltam.add(f);
    }
  }

  return [...faltam].sort();
}

// ---------------------------------------------------------------------------

test('68 das 127 expressões só usam funções já implementadas', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const dentro = todasAsExpressoes(model).filter((e) => funcoesQueFaltam(e.dax).length === 0);
  assert.equal(dentro.length, 68, 'escopo estático do passo 1 (escalares + agregação simples)');
});

/**
 * O que ainda falta, ordenado por quantas expressões cada função destrava.
 *
 * Serve para a ordem dos passos seguintes não ser palpite: `CALCULATE` sozinho
 * está entre 50 expressões e é por isso que contexto de filtro é o passo 2, não
 * o passo 5.
 */
test('o que falta é liderado por CALCULATE — daí a ordem dos próximos passos', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const bloqueios = new Map<string, number>();
  for (const e of todasAsExpressoes(model)) {
    for (const f of funcoesQueFaltam(e.dax)) bloqueios.set(f, (bloqueios.get(f) ?? 0) + 1);
  }
  const ranking = [...bloqueios.entries()].sort((a, b) => b[1] - a[1]);
  assert.deepEqual(ranking.slice(0, 4), [
    ['CALCULATE', 50],
    ['FILTER', 16],
    ['SELECTEDVALUE', 8],
    ['VALUES', 8],
  ]);
});

/**
 * A contagem que vale: executadas de fato, sobre dados sintéticos.
 *
 * É menor que a contagem estática acima, e a diferença é informação — são
 * expressões cujas funções existem mas que dependem de construção que ainda não
 * existe (tabela em VAR, `[Nome]` de tabela anônima, coluna de texto onde o DAX
 * espera data).
 */
test('o avaliador executa as expressões dentro do escopo, e as que não executa têm motivo registrado', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const dataset = datasetSintetico(model);
  const dentro = todasAsExpressoes(model).filter((e) => funcoesQueFaltam(e.dax).length === 0);

  const ok: string[] = [];
  const falhas: { nome: string; erro: string }[] = [];

  for (const e of dentro) {
    // Evaluator novo por expressão: a memorização de coluna calculada escreve na
    // linha, e uma expressão não deve herdar o cache da anterior.
    const ev = new Evaluator({ model, dataset: datasetSintetico(model), now: HOJE });
    try {
      if (e.medida) ev.measure(e.nome.replace(/^.*?\[/, '').replace(/\]$/, ''));
      else ev.evaluateExpression(e.dax, ev.scopeWithRow(ev.rootScope(), e.tabela, dataset.rows(e.tabela)[0]!));
      ok.push(e.nome);
    } catch (err) {
      falhas.push({ nome: e.nome, erro: (err as Error).message.split('\n')[0]! });
    }
  }

  const relatorio = falhas.map((f) => `  ${f.nome}\n      ${f.erro}`).join('\n');
  assert.equal(
    ok.length,
    EXECUTADAS_ESPERADAS,
    `executadas ${ok.length}/${dentro.length}. Não executadas:\n${relatorio}`,
  );
});

/**
 * Quantas executam hoje. Número travado de propósito: se subir, atualize com a
 * lista do que passou a rodar; se cair, alguma coisa regrediu.
 */
const EXECUTADAS_ESPERADAS = 68;
