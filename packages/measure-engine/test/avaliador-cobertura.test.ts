// Quantas das 127 expressões reais o avaliador consegue EXECUTAR.
//
// O QUE ESTE TESTE PROVA E O QUE NÃO PROVA. Ele prova que a expressão roda de
// ponta a ponta sem construção não suportada, sem referência que não resolve e
// sem tipo incompatível. Ele **não** prova paridade: os dados aqui são
// sintéticos, então o número que sai não é o número do Power BI. Paridade exige
// dado real e é a etapa adiada (ver specs/golden/README.md).
//
// A distinção importa porque "o avaliador roda 107 expressões" e "107 expressões
// batem com o relatório" são afirmações muito diferentes, e confundir as duas é
// como um projeto de migração se declara pronto sem estar.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelTable } from '../../semantic-model/src/types.ts';
import { walk } from '../src/ast.ts';
import { Dataset, type Row } from '../src/dataset.ts';
import { Evaluator } from '../src/evaluator.ts';
import { lookupFunction, lookupTableFunction } from '../src/functions.ts';
import { parseDax } from '../src/parser.ts';
import { type DaxValue, makeDate } from '../src/value.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SPECS = path.join(ROOT, 'specs');
const HOJE = makeDate(2026, 8, 4);

/**
 * Tipo das 10 colunas físicas que o TMDL não declara (o Power BI infere da
 * fonte). Explícito e nomeado em vez de heurística por nome de coluna: uma
 * heurística que erra faz uma expressão falhar por motivo inventado, e a
 * contagem de cobertura deixa de significar algo.
 *
 * As de data são confirmadas pelo uso no DAX — WEEKDAY, FORMAT("dddd") e YEAR
 * são aplicados a elas.
 */
const TIPO_NAO_DECLARADO: Record<string, 'data' | 'texto'> = {
  'calendar[data]': 'data',
  'calendario agendamento[data agendado]': 'data',
  'calendario criado[data criado]': 'data',
  'calendario instalado[data instalado]': 'data',
  'calendar[protocolo]': 'texto',
  'base de origem[equipes temporarias]': 'texto',
  'protocolos geral[equipe_base]': 'texto',
  'protocolos[tipo de protocolo]': 'texto',
  'status protocolo dia[status]': 'texto',
  'status protocolo dia[protocolo]': 'texto',
};

