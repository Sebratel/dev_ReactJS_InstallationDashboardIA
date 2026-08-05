// A única métrica honesta de cobertura do front-end: o parser dá conta de TODO
// o DAX que existe na base?
//
// Um parser que cobre "a maior parte" não serve para replicar um relatório — a
// medida que ele não parseia é exatamente a que ninguém vai notar faltando até
// alguém abrir o dashboard.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import { extractRefs } from '../../semantic-model/src/refs.ts';
import { functionsUsed, walk } from '../src/ast.ts';
import { parseDax } from '../src/parser.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SPECS = path.join(ROOT, 'specs');

interface Expressao {
  nome: string;
  dax: string;
}

function todasAsExpressoes(): Expressao[] {
  const model = SemanticModel.fromSpecsDir(SPECS);
  return [
    ...model.measures.map((m) => ({ nome: `${m.table}[${m.name}]`, dax: m.dax })),
    ...model.calculatedColumns.map(({ table, column }) => ({
      nome: `${table.name}[${column.name}] (coluna)`,
      dax: column.dax!,
    })),
  ];
}

test('o parser dá conta das 127 expressões DAX da base', () => {
  const expressoes = todasAsExpressoes();
  assert.equal(expressoes.length, 127, '78 medidas + 49 colunas calculadas');

  const falhas: string[] = [];
  for (const e of expressoes) {
    try {
      parseDax(e.dax);
    } catch (err) {
      falhas.push(`${e.nome}: ${(err as Error).message}`);
    }
  }
  assert.deepEqual(falhas, [], 'toda expressão da base tem de parsear');
});

test('nenhuma expressão parseia para algo vazio', () => {
  // Um parser que devolve nó sem conteúdo passaria o teste acima e falharia
  // depois, no avaliador, longe da causa.
  for (const e of todasAsExpressoes()) {
    const ast = parseDax(e.dax);
    assert.ok(ast, `${e.nome}: AST nula`);
    assert.ok(typeof ast.type === 'string' && ast.type.length > 0, `${e.nome}: nó sem tipo`);
  }
});

/**
 * Inventário das funções DAX a implementar no avaliador, tirado do AST — não de
 * regex sobre o texto. A contagem por regex errava: dizia IF:10 quando são 31,
 * porque não via `if(` minúsculo nem descia nas colunas calculadas.
 *
 * Esta lista é o escopo do avaliador. Se o PBIP passar a usar uma função nova,
 * este teste falha e mostra qual — em vez de o avaliador estourar em produção.
 */
const FUNCOES_ESPERADAS = [
  'ALL', 'AVERAGEX', 'BLANK', 'CALCULATE', 'CALCULATETABLE', 'COALESCE',
  'CONCATENATE', 'CONTAINSSTRING', 'COUNT', 'COUNTROWS', 'DATE', 'DATEDIFF',
  'DATESBETWEEN', 'DATESMTD', 'DATEVALUE', 'DISTINCT', 'DISTINCTCOUNT', 'DIVIDE',
  'ENDOFMONTH', 'EOMONTH', 'EXCEPT', 'FILTER', 'FORMAT', 'HOUR',
  'IF', 'INT', 'INTERSECT', 'ISBLANK', 'ISINSCOPE', 'LOOKUPVALUE',
  'LOWER', 'MAX', 'MIN', 'MOD', 'MONTH', 'NOW',
  'OR', 'QUOTIENT', 'RANKX', 'ROUND', 'SELECTCOLUMNS', 'SELECTEDVALUE',
  'STARTOFMONTH', 'SUBSTITUTE', 'SUM', 'SWITCH', 'TIME', 'TODAY',
  'TREATAS', 'TRUNC', 'UNION', 'VALUES', 'WEEKDAY', 'YEAR',
];

test('o escopo do avaliador são estas 54 funções', () => {
  const usadas = new Set<string>();
  for (const e of todasAsExpressoes()) {
    for (const f of functionsUsed(parseDax(e.dax))) usadas.add(f);
  }
  assert.deepEqual(
    [...usadas].sort(),
    FUNCOES_ESPERADAS,
    'função DAX nova (ou removida) no PBIP — atualize o escopo do avaliador',
  );
});

/**
 * Verificação cruzada entre duas implementações escritas separadamente: o
 * scanner de `semantic-model/refs.ts` (varredura por caractere, sem gramática) e
 * este parser (gramática completa, AST).
 *
 * Se os dois concordam sobre quais colunas, tabelas e nomes cada expressão
 * referencia, é improvável que ambos estejam errados do mesmo jeito. Se
 * divergirem, um dos dois está lendo o DAX errado — e é melhor descobrir aqui do
 * que num número de dashboard.
 */
test('parser e scanner concordam sobre as referências das 127 expressões', () => {
  const divergencias: string[] = [];

  for (const e of todasAsExpressoes()) {
    const doScanner = new Set<string>();
    for (const r of extractRefs(e.dax)) {
      if (r.kind === 'column') doScanner.add(`C:${r.table.toLowerCase()}[${r.column.toLowerCase()}]`);
      else if (r.kind === 'table') doScanner.add(`T:${r.table.toLowerCase()}`);
      else if (r.kind === 'bare') doScanner.add(`N:${r.name.toLowerCase()}`);
    }

    const doParser = new Set<string>();
    walk(parseDax(e.dax), (n) => {
      if (n.type === 'ColumnRef') doParser.add(`C:${n.table.toLowerCase()}[${n.column.toLowerCase()}]`);
      else if (n.type === 'TableRef') doParser.add(`T:${n.name.toLowerCase()}`);
      else if (n.type === 'NameRef') doParser.add(`N:${n.name.toLowerCase()}`);
    });

    const soScanner = [...doScanner].filter((x) => !doParser.has(x));
    const soParser = [...doParser].filter((x) => !doScanner.has(x));
    if (soScanner.length || soParser.length) {
      divergencias.push(
        `${e.nome} — só no scanner: [${soScanner.join(', ')}] / só no parser: [${soParser.join(', ')}]`,
      );
    }
  }

  assert.deepEqual(divergencias, []);
});

test('as 3 medidas mortas do achado 6 parseiam — o problema delas não é sintaxe', () => {
  // Elas referenciam tabela inexistente. O parser não tem como saber disso, e
  // não é papel dele: quem reprova é o validate:model. Serve para deixar claro
  // que "parseia" não significa "pode ser avaliada".
  const model = SemanticModel.fromSpecsDir(SPECS);
  for (const nome of ['# AA MÉDIA GERAL', '# AA TOTAL EQUIPES', '# AA MÉDIA EQUIPES']) {
    const m = model.measure(nome);
    assert.ok(m, `${nome} existe no modelo`);
    assert.doesNotThrow(() => parseDax(m.dax), `${nome} deveria parsear`);
  }
});
