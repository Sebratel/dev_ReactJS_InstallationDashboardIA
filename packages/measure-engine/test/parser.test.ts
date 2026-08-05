import assert from 'node:assert/strict';
import test from 'node:test';
import type { BinaryNode, CallNode, DaxNode, VarBlockNode } from '../src/ast.ts';
import { DaxSyntaxError, parseDax } from '../src/parser.ts';

/** Serializa o AST numa forma compacta, para o assert mostrar a árvore. */
function s(node: DaxNode): string {
  switch (node.type) {
    case 'Number': return String(node.value);
    case 'String': return JSON.stringify(node.value);
    case 'Boolean': return node.value ? 'TRUE' : 'FALSE';
    case 'Missing': return '<vazio>';
    case 'Identifier': return node.name;
    case 'TableRef': return `T(${node.name})`;
    case 'ColumnRef': return `C(${node.table}[${node.column}])`;
    case 'NameRef': return `N(${node.name})`;
    case 'HierarchyPart': return `${s(node.base)}.[${node.part}]`;
    case 'Call': return `${node.name.toUpperCase()}(${node.args.map(s).join(', ')})`;
    case 'Unary': return `(${node.op} ${s(node.operand)})`;
    case 'Binary': return `(${s(node.left)} ${node.op} ${s(node.right)})`;
    case 'In': return `(${s(node.value)} IN ${s(node.source)})`;
    case 'TableConstructor': return `{${node.rows.map((r) => r.map(s).join('|')).join(', ')}}`;
    case 'VarBlock':
      return `VARS[${node.vars.map((v) => `${v.name}=${s(v.expr)}`).join('; ')}] RETURN ${s(node.body)}`;
  }
}

// ---------- referências ----------
test('coluna com e sem aspas, tabela solta, nome solto', () => {
  assert.equal(s(parseDax("'PROTOCOLOS GERAL'[SOLICITACAO]")), 'C(PROTOCOLOS GERAL[SOLICITACAO])');
  assert.equal(s(parseDax('calendar[Protocolo]')), 'C(calendar[Protocolo])');
  assert.equal(s(parseDax("COUNTROWS('REINCIDÊNCIA')")), 'COUNTROWS(T(REINCIDÊNCIA))');
  assert.equal(s(parseDax('[# META]')), 'N(# META)');
});

test('hierarquia de datas .[Parte]', () => {
  assert.equal(
    s(parseDax("DISTINCTCOUNT('CALENDARIO INSTALADO'[DATA INSTALADO].[Dia])")),
    'DISTINCTCOUNT(C(CALENDARIO INSTALADO[DATA INSTALADO]).[Dia])',
  );
});

// ---------- chamadas ----------
test('função com espaço antes do parêntese', () => {
  // O DAX da base escreve `TRUNC ( x )` e `SELECTEDVALUE ( calendar[Data] )`.
  assert.equal(s(parseDax('TRUNC ( 1 )')), 'TRUNC(1)');
  assert.equal(s(parseDax('SELECTEDVALUE ( calendar[Data] )')), 'SELECTEDVALUE(C(calendar[Data]))');
});

test('função sem argumento e TRUE()/FALSE()', () => {
  assert.equal(s(parseDax('TODAY()')), 'TODAY()');
  assert.equal(s(parseDax('BLANK()')), 'BLANK()');
  // TRUE()/FALSE() viram literal: SWITCH(TRUE(), ...) é o idioma da base
  assert.equal(s(parseDax('TRUE()')), 'TRUE');
  assert.equal(s(parseDax('SWITCH(TRUE(), 1, "a")')), 'SWITCH(TRUE, 1, "a")');
  assert.equal(s(parseDax('TRUE')), 'TRUE');
});

test('argumento omitido no meio da lista', () => {
  // RANKX(TabelaDatas, [Data], , ASC, DENSE) é DAX real desta base.
  assert.equal(
    s(parseDax('RANKX(TabelaDatas, [Data], , ASC, DENSE)')),
    'RANKX(TabelaDatas, N(Data), <vazio>, ASC, DENSE)',
  );
});

