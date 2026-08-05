// Testes do parser de M.
//
// Divididos em dois blocos com propósitos diferentes:
//
//   1. **Sintaxe isolada** — cada regra que difere do DAX tem um teste que falha
//      se alguém "simplificar" de volta. `--` não é comentário, `&` é aditivo,
//      `[X]` é campo e não registro.
//   2. **O corpus real** — as 24 `m_expression` extraídas do PBIP. É o teste que
//      não dá para escrever errado: se o parser não lê a base, o resto da fase
//      não existe.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import yaml from 'yaml';
import type { MBinary, MField, MLet, MNode, MRecord } from '../src/ast.ts';
import { MSyntaxError, parseM, parseMLet } from '../src/parser.ts';
import { tokenize } from '../src/tokenizer.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// ─────────────────────────────────────────────────────── tokenizer

test('`--` não é comentário em M: engoliria todo Odbc.Query da base', () => {
  const toks = tokenize('a - -b');
  assert.deepEqual(
    toks.filter((t) => t.kind !== 'eof').map((t) => t.value),
    ['a', '-', '-', 'b'],
  );
});

test('string com `""` escapa aspa, e SQL dentro dela não é sintaxe M', () => {
  const sql = 'select 1 -- nota, {a}, ((b))';
  const node = parseM(`Odbc.Query("dsn", "${sql}")`);
  assert.equal(node.type, 'Call');
  assert.deepEqual(
    node.type === 'Call' ? node.args.map((a) => (a.type === 'Literal' ? a.value : '?')) : [],
    ['dsn', sql],
  );
});

test('`#"nome com espaço"` é identificador, mesmo coincidindo com palavra-chave', () => {
  const toks = tokenize('#"Tipo Alterado" #"let"');
  assert.deepEqual(
    toks.filter((t) => t.kind !== 'eof').map((t) => [t.kind, t.value, t.quoted]),
    [
      ['ident', 'Tipo Alterado', true],
      ['ident', 'let', true],
    ],
  );
});

test('nome pontuado é um token só — `Int64.Type` não é acesso a campo', () => {
  const toks = tokenize('Table.AddColumn Int64.Type JoinKind.LeftOuter');
  assert.deepEqual(
    toks.filter((t) => t.kind === 'ident').map((t) => t.value),
    ['Table.AddColumn', 'Int64.Type', 'JoinKind.LeftOuter'],
  );
});

