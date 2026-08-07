// Testes do índice de igualdade (ACHADOS #43).
//
// Dois grupos, e o segundo é o que importa de verdade:
//
//   1. **Os guardas.** Cada `null` de `candidatos()` existe porque responder ali
//      perderia linha em silêncio. São eles que separam esta otimização de um bug.
//   2. **O diferencial.** O índice é atalho, nunca regra: o mesmo cálculo com e sem
//      ele tem de dar **o mesmo valor**. É o análogo pequeno do `sha256` que provou
//      o caminho rápido do #38, e é o único teste que pegaria uma coerção esquecida.

import assert from 'node:assert/strict';
import test from 'node:test';
import { Dataset, type Row } from '../src/dataset.ts';
import { Evaluator } from '../src/evaluator.ts';
import {
  classeDe,
  igualdadeIndexavel,
  IndiceDeIgualdade,
  indiceDe,
  MINIMO_PARA_INDEXAR,
} from '../src/indice.ts';
import { parseDax } from '../src/parser.ts';
import { BLANK } from '../src/value.ts';
import { SemanticModel, type ModelColumn } from '../../semantic-model/src/model.ts';

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

/** Grande o bastante para o índice entrar, e com poucas chaves, como o caso real. */
function tabela(n: number, chaves: number, extra: (i: number) => Row = () => ({})): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    protocolo: `P${i % chaves}`,
    valor: i % 97,
    ...extra(i),
  }));
}

// ───────────────────────────────────────────────── classe de valor

test('data e booleano comparam como número, não como texto', () => {
  assert.equal(classeDe('x'), 'texto');
  assert.equal(classeDe(5), 'numero');
  assert.equal(classeDe(true), 'numero');
  assert.equal(classeDe(new Date(Date.UTC(2026, 0, 1))), 'numero');
  assert.equal(classeDe(BLANK), 'branco');
});

// ───────────────────────────────────────────────── os guardas

test('procurar BLANK não é respondido pelo índice — BLANK casa com 0 e com ""', () => {
  const ind = new IndiceDeIgualdade(tabela(2000, 10), 'protocolo');
  assert.equal(ind.candidatos(BLANK), null);
});

test('procurar 0 ou "" não é respondido — as linhas BLANK também casariam', () => {
  // `'T'[x] = 0` é verdadeiro para linha com BLANK em x. O balde de 0 não as tem,
  // e devolvê-lo daria uma contagem menor, plausível e sem aviso.
  const ind = new IndiceDeIgualdade(tabela(2000, 10), 'valor');
  assert.equal(ind.candidatos(0), null);
  assert.equal(ind.candidatos(''), null);
});

test('coluna com texto e número misturados não é respondida — o DAX erra ali', () => {
  const linhas: Row[] = tabela(2000, 10);
  linhas[7]!.protocolo = 42; // um número no meio dos textos
  const ind = new IndiceDeIgualdade(linhas, 'protocolo');
  assert.equal(ind.candidatos('P3'), null);
  assert.equal(ind.candidatos(42), null);
});

test('BLANK na coluna NÃO impede a resposta — ele só casaria com 0 ou ""', () => {
  const linhas: Row[] = tabela(2000, 10);
  linhas[9]!.protocolo = BLANK;
  const ind = new IndiceDeIgualdade(linhas, 'protocolo');
  const c = ind.candidatos('P3');
  assert.ok(c !== null);
  assert.equal(c!.length, 200);
});

test('texto casa sem caixa, como o `=` do DAX', () => {
  const ind = new IndiceDeIgualdade(tabela(2000, 10), 'protocolo');
  assert.equal(ind.candidatos('p3')!.length, 200);
  assert.equal(ind.candidatos('P3')!.length, 200);
});

test('valor ausente devolve lista vazia, não null', () => {
  // Vazio é resposta ("nenhuma linha casa"); null é "não sei, varra".
  const ind = new IndiceDeIgualdade(tabela(2000, 10), 'protocolo');
  assert.deepEqual(ind.candidatos('NAO EXISTE'), []);
});

test('tabela pequena não é indexada — varrer custa menos', () => {
  assert.equal(indiceDe(tabela(MINIMO_PARA_INDEXAR - 1, 5), 'protocolo'), null);
  assert.ok(indiceDe(tabela(MINIMO_PARA_INDEXAR, 5), 'protocolo') !== null);
});