// ---------- precedência ----------
test('aritmética respeita precedência', () => {
  assert.equal(s(parseDax('1 + 2 * 3')), '(1 + (2 * 3))');
  assert.equal(s(parseDax('(1 + 2) * 3')), '((1 + 2) * 3)');
  assert.equal(s(parseDax('1 - 2 - 3')), '((1 - 2) - 3)', 'subtração associa à esquerda');
});

test('^ associa à direita e liga mais forte que *', () => {
  assert.equal(s(parseDax('2 ^ 3 ^ 2')), '(2 ^ (3 ^ 2))');
  assert.equal(s(parseDax('2 * 3 ^ 2')), '(2 * (3 ^ 2))');
});

test('menos unário liga mais forte que ^ (igual ao Excel)', () => {
  assert.equal(s(parseDax('-2 ^ 2')), '((- 2) ^ 2)');
});

test('& concatena mais fraco que aritmética e mais forte que comparação', () => {
  // `ROUND(a/b, 1) & " Dias"` é a medida `# BACKLOG`
  assert.equal(
    s(parseDax('ROUND([a] / [b], 1) & " Dias"')),
    '(ROUND((N(a) / N(b)), 1) & " Dias")',
  );
  assert.equal(s(parseDax('1 + 2 & "x"')), '((1 + 2) & "x")');
  assert.equal(s(parseDax('"a" & "b" = "ab"')), '(("a" & "b") = "ab")');
});

test('&& liga mais forte que ||', () => {
  assert.equal(s(parseDax('a || b && c')), '(a || (b && c))');
  assert.equal(s(parseDax('a && b || c')), '((a && b) || c)');
});

test('comparação liga mais forte que &&', () => {
  assert.equal(s(parseDax('a = 1 && b = 2')), '((a = 1) && (b = 2))');
});

test('NOT fica entre comparação e && (precedência do DAX)', () => {
  assert.equal(s(parseDax('NOT a = b')), '(NOT (a = b))');
  assert.equal(s(parseDax('NOT a && b')), '((NOT a) && b)');
  // e a forma parentizada, que é a única que a base usa
  assert.equal(s(parseDax('NOT(ISBLANK(x))')), '(NOT ISBLANK(x))');
});

// ---------- IN e construtor de tabela ----------
test('IN com construtor de uma coluna', () => {
  assert.equal(
    s(parseDax('[TIPO] IN { "Fibra", "Rádio" }')),
    '(N(TIPO) IN {"Fibra", "Rádio"})',
  );
});

test('IN com expressão de tabela', () => {
  assert.equal(
    s(parseDax("'PG'[DATA] IN SELECTCOLUMNS('FERIADOS', \"Data\", 'FERIADOS'[Data])")),
    '(C(PG[DATA]) IN SELECTCOLUMNS(T(FERIADOS), "Data", C(FERIADOS[Data])))',
  );
});

test('NOT(x IN {...}) — o idioma real da base', () => {
  assert.equal(
    s(parseDax('NOT ( [TIPO] IN { "a", "b" } )')),
    '(NOT (N(TIPO) IN {"a", "b"}))',
  );
});

test('construtor de várias colunas e vírgula sobrando', () => {
  assert.equal(s(parseDax('{ (1, "x"), (2, "y") }')), '{1|"x", 2|"y"}');
  assert.equal(s(parseDax('{ "a", "b", }')), '{"a", "b"}');
  assert.equal(s(parseDax('{}')), '{}');
});

// ---------- VAR / RETURN ----------
test('VAR único e vários', () => {
  assert.equal(s(parseDax('VAR x = 1 RETURN x')), 'VARS[x=1] RETURN x');
  assert.equal(
    s(parseDax('VAR a = 1\nVAR b = a + 1\nRETURN b')),
    'VARS[a=1; b=(a + 1)] RETURN b',
  );
});

