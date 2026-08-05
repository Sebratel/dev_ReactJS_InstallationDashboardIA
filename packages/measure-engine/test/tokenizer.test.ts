import assert from 'node:assert/strict';
import test from 'node:test';
import { DaxSyntaxError, tokenize } from '../src/tokenizer.ts';

/** Só kind:value, para o assert ficar legível. */
function kv(dax: string) {
  return tokenize(dax)
    .filter((t) => t.kind !== 'eof')
    .map((t) => `${t.kind}:${t.value}`);
}

test('números, texto, tabela citada, colchete e identificador', () => {
  assert.deepEqual(kv('3000'), ['number:3000']);
  assert.deepEqual(kv('0.5'), ['number:0.5']);
  assert.deepEqual(kv('"Encerrado"'), ['string:Encerrado']);
  assert.deepEqual(kv("'PROTOCOLOS GERAL'"), ['quoted:PROTOCOLOS GERAL']);
  assert.deepEqual(kv('[SOLICITACAO]'), ['bracket:SOLICITACAO']);
  assert.deepEqual(kv('calendar'), ['ident:calendar']);
});

test('nome de coluna aceita #, %, ° e acento', () => {
  assert.deepEqual(kv('[# AA MÉDIA GERAL]'), ['bracket:# AA MÉDIA GERAL']);
  assert.deepEqual(kv('[% EFETIVIDADE]'), ['bracket:% EFETIVIDADE']);
  assert.deepEqual(kv('[N°PROTOCOLO]'), ['bracket:N°PROTOCOLO']);
  assert.deepEqual(kv('[#DIAS_ÚTEIS_TRABALHADOS]'), ['bracket:#DIAS_ÚTEIS_TRABALHADOS']);
});

test('-- // e /* */ são comentário', () => {
  // `--` tem de ser comentário ANTES de ser dois operadores de menos
  assert.deepEqual(kv('1 -- isto é comentário\n+ 2'), ['number:1', 'op:+', 'number:2']);
  assert.deepEqual(kv('1 // idem\n+ 2'), ['number:1', 'op:+', 'number:2']);
  assert.deepEqual(kv('1 /* no\nmeio */ + 2'), ['number:1', 'op:+', 'number:2']);
  assert.deepEqual(kv('-- só comentário'), []);
});

test('comentário não engole colchete nem aspas de dentro dele', () => {
  const t = kv("COUNTROWS('X') -- usa 'Y'[Z] e \"texto\"");
  assert.deepEqual(t, ['ident:COUNTROWS', 'punct:(', 'quoted:X', 'punct:)']);
});

test('& concatena e && é E lógico — tokens distintos', () => {
  assert.deepEqual(kv('a & b'), ['ident:a', 'op:&', 'ident:b']);
  assert.deepEqual(kv('a && b'), ['ident:a', 'op:&&', 'ident:b']);
  assert.deepEqual(kv('a || b'), ['ident:a', 'op:||', 'ident:b']);
});

test('== é um operador, não dois iguais', () => {
  // Igualdade estrita do DAX. Ler como `=` `=` quebra o parse de
  // PROTOCOLOS GERAL[CONDICAO ITEM].
  assert.deepEqual(kv('a == b'), ['ident:a', 'op:==', 'ident:b']);
  assert.deepEqual(kv('a = b'), ['ident:a', 'op:=', 'ident:b']);
  assert.deepEqual(kv('a <> b'), ['ident:a', 'op:<>', 'ident:b']);
  assert.deepEqual(kv('a <= b'), ['ident:a', 'op:<=', 'ident:b']);
});

test('aspas dobradas escapam dentro de texto e de nome', () => {
  assert.deepEqual(kv('"diz ""oi"""'), ['string:diz "oi"']);
  assert.deepEqual(kv("'O''BRIEN'"), ["quoted:O'BRIEN"]);
});

test('VAR RETURN IN NOT são palavras-chave; o resto é identificador', () => {
  assert.deepEqual(kv('VAR x RETURN x'), ['keyword:VAR', 'ident:x', 'keyword:RETURN', 'ident:x']);
  assert.deepEqual(kv('a IN b'), ['ident:a', 'keyword:IN', 'ident:b']);
  assert.deepEqual(kv('NOT a'), ['keyword:NOT', 'ident:a']);
  // ASC/DENSE/DAY são enums posicionais, não estrutura: seguem identificador
  assert.deepEqual(kv('ASC'), ['ident:ASC']);
  assert.deepEqual(kv('DENSE'), ['ident:DENSE']);
  assert.deepEqual(kv('MINUTE'), ['ident:MINUTE']);
});

test('palavra-chave não distingue caixa', () => {
  assert.deepEqual(kv('var x return x'), ['keyword:var', 'ident:x', 'keyword:return', 'ident:x']);
});

// ---------- falhas ----------
test('delimitador sem fechamento estoura com linha e coluna', () => {
  assert.throws(() => tokenize('"sem fim'), (e: unknown) => {
    assert.ok(e instanceof DaxSyntaxError);
    assert.match(e.message, /aspa dupla/);
    return true;
  });
  assert.throws(() => tokenize("'sem fim"), /aspa simples/);
  assert.throws(() => tokenize('[sem fim'), /colchete sem fechamento/);
  assert.throws(() => tokenize('/* sem fim'), /sem fechamento/);
});

test('nome vazio é erro, não referência anônima', () => {
  assert.throws(() => tokenize('[]'), /vazio entre colchetes/);
  assert.throws(() => tokenize("''"), /vazio entre aspas/);
});

test('caractere que não é DAX estoura em vez de ser ignorado', () => {
  // Silenciar aqui viraria número errado depois.
  assert.throws(() => tokenize('a ? b'), /caractere inesperado/);
  assert.throws(() => tokenize('a @ b'), /caractere inesperado/);
});

test('a posição do erro aponta para a linha certa', () => {
  const dax = 'CALCULATE(\n    SUM(x),\n    y ? z\n)';
  assert.throws(() => tokenize(dax), (e: unknown) => {
    assert.ok(e instanceof DaxSyntaxError);
    assert.equal(e.line, 3, 'linha do caractere inválido');
    return true;
  });
});

test('linha continua certa depois de comentário de bloco multi-linha', () => {
  const dax = '/* a\nb\nc */\n?';
  assert.throws(() => tokenize(dax), (e: unknown) => {
    assert.ok(e instanceof DaxSyntaxError);
    assert.equal(e.line, 4);
    return true;
  });
});

test('linha continua certa depois de texto multi-linha', () => {
  const dax = '"a\nb" ?';
  assert.throws(() => tokenize(dax), (e: unknown) => {
    assert.ok(e instanceof DaxSyntaxError);
    assert.equal(e.line, 2);
    return true;
  });
});