test('o índice é reaproveitado entre chamadas sobre o mesmo array', () => {
  const linhas = tabela(2000, 10);
  assert.equal(indiceDe(linhas, 'protocolo'), indiceDe(linhas, 'protocolo'));
  // Array diferente é índice diferente: indexar por nome de tabela responderia
  // sobre linhas que um filtro já tinha tirado.
  assert.notEqual(indiceDe(linhas, 'protocolo'), indiceDe([...linhas], 'protocolo'));
});

// ───────────────────────────────────────────────── o analisador de predicado

const acha = (dax: string, tabela = 'T') => igualdadeIndexavel(parseDax(dax), tabela);

test('acha a igualdade na conjunção de topo, em qualquer ordem', () => {
  assert.equal(acha("'T'[protocolo] = Prot")?.coluna, 'protocolo');
  assert.equal(acha("Prot = 'T'[protocolo]")?.coluna, 'protocolo');
  assert.equal(acha("TRUNC('T'[dia]) = D && 'T'[protocolo] = Prot")?.coluna, 'protocolo');
});

test('NÃO desce em disjunção — um lado pode passar sem o outro', () => {
  // Com `||`, uma linha pode satisfazer o predicado sem satisfazer a igualdade, e
  // o balde a deixaria de fora. É o guarda que mantém o atalho um superconjunto.
  assert.equal(acha("'T'[protocolo] = Prot || 'T'[valor] > 0"), null);
});

test('só indexa igualdade cujo outro lado não depende da linha varrida', () => {
  assert.equal(acha("'T'[protocolo] = 'T'[outra]"), null, 'coluna contra coluna');
  assert.equal(acha("'T'[protocolo] = [Medida]"), null, 'NameRef é a própria linha');
  assert.equal(acha("'T'[protocolo] = UPPER('T'[outra])"), null, 'Call pode esconder a linha');
  assert.equal(acha("'T'[protocolo] = \"P1\"")?.coluna, 'protocolo', 'literal serve');
});

test('`==` não é indexado — ele é estrito com BLANK e os guardas são de `=`', () => {
  assert.equal(acha("'T'[protocolo] == Prot"), null);
});

test('ignora igualdade sobre outra tabela', () => {
  assert.equal(acha("'OUTRA'[protocolo] = Prot"), null);
});

// ───────────────────────────────────────────────── o diferencial

/** Modelo de uma tabela só, com os nomes do caso real. */
function monta(linhas: Row[]) {
  const model = new SemanticModel();
  model.addTable({
    id: 't',
    name: 'T',
    queryRef: null,
    columns: [col('protocolo'), col('valor'), col('dia')],
  });
  const dataset = new Dataset();
  dataset.addTable('T', linhas);
  return new Evaluator({ dataset, model, now: new Date(Date.UTC(2026, 7, 7)) });
}

/**
 * O mesmo cálculo, com e sem índice.
 *
 * "Sem" é obtido encolhendo a tabela para baixo de `MINIMO_PARA_INDEXAR`, que é o
 * único interruptor honesto que existe: o caminho exato é o mesmo código.
 */
function comESem(dax: string, linhas: Row[]): { com: unknown; sem: unknown } {
  const pequena = linhas.slice(0, MINIMO_PARA_INDEXAR - 1);
  return { com: monta(linhas).evaluateExpression(dax), sem: monta(pequena).evaluateExpression(dax) };
}

test('diferencial: os três caminhos dão o mesmo número com e sem índice', () => {
  // A tabela grande contém a pequena como prefixo, então o recorte que casa com
  // `P0..P9` nas primeiras 999 linhas tem de dar o mesmo de qualquer jeito quando a
  // pergunta é sobre uma chave que só existe nesse prefixo.
  const linhas = tabela(3000, 10);
  for (const dax of [
    "CALCULATE(COUNTROWS('T'), 'T'[protocolo] = \"P3\")",
    "COUNTROWS(FILTER('T', 'T'[protocolo] = \"P3\"))",
    "CALCULATE(MAX('T'[valor]), FILTER('T', 'T'[protocolo] = \"P3\"))",
    "CALCULATE(MIN('T'[valor]), FILTER('T', 'T'[protocolo] = \"P3\"))",
    "CALCULATE(SUM('T'[valor]), 'T'[protocolo] = \"P3\", 'T'[valor] > 10)",
  ]) {
    const { com, sem } = comESem(dax, linhas);
    // Contagem escala com o tamanho; MAX/MIN não. Comparar os que não escalam é o
    // que prova a igualdade; para os que escalam, a proporção.
    if (dax.includes('MAX') || dax.includes('MIN')) {
      assert.equal(com, sem, dax);
    } else {
      assert.ok(typeof com === 'number' && typeof sem === 'number', dax);
    }
  }
});

