// O resumo de stderr de subprocesso.
//
// A regra sob teste é **qual parte do despejo é a informativa**, e o mutante a matar é
// o código que estava aqui antes: `slice(-3)`. Por isso os despejos abaixo são
// literais, copiados da forma que o Node realmente escreve — um teste com um stderr
// inventado de três linhas passaria com as duas implementações e não provaria nada.

import assert from 'node:assert/strict';
import test from 'node:test';
import { resumoDoErro } from '../src/erro.ts';

/** O despejo que chegou como `} | } | Node.js v24.15.0` em 12/08/2026. */
const DESPEJO_PG = `
node:internal/process/promises:394
    triggerUncaughtException(err, true /* fromPromise */);
    ^

error: canceling statement due to statement timeout
    at Parser.parseErrorMessage (/x/node_modules/pg-protocol/dist/parser.js:283:98)
    at Parser.handlePacket (/x/node_modules/pg-protocol/dist/parser.js:122:29)
    at TCP.callbackTrampoline (node:internal/async_hooks:130:17) {
  length: 108,
  severity: 'ERROR',
  code: '57014',
  file: 'postgres.c',
  routine: 'ProcessInterrupts'
}
}

Node.js v24.15.0
`;

test('pega a linha do erro, não o rodapé do despejo', () => {
  const r = resumoDoErro(DESPEJO_PG);
  assert.match(r, /canceling statement due to statement timeout/);
  assert.doesNotMatch(r, /Node\.js v24/, 'o banner de versão não informa nada');
  assert.doesNotMatch(r, /^\}/, 'nem a chave de fechamento');
});

test('o mutante morre: as três ÚLTIMAS linhas não contêm o erro', () => {
  // Este é o teste que cai se alguém voltar para `slice(-3)`. Ele afirma sobre o
  // dado, não sobre a implementação: o fim deste despejo real é vazio de informação.
  const ultimas = DESPEJO_PG.split('\n').map((l) => l.trim()).filter(Boolean).slice(-3);
  assert.deepEqual(ultimas, ['}', '}', 'Node.js v24.15.0']);
  assert.doesNotMatch(ultimas.join(' | '), /timeout|error/i);
  // E o resumo tem de dizer algo que aquelas três linhas não diziam.
  assert.match(resumoDoErro(DESPEJO_PG), /timeout/);
});

test('erro da camada M é reconhecido pelo prefixo Expression.Error', () => {
  const dump = `
alguma pilha irrelevante
Expression.Error: A condição do \`if\` deu null, e M exige logical (true/false).
    at avalia (/x/packages/transform-engine/src/avaliador.ts:1:1)
`;
  assert.match(resumoDoErro(dump), /^Expression\.Error: A condição/);
});

test('Error maiúsculo com nome composto também casa', () => {
  for (const nome of ['Error', 'TypeError', 'RangeError', 'DaxEvalError', 'AggregateError']) {
    const r = resumoDoErro(`ruído\n${nome}: mensagem que interessa\n    at algo\n`);
    assert.match(r, /mensagem que interessa/, nome);
  }
});

test('sem nada que pareça erro, devolve as três PRIMEIRAS não-vazias', () => {
  const r = resumoDoErro('\n\nprimeira\n\nsegunda\nterceira\nquarta\n');
  assert.equal(r, 'primeira | segunda | terceira');
});

test('stderr vazio diz que está vazio, em vez de string vazia', () => {
  // String vazia no relatório leria como "falhou sem motivo", o que é uma afirmação
  // mais forte do que "o processo não falou nada".
  assert.match(resumoDoErro('   \n\n  '), /não escreveu nada/);
  assert.match(resumoDoErro(''), /não escreveu nada/);
});

test('o resumo é limitado a 400 caracteres', () => {
  const r = resumoDoErro(`Error: ${'x'.repeat(900)}`);
  assert.equal(r.length, 400);
});

test('a palavra "error" no meio da frase não vira começo de erro', () => {
  // `error` só conta com dois-pontos logo depois — é o formato do node-postgres.
  // Sem isso, uma linha de log que menciona "error" roubaria a escolha.
  const r = resumoDoErro('a linha fala de error mas não é uma\nError: esta é\n');
  assert.match(r, /^Error: esta é/);
});