/** Datas com segunda, sexta, sábado e domingo — a regra de dia útil precisa das quatro. */
const DATAS = [
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

/** Dataset com 4 linhas por tabela, tipado pelas specs. */
function datasetSintetico(model: SemanticModel): Dataset {
  const dataset = new Dataset();
  for (const t of model.tables.values() as Iterable<ModelTable>) {
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
    if (n.type === 'Call' && !lookupFunction(n.name) && !lookupTableFunction(n.name)) {
      faltam.add(n.name.toUpperCase());
    }
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

/** Dentro do implementado, contando dependências. Travado: se mudar, é informação. */
const NO_ESCOPO = 110;

/** Executam de fato. A diferença com `NO_ESCOPO` é explicada pelo teste abaixo. */
const EXECUTAM = 107;

function noEscopo(model: SemanticModel): Expressao[] {
  return todasAsExpressoes(model).filter((e) => funcoesQueFaltam(e.dax, model).length === 0);
}

test(`${NO_ESCOPO} das 127 expressões estão inteiramente dentro do implementado`, () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  assert.equal(noEscopo(model).length, NO_ESCOPO, 'escalares, agregação e contexto de filtro');
});

/**
 * O que falta, ordenado por quantas expressões cada função destrava. Contado
 * transitivamente, seguindo medidas e colunas calculadas.
 *
 * Serve para a ordem dos passos não ser palpite. Quando `CALCULATE` faltava, ele
 * liderava com 56 e por isso foi feito primeiro; agora o que sobrou é *time
 * intelligence* e funções de conjunto, cada uma com peso pequeno — o que significa
 * que não há mais um bloqueio único e vale fazer por bloco temático.
 */
test('o que falta agora são time intelligence e funções de conjunto, sem bloqueio único', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const bloqueios = new Map<string, number>();
  for (const e of todasAsExpressoes(model)) {
    for (const f of funcoesQueFaltam(e.dax, model)) bloqueios.set(f, (bloqueios.get(f) ?? 0) + 1);
  }
  const ranking = [...bloqueios.entries()].sort((a, b) => b[1] - a[1]);
  assert.deepEqual(ranking.slice(0, 4), [
    ['DATESBETWEEN', 7],
    ['SELECTCOLUMNS', 7],
    ['RANKX', 5],
    ['ENDOFMONTH', 2],
  ]);
  assert.ok(
    ranking[0]![1] < 10,
    `ainda há bloqueio grande: ${ranking[0]![0]} em ${ranking[0]![1]} expressões`,
  );
});

/** Roda cada expressão do escopo e devolve o que passou e o que falhou. */
function executar(model: SemanticModel) {
  const ok: string[] = [];
  const falhas: { nome: string; erro: string }[] = [];

  for (const e of noEscopo(model)) {
    // Dataset e Evaluator novos por expressão: a memorização de coluna calculada
    // escreve na linha, e uma expressão não deve herdar o cache da anterior.
    const dataset = datasetSintetico(model);
    const ev = new Evaluator({ model, dataset, now: HOJE });
    try {
      if (e.medida) {
        ev.measure(e.nome.slice(e.nome.indexOf('[') + 1, e.nome.lastIndexOf(']')));
      } else {
        ev.evaluateExpression(
          e.dax,
          ev.scopeWithRow(ev.rootScope(), e.tabela, dataset.rows(e.tabela)[0]!),
        );
      }
      ok.push(e.nome);
    } catch (err) {
      falhas.push({ nome: e.nome, erro: (err as Error).message.split('\n')[0]! });
    }
  }
  return { ok, falhas };
}

test(`o avaliador executa ${EXECUTAM} expressões reais de ponta a ponta`, () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { ok, falhas } = executar(model);
  const relatorio = falhas.map((f) => `  ${f.nome}\n      ${f.erro}`).join('\n');
  assert.equal(ok.length, EXECUTAM, `executadas ${ok.length}/${NO_ESCOPO}. Falharam:\n${relatorio}`);
});

/**
 * As únicas 3 que não executam são exatamente as 3 medidas mortas do achado 6, e
 * elas devem continuar não executando: apontam para as tabelas `GESTORES` e
 * `CAPACIDADE INSTALAÇÃO`, que não existem no modelo.
 *
 * Vale como confirmação **independente** do achado: o `validate:model` chegou nele
 * lendo referências de texto; o avaliador chega tentando calcular. Dois caminhos
 * diferentes, mesma lista de três.
 *
 * Se alguma passar a executar, ou a tabela voltou ao modelo ou alguém "consertou"
 * a medida sem decisão — e a decisão vigente é replicar fielmente.
 */
test('as 3 que não executam são as 3 medidas mortas do achado 6, cada uma com seu motivo', () => {
  const model = SemanticModel.fromSpecsDir(SPECS);
  const { falhas } = executar(model);

  assert.deepEqual(
    falhas.map((f) => f.nome).sort(),
    [
      'PROTOCOLOS GERAL[# AA MÉDIA EQUIPES]',
      'PROTOCOLOS GERAL[# AA MÉDIA GERAL]',
      'PROTOCOLOS GERAL[# AA TOTAL EQUIPES]',
    ],
  );
  for (const f of falhas) {
    assert.match(
      f.erro,
      /CAPACIDADE INSTALAÇÃO|gestores/i,
      `${f.nome} falhou por outro motivo: ${f.erro}`,
    );
  }
});