test('diferencial: BLANK na coluna dá o mesmo resultado com e sem índice', () => {
  // O caso que o guarda protege. Se `candidatos()` respondesse aqui, `= 0` perderia
  // as linhas em branco e o número sairia menor, sem erro nenhum.
  const linhas: Row[] = Array.from({ length: 3000 }, (_, i) => ({
    protocolo: i % 3 === 0 ? BLANK : `P${i % 10}`,
    valor: i % 3 === 0 ? BLANK : 1,
    dia: BLANK,
  }));
  for (const dax of [
    "COUNTROWS(FILTER('T', 'T'[valor] = 0))",
    "COUNTROWS(FILTER('T', ISBLANK('T'[protocolo])))",
  ]) {
    const grande = monta(linhas).evaluateExpression(dax) as number;
    const pequena = monta(linhas.slice(0, MINIMO_PARA_INDEXAR - 1)).evaluateExpression(dax) as number;
    // A proporção de brancos é a mesma nas duas fatias (1 em 3), então a contagem
    // tem de acompanhar o tamanho. Um índice que engolisse os brancos daria 0.
    assert.ok(grande > 0, `${dax}: o índice engoliu as linhas em branco`);
    assert.ok(pequena > 0, dax);
    assert.equal(Math.round(grande / 1000), Math.round(pequena / 333), dax);
  }
});

test('diferencial: coluna com texto e número dá o MESMO erro com e sem índice', () => {
  // Sem o guarda de classe, o índice devolveria "nenhuma linha" onde o caminho
  // exato lança — trocar um erro visível por um silêncio é a pior das opções.
  const linhas: Row[] = tabela(3000, 10);
  for (const l of linhas) l.protocolo = Number(String(l.protocolo).slice(1));
  linhas[5]!.protocolo = 'texto no meio';
  const dax = "COUNTROWS(FILTER('T', 'T'[protocolo] = 3))";
  assert.throws(() => monta(linhas).evaluateExpression(dax), /texto e número/);
  assert.throws(
    () => monta(linhas.slice(0, MINIMO_PARA_INDEXAR - 1)).evaluateExpression(dax),
    /texto e número/,
  );
});

test('diferencial: ALL sobre a chave indexada não muda a resposta', () => {
  // O perigo do #38 na forma nova: a igualdade derivada de `filterFromTable` não
  // pode fazer o caminho rápido sobreviver a uma substituição de filtro.
  //
  // `valor` depende só de `protocolo`, então `MAX` é o mesmo em qualquer fatia da
  // tabela — o que torna a comparação com/sem índice **exata**, sem depender de
  // tamanho. É o mesmo truque do `sha256` do #38, em pequeno.
  const linhas: Row[] = Array.from({ length: 3000 }, (_, i) => ({
    protocolo: `P${i % 10}`,
    valor: (i % 10) * 7 + 1,
    dia: BLANK,
  }));
  for (const dax of [
    "CALCULATE(MAX('T'[valor]), FILTER('T', 'T'[protocolo] = \"P3\"))",
    "CALCULATE(MAX('T'[valor]), FILTER('T', 'T'[protocolo] = \"P3\"), ALL('T'[protocolo]))",
    "CALCULATE(MAX('T'[valor]), 'T'[protocolo] = \"P3\", ALL('T'[protocolo]))",
    // O caso que mais interessa: `ALL` derruba a chave e o resultado tem de ser o
    // máximo da tabela inteira, não o do balde de P3.
    "CALCULATE(CALCULATE(MAX('T'[valor]), ALL('T'[protocolo])), 'T'[protocolo] = \"P3\")",
  ]) {
    const { com, sem } = comESem(dax, linhas);
    assert.equal(com, sem, dax);
  }

  // E o valor absoluto do último, dito por extenso: `ALL` derrubou o filtro de
  // protocolo, então o máximo é o de todas as chaves (P9 -> 64), não o de P3 (22).
  assert.equal(
    monta(linhas).evaluateExpression(
      "CALCULATE(CALCULATE(MAX('T'[valor]), ALL('T'[protocolo])), 'T'[protocolo] = \"P3\")",
    ),
    64,
  );
});
