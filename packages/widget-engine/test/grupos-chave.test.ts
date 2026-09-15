// A chave de uma combinação é montada em dois lugares. Eles têm de concordar.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUE ESTE TESTE EXISTE
//
// `chaveDeValores` é a definição de referência: `valores.map(identityKey).join(' ')`.
// Mas o laço de tabela única de `enumeraCombinacoes` **não** a chama — ele concatena
// a string direto, sem o array intermediário, porque ali a chave sai do dicionário da
// coluna sem passar pelo valor. E `filtrosDe` monta a sua a partir das identidades
// que já calculou por outro motivo.
//
// São formas diferentes do mesmo formato, e a divergência entre elas **não daria erro**:
// duas linhas que deveriam cair no mesmo grupo cairiam em dois, e a tela mostraria
// dois grupos com um número menor em cada. É a família de defeito que este projeto
// recusa — número plausível, sem exceção nenhuma.
//
// O teste fixa o formato e afirma que a concatenação incremental (a forma do laço)
// produz exatamente o que `chaveDeValores` produz, incluindo nos casos de borda que
// a concatenação trata à mão: zero valores e um valor só.

import assert from 'node:assert/strict';
import test from 'node:test';
import { chaveDeValores } from '../src/grupos.ts';
import { BLANK, identityKey, type DaxValue } from '../../measure-engine/src/value.ts';

const SEPARADOR = ' ';

/** A forma do laço de tabela única: concatena sem array intermediário. */
function incremental(valores: readonly DaxValue[]): string {
  const n = valores.length;
  let k = n === 0 ? '' : identityKey(valores[0]!);
  for (let j = 1; j < n; j++) k += SEPARADOR + identityKey(valores[j]!);
  return k;
}

/** A forma de `filtrosDe`: as identidades já calculadas, unidas. */
function porIdentidades(valores: readonly DaxValue[]): string {
  return valores.map(identityKey).join(SEPARADOR);
}

const CASOS: { nome: string; valores: DaxValue[] }[] = [
  { nome: 'nenhuma chave', valores: [] },
  { nome: 'uma chave de texto', valores: ['Canoas'] },
  { nome: 'uma chave numérica', valores: [42] },
  { nome: 'duas chaves', valores: ['Canoas', 42] },
  { nome: 'três chaves', valores: ['Canoas', 42, new Date(Date.UTC(2026, 0, 15))] },
  { nome: 'com BLANK no meio', valores: ['Canoas', BLANK, 42] },
  { nome: 'só BLANK', valores: [BLANK] },
  { nome: 'todos BLANK', valores: [BLANK, BLANK] },
  { nome: 'booleano', valores: [true, false] },
  { nome: 'zero e string vazia', valores: [0, ''] },
  // Os dois que tornam o separador seguro: se `identityKey` não carregasse o tipo,
  // estes dois pares colidiriam — um grupo a menos, sem erro nenhum.
  { nome: 'texto com o separador dentro', valores: ['a b'] },
  { nome: 'dois textos que juntos parecem um', valores: ['a', 'b'] },
];

for (const c of CASOS) {
  test(`as duas formas concordam — ${c.nome}`, () => {
    const referencia = chaveDeValores(c.valores);
    assert.equal(
      incremental(c.valores),
      referencia,
      `a concatenação incremental (a forma do laço de enumeraCombinacoes) divergiu ` +
        `de chaveDeValores. Duas linhas do mesmo grupo cairiam em grupos diferentes, ` +
        `e a tela mostraria dois números menores em vez de um.`,
    );
    assert.equal(porIdentidades(c.valores), referencia);
  });
}

test('o separador não junta o que identityKey separa', () => {
  // `['a b']` e `['a', 'b']` só não colidem porque `identityKey` carrega o tipo na
  // chave. Se um dia ela deixar de carregar, é aqui que se descobre — e não na tela,
  // com um grupo a menos.
  assert.notEqual(chaveDeValores(['a b']), chaveDeValores(['a', 'b']));
});

test('valores iguais dão a mesma chave, valores diferentes não', () => {
  assert.equal(chaveDeValores(['x', 1]), chaveDeValores(['x', 1]));
  assert.notEqual(chaveDeValores(['x', 1]), chaveDeValores(['x', 2]));
  assert.notEqual(chaveDeValores(['x', 1]), chaveDeValores([1, 'x']));
  // BLANK não é a string vazia nem o zero: são três grupos, não um.
  assert.notEqual(chaveDeValores([BLANK]), chaveDeValores(['']));
  assert.notEqual(chaveDeValores([BLANK]), chaveDeValores([0]));
});
