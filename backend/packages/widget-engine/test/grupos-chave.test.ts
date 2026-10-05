// A combinação de um grupo é decidida em dois lugares. Eles têm de concordar.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUE ESTE TESTE EXISTE
//
// `chaveDeValores` é a definição de referência: `valores.map(identityKey).join(' ')`.
// Mas os laços de `enumeraCombinacoes` **não** a chamam: desde o ACHADOS #179 eles
// NUMERAM as combinações (`NumeradorDeCombinacoes`), sem montar string nenhuma, porque
// nas tabelas de relato a string tinha o tamanho do relato e era refeita por linha. E
// `filtrosDe` monta a sua a partir das identidades que já calculou por outro motivo.
//
// São formas diferentes da mesma regra, e a divergência entre elas **não daria erro**:
// duas linhas que deveriam cair no mesmo grupo cairiam em dois, e a tela mostraria
// dois grupos com um número menor em cada. É a família de defeito que este projeto
// recusa — número plausível, sem exceção nenhuma.
//
// O teste fixa o formato da chave e afirma que o numerador separa os grupos
// exatamente como a chave separa: mesmo número ⇔ mesma chave, numeração densa e na
// ordem de primeira aparição (o índice do grupo na lista É o número).

import assert from 'node:assert/strict';
import test from 'node:test';
import { NumeradorDeCombinacoes, chaveDeValores } from '../src/grupos.ts';
import { BLANK, identityKey, type DaxValue } from '../../measure-engine/src/value.ts';

const SEPARADOR = ' ';

/** A forma de `filtrosDe`: as identidades já calculadas, unidas. */
function porIdentidades(valores: readonly DaxValue[]): string {
  return valores.map(identityKey).join(SEPARADOR);
}

/** A forma dos laços: numera chave a chave. */
function numera(numerador: NumeradorDeCombinacoes, valores: readonly DaxValue[]): number {
  let g = numerador.interna(0, identityKey(valores[0]!));
  for (let j = 1; j < valores.length; j++) g = numerador.junta(g, j, numerador.interna(j, identityKey(valores[j]!)));
  return g;
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
  test(`a chave de filtrosDe é a de referência — ${c.nome}`, () => {
    assert.equal(porIdentidades(c.valores), chaveDeValores(c.valores));
  });
}

test('o numerador separa os grupos exatamente como chaveDeValores', () => {
  // Combinações de 3 chaves com colisões de propósito: texto que só muda de caixa
  // (`identityKey` ignora a caixa — é o MESMO grupo), número e texto do mesmo dígito
  // (grupos diferentes), BLANK, data e a mesma data em outro objeto.
  const a = ['Canoas', 'CANOAS', 'Esteio', '1', BLANK, ''];
  const b = [1, '1', BLANK, 0, true];
  const c = [new Date(Date.UTC(2026, 0, 15)), new Date(Date.UTC(2026, 0, 15)), new Date(Date.UTC(2026, 0, 16)), 'x', BLANK];
  const linhas: DaxValue[][] = [];
  let semente = 7;
  const sorteia = <T,>(xs: readonly T[]): T => {
    semente = (semente * 1103515245 + 12345) & 0x7fffffff;
    return xs[semente % xs.length]!;
  };
  for (let i = 0; i < 2000; i++) linhas.push([sorteia(a), sorteia(b), sorteia(c)]);

  const numerador = new NumeradorDeCombinacoes(3);
  const numeroDaChave = new Map<string, number>();
  const ordem: string[] = [];
  for (const valores of linhas) {
    const g = numera(numerador, valores);
    const k = chaveDeValores(valores);
    const visto = numeroDaChave.get(k);
    if (visto === undefined) {
      // Número novo ⇔ chave nova, e é sempre o próximo: denso, na ordem de aparição.
      assert.equal(g, ordem.length, 'chave nova recebeu um número que não é o próximo');
      numeroDaChave.set(k, g);
      ordem.push(k);
    } else {
      assert.equal(g, visto, 'a mesma chave recebeu dois números — um grupo partido em dois');
    }
  }
  assert.ok(ordem.length > 50, 'o sorteio devia produzir muitas combinações');
  assert.ok(ordem.length < 2000, 'o sorteio devia produzir repetições');
});

test('a tabela de pares cresce sem perder número', () => {
  // Mais que a capacidade inicial (1024, metade cheia = 512), várias vezes.
  const numerador = new NumeradorDeCombinacoes(2);
  const numeros = new Map<string, number>();
  for (let i = 0; i < 20_000; i++) {
    const v: DaxValue[] = [i % 997, i % 1009];
    const g = numera(numerador, v);
    const k = chaveDeValores(v);
    const visto = numeros.get(k);
    if (visto === undefined) numeros.set(k, g);
    else assert.equal(g, visto);
  }
  assert.deepEqual([...numeros.values()], [...numeros.keys()].map((_, i) => i));
});

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
