// O codec do filtro da tela.
//
// Cada teste aqui existe porque a regra que ele guarda, se sumir, produz **número
// errado plausível** — não uma exceção. É a razão de o codec validar em vez de
// aceitar o que vier.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  codificaFiltro,
  decodificaFiltro,
  decodificaFiltros,
  TIPO_DE_TELA,
} from '../src/filtro-url.ts';

test('ida e volta preserva tabela, coluna e valores', () => {
  const f = { tabela: 'PROTOCOLOS GERAL', coluna: 'EQUIPE', valores: ['Equipe Field Service'] };
  const spec = decodificaFiltro(codificaFiltro(f));
  assert.equal(spec.entity, 'PROTOCOLOS GERAL');
  assert.equal(spec.property, 'EQUIPE');
  assert.equal(spec.type, TIPO_DE_TELA);
  assert.deepEqual(spec.conditions, [{ op: 'in', values: ['Equipe Field Service'] }]);
});

/**
 * **O teste que justifica o formato.**
 *
 * `'PROTOCOLOS GERAL'[ANO]` guarda 2026 como número. Um formato que perdesse o tipo
 * mandaria a string "2026", que não casa com linha nenhuma — e o resultado seria zero,
 * calado e plausível. Se este teste cair, o codec voltou a achatar tudo para texto.
 */
test('o tipo do valor atravessa: número continua número, booleano continua booleano', () => {
  const spec = decodificaFiltro(
    codificaFiltro({ tabela: 'T', coluna: 'c', valores: [2026, '2026', true, null] }),
  );
  const cond = spec.conditions[0]!;
  assert.equal(cond.op, 'in');
  assert.deepEqual(cond.op === 'in' ? cond.values : null, [2026, '2026', true, null]);
});

test('valor com | e ] atravessa inteiro', () => {
  // O formato curto `T[c]=a|b` quebraria nestes dois. Há nome de equipe com
  // pontuação nesta base, então o caso não é hipotético.
  const valores = ['Comercial | Interno', 'FIELD AGENDA[Relato]'];
  const spec = decodificaFiltro(codificaFiltro({ tabela: 'T', coluna: 'c', valores }));
  const cond = spec.conditions[0]!;
  assert.deepEqual(cond.op === 'in' ? cond.values : null, valores);
});

/**
 * **Lista vazia é erro, não "sem filtro".**
 *
 * `IN ()` não casa com nada: a tela mostraria zero em todo card com a segmentação
 * parecendo aplicada. Sem este erro, desmarcar a última opção viraria um dashboard
 * inteiro de zeros que parecem resultado.
 */
test('valores vazio erra alto, e a mensagem diz o que fazer', () => {
  assert.throws(
    () => decodificaFiltro(JSON.stringify({ tabela: 'T', coluna: 'c', valores: [] })),
    /vazio.*não mande o parâmetro/s,
  );
});

test('JSON quebrado erra alto e mostra o formato esperado', () => {
  assert.throws(() => decodificaFiltro('{isto nao e json'), /não é JSON.*\?filtro=/s);
});

test('objeto sem tabela ou sem coluna erra alto', () => {
  assert.throws(() => decodificaFiltro(JSON.stringify({ coluna: 'c', valores: [1] })), /'tabela'/);
  assert.throws(() => decodificaFiltro(JSON.stringify({ tabela: 'T', valores: [1] })), /'coluna'/);
  assert.throws(() => decodificaFiltro(JSON.stringify({ tabela: '', coluna: 'c', valores: [1] })), /'tabela'/);
});

test('valores que não é lista erra alto', () => {
  assert.throws(
    () => decodificaFiltro(JSON.stringify({ tabela: 'T', coluna: 'c', valores: 'Equipe' })),
    /'valores' tem de ser uma lista/,
  );
});

/**
 * Objeto e lista aninhados não viram filtro. Sem esta trava eles chegariam a
 * `predicado()` como valor de comparação e casariam com nada — de novo, zero calado.
 */
test('valor que não é literal erra alto, dizendo a posição', () => {
  assert.throws(
    () => decodificaFiltro(JSON.stringify({ tabela: 'T', coluna: 'c', valores: ['ok', { a: 1 }] })),
    /valor 1 é object/,
  );
});

test('array no lugar do objeto erra alto', () => {
  assert.throws(() => decodificaFiltro('[1,2,3]'), /não é um objeto JSON/);
});

test('decodificaFiltros mantém a ordem e traduz todos', () => {
  const brutos = [
    codificaFiltro({ tabela: 'A', coluna: 'x', valores: [1] }),
    codificaFiltro({ tabela: 'B', coluna: 'y', valores: [2] }),
  ];
  const specs = decodificaFiltros(brutos);
  assert.deepEqual(specs.map((s) => s.entity), ['A', 'B']);
});

/** Um filtro ruim no meio derruba o pedido inteiro: aplicar metade e calar a outra
 *  metade mostraria um número filtrado pela metade dizendo-se filtrado. */
test('um filtro inválido no meio da lista derruba a lista toda', () => {
  const brutos = [codificaFiltro({ tabela: 'A', coluna: 'x', valores: [1] }), 'lixo'];
  assert.throws(() => decodificaFiltros(brutos), /não é JSON/);
});