test('VAR aninhado dentro de argumento de função', () => {
  const ast = parseDax('IF(1 = 1, VAR inner = 2 RETURN inner, 0)');
  assert.equal(s(ast), 'IF((1 = 1), VARS[inner=2] RETURN inner, 0)');
});

test('VAR sem RETURN é erro explícito', () => {
  assert.throws(() => parseDax('VAR x = 1'), /VAR sem RETURN/);
});

test('VAR sem nome válido é erro', () => {
  assert.throws(() => parseDax('VAR = 1 RETURN 1'), /nome de variável/);
  assert.throws(() => parseDax('VAR [x] = 1 RETURN 1'), /nome de variável/);
});

// ---------- falhas ----------
test('expressão vazia é erro', () => {
  assert.throws(() => parseDax(''), /expressão vazia/);
  assert.throws(() => parseDax('   -- só comentário'), /expressão vazia/);
});

test('sobra depois do fim é erro, não silêncio', () => {
  // Sem esta checagem, `COUNTROWS(X) lixo` parsearia só a primeira parte.
  assert.throws(() => parseDax("COUNTROWS('X') 'Y'"), /sobrou/);
});

test('parêntese e chave sem fechamento', () => {
  assert.throws(() => parseDax('SUM(1'), /esperava \)/);
  assert.throws(() => parseDax('{ 1, 2'), /esperava \}/);
});

test('operador sem operando à direita', () => {
  assert.throws(() => parseDax('1 +'), /terminou antes/);
});

test('erro de sintaxe carrega linha e coluna', () => {
  const dax = 'CALCULATE(\n    SUM(x),\n    RETURN\n)';
  assert.throws(() => parseDax(dax), (e: unknown) => {
    assert.ok(e instanceof DaxSyntaxError);
    assert.equal(e.line, 3);
    assert.match(e.message, /RETURN não pode começar uma expressão/);
    return true;
  });
});

test('TRUE com argumento é erro', () => {
  assert.throws(() => parseDax('TRUE(1)'), /não recebe argumento/);
});

// ---------- caso real completo ----------
test('# MEDIA CRIADOS inteira, com comentários no meio', () => {
  const dax = `
VAR Total_Criados =
    CALCULATE(
        DISTINCTCOUNT('PROTOCOLOS GERAL'[SOLICITACAO]),
        DATESMTD('PROTOCOLOS GERAL'[DATA CRIADO]),
        FILTER(
            'PROTOCOLOS GERAL',
            WEEKDAY('PROTOCOLOS GERAL'[DATA CRIADO], 2) <> 7 && -- Exclui domingos
            NOT('PROTOCOLOS GERAL'[DATA CRIADO] IN SELECTCOLUMNS('FERIADOS', "Data", 'FERIADOS'[Data]))
        )
    )
VAR Quantidade_Sabados = 3
VAR Dias_Uteis_Ajustados = Quantidade_Sabados + (Quantidade_Sabados * 0.5)
RETURN
    IF(
        Dias_Uteis_Ajustados > 0,
        DIVIDE(Total_Criados, Dias_Uteis_Ajustados),
        BLANK()
    )
`;
  const ast = parseDax(dax) as VarBlockNode;
  assert.equal(ast.type, 'VarBlock');
  assert.deepEqual(
    ast.vars.map((v) => v.name),
    ['Total_Criados', 'Quantidade_Sabados', 'Dias_Uteis_Ajustados'],
  );
  // o sábado valendo 1,5 do achado 7, visível na árvore
  assert.equal(s(ast.vars[2].expr), '(Quantidade_Sabados + (Quantidade_Sabados * 0.5))');
  const body = ast.body as CallNode;
  assert.equal(body.type, 'Call');
  assert.equal(body.name.toUpperCase(), 'IF');
  assert.equal(s(body.args[0] as BinaryNode), '(Dias_Uteis_Ajustados > 0)');
});
