// `IndiceDeIgualdade` monta os baldes pelo dicionário quando as linhas são vistas.
//
// O risco não é ficar lento: é o caminho rápido divergir do lento e o índice
// devolver **um conjunto de candidatos errado**. E índice errado não erra alto — ele
// devolve menos linhas, e o total sai menor, plausível e sem aviso. É a única classe
// de erro que este projeto não aceita, e é por isso que todo teste aqui compara os
// dois caminhos entre si em vez de fixar o resultado esperado à mão.
//
// O teste mora em `snapshot/` e não em `measure-engine/` porque precisa da vista — a
// dependência aponta de `snapshot` para `measure-engine`, nunca ao contrário.

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Row } from '../../measure-engine/src/dataset.ts';
import { IndiceDeIgualdade } from '../../measure-engine/src/indice.ts';
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

/** As mesmas linhas como objeto simples — o caminho sem dicionário nenhum. */
function objetos(t = tabela()): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < t.linhas; i++) {
    const r: Row = {};
    for (const c of t.nomes) r[c] = t.valor(c, i) as DaxValue;
    out.push(r);
  }
  return out;
}

const COLUNAS = ['cidade', 'n', 'ok', 'quando', 'vazio'] as const;
const PROCURADOS: DaxValue[] = [
  'Canoas', 'CANOAS', 'canoas', 'Esteio', 'nao existe',
  0, 1, 2, 3, 99, true, false, QUANDO, new Date('2020-01-01T00:00:00.000Z'), null,
];

test('vista e objeto dão os MESMOS candidatos, coluna por coluna, valor por valor', () => {
  // A comparação é por POSIÇÃO da linha, não por objeto: os dois lados guardam
  // linhas diferentes (vista contra objeto) que descrevem a mesma tabela.
  const t = tabela();
  const linhasV = vistas(t);
  const linhasO = objetos(t);
  const posV = new Map(linhasV.map((l, i) => [l, i]));
  const posO = new Map(linhasO.map((l, i) => [l, i]));

  for (const c of COLUNAS) {
    const iv = new IndiceDeIgualdade(linhasV, c);
    const io = new IndiceDeIgualdade(linhasO, c);
    for (const v of PROCURADOS) {
      const cv = iv.candidatos(v);
      const co = io.candidatos(v);
      if (cv === null || co === null) {
        assert.equal(cv === null, co === null, `${c}: um recusou responder e o outro não`);
        continue;
      }
      assert.deepEqual(
        cv.map((l) => posV.get(l)).sort(),
        co.map((l) => posO.get(l)).sort(),
        `${c} = ${String(v)}`,
      );
    }
  }
});

test('linha de OUTRA vista não indexa este dicionário — é o guarda do molde', () => {
  // Sem o `Object.getPrototypeOf(row) === molde`, uma linha de outra tabela ainda
  // responde a `indiceDaLinha` e leria ESTE dicionário na posição dela: valor de
  // outra tabela, balde errado, e nenhum erro. Aqui as duas tabelas têm a mesma
  // coluna com valores TROCADOS, para que confundi-las mude o resultado.
  const a = new ConstrutorDeTabela('A', ['cidade'], 2);
  a.poeLinha(['Canoas']);
  a.poeLinha(['Esteio']);
  const b = new ConstrutorDeTabela('B', ['cidade'], 2);
  b.poeLinha(['Esteio']);
  b.poeLinha(['Canoas']);

  const deA = new VistaDeLinhas(a.fecha()).todas() as unknown as Row[];
  const deB = new VistaDeLinhas(b.fecha()).todas() as unknown as Row[];
  // A primeira linha decide o dicionário; as de B têm de cair no caminho lento.
  const misturadas = [deA[0]!, deB[0]!, deA[1]!, deB[1]!];

  const ind = new IndiceDeIgualdade(misturadas, 'cidade');
  const canoas = ind.candidatos('Canoas');
  assert.ok(canoas !== null, 'o índice devia responder');
  assert.deepEqual(new Set(canoas), new Set([deA[0], deB[1]]), 'linha no balde errado');
});

test('coluna AUSENTE em alguma linha desliga o índice, vindo de vista ou não', () => {
  // O guarda (4): coluna que ficou fora da carga, ou calculada ainda não memoizada,
  // é **ausente** e não branca. A vista não pode escondê-lo — uma linha sem a coluna
  // no meio de linhas com ela ainda tem de desligar o índice inteiro.
  for (const linhas of [vistas(), objetos()]) {
    const comBuraco = [...linhas, {} as Row];
    assert.equal(
      new IndiceDeIgualdade(comBuraco, 'cidade').candidatos('Canoas'),
      null,
      'o índice respondeu com uma linha sem a coluna',
    );
  }
});

test('tabela vazia não monta dicionário nenhum e responde NENHUMA linha', () => {
  // `[]` e não `null`: sem linha nenhuma o índice sabe responder, e a resposta certa
  // é "nenhuma casa". `null` significaria "não sei, varra" — e varrer o nada custaria
  // o mesmo, mas esconderia que o índice está completo. É o comportamento de antes do
  // caminho colunar, e fixá-lo aqui é o que impede o caminho novo de mudá-lo.
  assert.deepEqual(new IndiceDeIgualdade([], 'cidade').candidatos('Canoas'), []);
});
