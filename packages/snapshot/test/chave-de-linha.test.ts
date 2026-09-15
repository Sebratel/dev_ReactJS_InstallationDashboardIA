// `leitorDeChaveDeLinha` responde pelo dicionário quando pode e por valor quando não
// pode — e as duas respostas têm de ser **a mesma string**.
//
// O oráculo de todo teste aqui é o próprio `rowKey`, que é o caminho que já existia.
// Fixar a chave esperada à mão provaria menos: o que interessa não é o formato dela, é
// os dois caminhos não divergirem. E divergir aqui não erra alto — a chave é usada
// como conjunto em `filterFromTable`, então uma chave diferente faz a linha deixar de
// passar num filtro e o total sai **menor, plausível e sem aviso**.
//
// Mora em `snapshot/` porque precisa da vista; a dependência aponta de `snapshot` para
// `measure-engine`, nunca ao contrário.

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Row } from '../../measure-engine/src/dataset.ts';
import { leitorDeChaveDeLinha, rowKey } from '../../measure-engine/src/filter.ts';
import type { DaxValue } from '../../measure-engine/src/value.ts';
import { VistaDeLinhas } from '../src/linha-vista.ts';
import { ConstrutorDeTabela, type TabelaColunar } from '../src/tabela-colunar.ts';

const QUANDO = new Date('2026-03-04T00:00:00.000Z');

/** Repetição de propósito: é ela que faz o dicionário valer alguma coisa. */
function tabela(): TabelaColunar {
  const c = new ConstrutorDeTabela('T', ['cidade', 'n', 'ok', 'quando', 'vazio'], 6);
  c.poeLinha(['Canoas', 1, true, QUANDO, null]);
  c.poeLinha(['CANOAS', 2, false, null, null]);
  c.poeLinha(['canoas', 1, true, QUANDO, null]);
  c.poeLinha(['Esteio', 3, false, null, null]);
  c.poeLinha([null, 1, true, QUANDO, null]);
  c.poeLinha(['Esteio', 0, false, QUANDO, null]);
  return c.fecha();
}

function vistas(t = tabela()): Row[] {
  return new VistaDeLinhas(t).todas() as unknown as Row[];
}

function objetos(t = tabela()): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < t.linhas; i++) {
    const r: Row = {};
    for (const c of t.nomes) r[c] = t.valor(c, i) as DaxValue;
    out.push(r);
  }
  return out;
}

/** Conjuntos de colunas que exercitam ordem, aridade e tipo. */
const CONJUNTOS: readonly (readonly string[])[] = [
  ['cidade'],
  ['n'],
  ['vazio'],
  ['cidade', 'n'],
  ['n', 'cidade'], // ordem trocada: a chave TEM de ser outra
  ['cidade', 'n', 'ok', 'quando', 'vazio'],
];

for (const [rotulo, faz] of [['vista colunar', vistas], ['objeto por linha', objetos]] as const) {
  test(`leitorDeChaveDeLinha: ${rotulo} — a chave é a de rowKey, conjunto por conjunto`, () => {
    const linhas = faz();
    for (const cols of CONJUNTOS) {
      const chaveDe = leitorDeChaveDeLinha(cols);
      for (const l of linhas) {
        assert.equal(chaveDe(l), rowKey(l, cols), `${rotulo}/[${cols.join(',')}]`);
      }
    }
  });
}

test('a ordem das colunas muda a chave, nos dois caminhos', () => {
  // Se o leitor lesse as colunas num conjunto em vez de numa lista, `[cidade,n]` e
  // `[n,cidade]` colidiriam — e `UNION`/`EXCEPT`, que casam por POSIÇÃO, passariam a
  // juntar o que não deviam.
  for (const linhas of [vistas(), objetos()]) {
    const ab = leitorDeChaveDeLinha(['cidade', 'n']);
    const ba = leitorDeChaveDeLinha(['n', 'cidade']);
    const diferentes = linhas.filter((l) => ab(l) !== ba(l));
    assert.ok(diferentes.length > 0, 'nenhuma linha distinguiu as duas ordens');
  }
});