test('`#construtor` desconhecido falha dizendo o nome, não passa como identificador', () => {
  assert.throws(() => tokenize('#inventado(1)'), /#inventado.*não é construtor/s);
});

test('string não fechada aponta linha e coluna', () => {
  try {
    parseM('let a = "sem fim\nin a');
    assert.fail('deveria ter falhado');
  } catch (err) {
    assert.ok(err instanceof MSyntaxError);
    assert.match(err.message, /String não fechada.*linha 1/s);
  }
});

// ─────────────────────────────────────────────────────── precedência

test('`&` é aditivo em M: `a & b = c` lê como `(a & b) = c`', () => {
  const n = parseM('a & b = c') as MBinary;
  assert.equal(n.type, 'Binary');
  assert.equal(n.op, '=');
  assert.equal((n.left as MBinary).op, '&');
});

test('`and` é mais forte que `or`', () => {
  const n = parseM('a or b and c') as MBinary;
  assert.equal(n.op, 'or');
  assert.equal((n.right as MBinary).op, 'and');
});

test('comparação é mais forte que `and`: o filtro de quadro-funcional depende disso', () => {
  const n = parseM('[GESTOR] = "A" or [GESTOR] = "B"') as MBinary;
  assert.equal(n.op, 'or');
  assert.equal((n.left as MBinary).op, '=');
  assert.equal((n.right as MBinary).op, '=');
});

test('`*` é mais forte que `+`', () => {
  const n = parseM('a + b * c') as MBinary;
  assert.equal(n.op, '+');
  assert.equal((n.right as MBinary).op, '*');
});

test('unário `-` não come o operador binário: `a - -b` são dois nós', () => {
  const n = parseM('a - -b') as MBinary;
  assert.equal(n.op, '-');
  assert.equal(n.right.type, 'Unary');
});

// ─────────────────────────────────────────────────────── registro vs campo

test('`[A]` é campo do `_` implícito; `[A=1]` é registro', () => {
  const campo = parseM('[GESTOR]') as MField;
  assert.equal(campo.type, 'Field');
  assert.equal(campo.target, null);
  assert.equal(campo.field, 'GESTOR');

  const reg = parseM('[PromoteAllScalars=true]') as MRecord;
  assert.equal(reg.type, 'Record');
  assert.deepEqual(reg.fields.map((f) => f.name), ['PromoteAllScalars']);
});

test('`each [A] = "x"` é comparação, não construção de registro', () => {
  // Se isto virasse Record, Table.SelectRows receberia algo sempre verdadeiro e
  // não filtraria linha nenhuma — sem erro, só com número errado.
  const n = parseM('each [STATUS] = "Cancelado"');
  assert.equal(n.type, 'Each');
  const corpo = n.type === 'Each' ? (n.body as MBinary) : null;
  assert.equal(corpo?.type, 'Binary');
  assert.equal(corpo?.op, '=');
  assert.equal((corpo?.left as MField).type, 'Field');
});

test('registro vazio `[]` não é campo sem nome', () => {
  const n = parseM('[]') as MRecord;
  assert.equal(n.type, 'Record');
  assert.equal(n.fields.length, 0);
});

test('campo depois de expressão encadeia: Fonte{[name="X"]}[Data]', () => {
  const n = parseM('Fonte{[name="QUADRO FUNCIONAL",ItemKind="Table"]}[Data]') as MField;
  assert.equal(n.type, 'Field');
  assert.equal(n.field, 'Data');
  assert.equal(n.target?.type, 'Item');
  const item = n.target as { selector: MNode };
  assert.equal(item.selector.type, 'Record');
});

test('nome de campo com espaço sem aspas — o corpus real quebrou o parser aqui', () => {
  // `[DATA CRIADO]`, `[CAPACIDADE MANHÃ]`, `[HR. ALOCAÇÃO]`: generalized
  // identifier do M. Exigir `#"..."` recusava 5 das 24 queries.
  assert.equal((parseM('[DATA CRIADO]') as MField).field, 'DATA CRIADO');
  assert.equal((parseM('[CAPACIDADE MANHÃ]') as MField).field, 'CAPACIDADE MANHÃ');
  assert.equal((parseM('DateTime.Time([DATA CRIADO])').type), 'Call');
});

test('nome com espaço não engole o operador seguinte', () => {
  // `[A] + [B]` não pode virar um campo chamado "A + B".
  const n = parseM('[CAPACIDADE MANHÃ] + [CAPACIDADE TARDE]') as MBinary;
  assert.equal(n.op, '+');
  assert.equal((n.left as MField).field, 'CAPACIDADE MANHÃ');
  assert.equal((n.right as MField).field, 'CAPACIDADE TARDE');
});

test('nome de campo não atravessa quebra de linha', () => {
  // Um `]` esquecido faria o nome engolir o passo seguinte inteiro, e o erro
  // apareceria longe da causa.
  assert.throws(() => parseM('[DATA\nCRIADO]'), /campo|Esperava/);
});

test('campo opcional `[X]?` é distinto de `[X]`', () => {
  assert.equal((parseM('r[X]?') as MField).optional, true);
  assert.equal((parseM('r[X]') as MField).optional, false);
});

test('coluna chamada como palavra-chave ainda é nome de campo', () => {
  // A base tem `[TIME]` e `[TYPE]`; `type` é palavra-chave do M.
  assert.equal((parseM('[type]') as MField).field, 'type');
  assert.equal((parseM('[and]') as MField).field, 'and');
});

// ─────────────────────────────────────────────────────── let, each, if

test('let devolve os passos na ordem, com nome desencapsulado', () => {
  const bindings = parseMLet(
    'let Fonte = 1, #"Tipo Alterado" = 2, #"Linhas Filtradas" = 3 in #"Linhas Filtradas"',
  );
  assert.deepEqual(bindings?.map((b) => b.name), ['Fonte', 'Tipo Alterado', 'Linhas Filtradas']);
});

test('parseMLet devolve null quando a query não é um let — não é erro', () => {
  // `hora-atualizado` é só uma chamada.
  assert.equal(parseMLet('DateTime.LocalNow()'), null);
});

test('`let` sem `in` falha citando quantos passos leu', () => {
  assert.throws(() => parseM('let a = 1, b = 2'), /let.*2 passo/s);
});

test('`if` sem `else` falha explicando que M exige else', () => {
  assert.throws(() => parseM('if a then 1'), /M não tem `if` sem `else`/);
});

test('if/then/else aninhado em each, como na base', () => {
  const n = parseM('each if [a] = 1 then "um" else if [a] = 2 then "dois" else null');
  assert.equal(n.type, 'Each');
  const se = n.type === 'Each' ? n.body : null;
  assert.equal(se?.type, 'If');
  assert.equal(se?.type === 'If' ? se.otherwise.type : null, 'If');
});

test('let aninhado é sintaxe válida — quem recusa é o avaliador, não o parser', () => {
  // O scanner estático de 2b.6 recusa (não sabe descer em função). O parser lê:
  // é a diferença entre "texto malformado" e "semântica não implementada".
  const n = parseM('let f = (x) => let y = x + 1 in y, r = f(1) in r') as MLet;
  assert.equal(n.type, 'Let');
  assert.equal(n.bindings.length, 2);
  assert.equal(n.bindings[0].expr.type, 'Function');
});

// ─────────────────────────────────────────────────────── tipos e lambdas

test('`type text` e `type nullable text` viram nó de tipo', () => {
  assert.deepEqual(parseM('type text'), {
    type: 'Type', name: 'text', start: 0, line: 1, col: 1,
  });
  assert.equal(parseM('type nullable text').type === 'Type' ? (parseM('type nullable text') as { name: string }).name : '', 'nullable text');
});

test('`type table [A = text]` consome o detalhe sem virar erro de sintaxe', () => {
  const n = parseM('type table [Coluna = text, Outra = number]');
  assert.equal(n.type, 'Type');
  assert.equal(n.type === 'Type' ? n.name : '', 'table');
});

test('lista de pares de renomeação vira List de List', () => {
  const n = parseM('{{"de","para"},{"a","b"}}');
  assert.equal(n.type, 'List');
  assert.equal(n.type === 'List' ? n.items.length : 0, 2);
  assert.equal(n.type === 'List' ? n.items[0].type : '', 'List');
});

test('`(x) => e` é função; `(a + b) * c` é agrupamento', () => {
  assert.equal(parseM('(x) => x + 1').type, 'Function');
  const grupo = parseM('(a + b) * c') as MBinary;
  assert.equal(grupo.type, 'Binary');
  assert.equal(grupo.op, '*');
});

test('parâmetro com tipo: `(x as text) => x`', () => {
  const n = parseM('(x as text) => x');
  assert.deepEqual(
    n.type === 'Function' ? n.params : [],
    [{ name: 'x', typeName: 'text' }],
  );
});

test('`#date(2026,1,1)` é chamada, não literal opaco', () => {
  const n = parseM('#date(2026,1,1)');
  assert.equal(n.type, 'Call');
  assert.equal(n.type === 'Call' && n.callee.type === 'Identifier' ? n.callee.name : '', '#date');
});

// ─────────────────────────────────────────────────────── o corpus real

interface QuerySpec {
  id: string;
  m_expression?: string;
}

function corpus(): QuerySpec[] {
  const dir = path.join(ROOT, 'specs', '_catalog', 'queries');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.spec.yaml'))
    .map((f) => yaml.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as QuerySpec)
    .filter((s) => Boolean(s.m_expression));
}

test('as 24 m_expression do PBIP parseiam — inclusive clima-tempo e feriados', () => {
  const falhas: string[] = [];
  for (const q of corpus()) {
    try {
      parseM(q.m_expression!);
    } catch (err) {
      falhas.push(`${q.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  assert.deepEqual(falhas, [], `queries que não parseiam:\n${falhas.join('\n')}`);
});

test('o corpus tem as 24 queries, e nenhuma perdeu o m_expression', () => {
  // Prende o número: se o extrator parar de trazer M de alguma query, o teste
  // acima passaria com menos trabalho e ninguém notaria.
  assert.equal(corpus().length, 24);
});

test('todo passo de todo let tem nome e expressão — nenhum passo vazio', () => {
  for (const q of corpus()) {
    const bindings = parseMLet(q.m_expression!);
    if (!bindings) continue;
    for (const b of bindings) {
      assert.ok(b.name.length > 0, `${q.id}: passo sem nome`);
      assert.ok(b.expr, `${q.id}: passo '${b.name}' sem expressão`);
    }
  }
});

test('o parser lê mais passos que o scanner estático, e clima-tempo é a diferença', () => {
  // 2b.6 mediu 303 passos em 23 queries porque o scanner recusa `clima-tempo`
  // (função M com `let` aninhado). O parser não precisa recusar — e é isso que
  // torna possível executar a query um dia. O número aqui é do parser.
  const total = corpus().reduce((soma, q) => soma + (parseMLet(q.m_expression!)?.length ?? 0), 0);
  const clima = corpus().find((q) => q.id === 'clima-tempo');
  assert.ok(clima, 'clima-tempo saiu do corpus');
  assert.ok(
    (parseMLet(clima!.m_expression!)?.length ?? 0) > 0,
    'clima-tempo deveria ter passos legíveis pelo parser',
  );
  assert.ok(total >= 303, `esperado ao menos os 303 passos de 2b.6, veio ${total}`);
});