test('coluna SEM dicionário no meio das que têm — a calculada não derruba as outras', () => {
  // `CALCULATE(..., FILTER('T', ...))` expõe as colunas físicas junto com as
  // calculadas. Exigir dicionário para todas jogaria o ganho fora por causa de uma; o
  // que não pode é a mistura mudar a chave.
  const linhas = vistas();
  const cols = ['cidade', 'DOBRO', 'n'];

  // 1) Ausente: coluna calculada que ainda não memoizou. `rowKey` lê `?? null`.
  const semMemo = leitorDeChaveDeLinha(cols);
  for (const l of linhas) assert.equal(semMemo(l), rowKey(l, cols), 'com a calculada ausente');

  // 2) Memoizada: vira propriedade PRÓPRIA da linha, e o leitor tem de enxergá-la.
  //    (Coluna física não pode ser escrita numa vista — o `set` estoura. Por isso a
  //    propriedade própria nunca sombreia uma coluna que tem dicionário.)
  for (const l of linhas) (l as Record<string, DaxValue>)['DOBRO'] = ((l['n'] as number) ?? 0) * 2;
  const comMemo = leitorDeChaveDeLinha(cols);
  for (const l of linhas) assert.equal(comMemo(l), rowKey(l, cols), 'com a calculada memoizada');
});

test('escrever numa coluna FÍSICA da vista estoura — é o que torna o dicionário confiável', () => {
  // Este teste não é sobre o leitor: é sobre a premissa dele. Se um dia a vista passar
  // a aceitar escrita em coluna física, o dicionário fica velho e a chave sai errada
  // sem nada avisar — e é aqui que isso aparece.
  const l = vistas()[0]!;
  assert.throws(
    () => {
      (l as Record<string, DaxValue>)['cidade'] = 'Outra';
    },
    /coluna FÍSICA/,
  );
});

test('linha de OUTRA vista não indexa estes dicionários — é o guarda do molde', () => {
  // Sem o molde, uma linha de outra tabela responde a `indiceDaLinha` e leria ESTES
  // dicionários na posição dela: chave de outra tabela, sem erro. As duas tabelas têm
  // os mesmos valores TROCADOS de posição, para que confundi-las mude a chave.
  const a = new ConstrutorDeTabela('A', ['cidade'], 2);
  a.poeLinha(['Canoas']);
  a.poeLinha(['Esteio']);
  const b = new ConstrutorDeTabela('B', ['cidade'], 2);
  b.poeLinha(['Esteio']);
  b.poeLinha(['Canoas']);

  const deA = new VistaDeLinhas(a.fecha()).todas() as unknown as Row[];
  const deB = new VistaDeLinhas(b.fecha()).todas() as unknown as Row[];

  // A PRIMEIRA linha decide o molde. As de B têm de cair no caminho lento e ainda
  // assim dar a chave certa — que é a de `rowKey`.
  const chaveDe = leitorDeChaveDeLinha(['cidade']);
  chaveDe(deA[0]!);
  for (const l of [...deA, ...deB]) assert.equal(chaveDe(l), rowKey(l, ['cidade']));
  // E o sintoma que o guarda evita, dito explicitamente: B[0] é 'Esteio' e está na
  // posição 0, onde o dicionário de A tem 'Canoas'.
  assert.notEqual(chaveDe(deB[0]!), chaveDe(deA[0]!), 'a linha de B pegou a chave de A');
});

test('tabela sem coluna nenhuma no dicionário não muda a chave', () => {
  const linhas = objetos();
  const chaveDe = leitorDeChaveDeLinha(['cidade', 'n']);
  for (const l of linhas) assert.equal(chaveDe(l), rowKey(l, ['cidade', 'n']));
});

test('lista de colunas VAZIA dá a mesma chave que rowKey dá', () => {
  for (const linhas of [vistas(), objetos()]) {
    const chaveDe = leitorDeChaveDeLinha([]);
    for (const l of linhas) assert.equal(chaveDe(l), rowKey(l, []));
  }
});
