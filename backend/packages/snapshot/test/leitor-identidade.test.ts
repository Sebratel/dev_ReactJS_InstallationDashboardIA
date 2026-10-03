// `leitorDeIdentidade` responde por ID de dicionário quando pode, e por valor
// quando não pode — e as duas respostas têm de ser a MESMA string.
//
// O risco aqui não é ficar lento: é o caminho rápido divergir do lento num ramo
// pouco visitado. Uma chave de agrupamento errada não erra alto — ela junta duas
// linhas que não deviam se juntar, ou separa duas que deviam, e o número sai
// plausível. Por isso todo teste abaixo compara os dois caminhos entre si em vez
// de fixar a chave esperada à mão.
//
// O teste mora em `snapshot/` e não em `measure-engine/` porque precisa da vista —
// e a dependência aponta de `snapshot` para `measure-engine`, nunca ao contrário.

import assert from 'node:assert/strict';
import test from 'node:test';

import { Dataset, dicionarioDaColuna, indiceDaLinha, type Row } from '../../measure-engine/src/dataset.ts';
import { Evaluator } from '../../measure-engine/src/evaluator.ts';
import { identityKey, type DaxValue } from '../../measure-engine/src/value.ts';
import { SemanticModel, type ModelColumn } from '../../semantic-model/src/model.ts';
import { VistaDeLinhas } from '../src/linha-vista.ts';
import { ConstrutorDeTabela, type TabelaColunar } from '../src/tabela-colunar.ts';

const QUANDO = new Date('2026-03-04T00:00:00.000Z');

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

/** Repetição de propósito: é ela que faz o dicionário valer alguma coisa. */
function tabela(): TabelaColunar {
  const c = new ConstrutorDeTabela('T', ['cidade', 'n', 'ok', 'quando', 'vazio'], 5);
  c.poeLinha(['Canoas', 1, true, QUANDO, null]);
  c.poeLinha(['CANOAS', 2, false, null, null]);
  c.poeLinha(['canoas', 1, true, QUANDO, null]);
  c.poeLinha(['Esteio', 3, false, null, null]);
  c.poeLinha([null, 1, true, QUANDO, null]);
  return c.fecha();
}

function monta(linhas: Row[]): Evaluator {
  const m = new SemanticModel();
  m.addTable({
    id: 't',
    name: 'T',
    queryRef: 'q-t',
    columns: [
      col('cidade'),
      col('n'),
      col('ok'),
      col('quando'),
      col('vazio'),
      col('DOBRO', { calculated: true, dax: "'T'[n] * 2" }),
    ],
  });
  const dataset = new Dataset();
  dataset.adotaTabela('T', linhas);
  return new Evaluator({ model: m, dataset, now: new Date(Date.UTC(2026, 8, 14)) });
}

function vistas(): Row[] {
  return new VistaDeLinhas(tabela()).todas() as unknown as Row[];
}

/** As mesmas linhas como objeto simples — o caminho sem dicionário nenhum. */
function objetos(): Row[] {
  const t = tabela();
  const out: Row[] = [];
  for (let i = 0; i < t.linhas; i++) {
    const r: Row = {};
    for (const c of t.nomes) r[c] = t.valor(c, i) as DaxValue;
    out.push(r);
  }
  return out;
}

for (const [rotulo, faz] of [['vista colunar', vistas], ['objeto por linha', objetos]] as const) {
  test(`leitorDeIdentidade: ${rotulo} — a chave é a de identityKey, coluna por coluna`, () => {
    const linhas = faz();
    const ev = monta(linhas);
    for (const c of ['cidade', 'n', 'ok', 'quando', 'vazio']) {
      const chaveDe = ev.leitorDeIdentidade('T', c.toUpperCase()); // nome CRU
      for (const l of linhas) {
        assert.equal(chaveDe(l), identityKey(ev.columnValue('T', c, l)), `${rotulo}/${c}`);
      }
    }
  });
}

test('leitorDeIdentidade: caixa diferente cai na MESMA chave, pelo dicionário', () => {
  // 'Canoas', 'CANOAS' e 'canoas' são TRÊS entradas no dicionário (ele é exato) e
  // UMA chave de identidade (ela é sem caixa). Se o caminho rápido devolvesse o id
  // em vez da chave, o agrupamento por cidade partiria em três — sem erro nenhum.
  const linhas = vistas();
  const chaveDe = monta(linhas).leitorDeIdentidade('T', 'cidade');
  assert.equal(chaveDe(linhas[0]!), chaveDe(linhas[1]!));
  assert.equal(chaveDe(linhas[0]!), chaveDe(linhas[2]!));
  assert.notEqual(chaveDe(linhas[0]!), chaveDe(linhas[3]!));
  assert.equal(chaveDe(linhas[4]!), 'b:', 'nulo é BLANK, e BLANK tem chave própria');
});

test('leitorDeIdentidade: coluna calculada usa o caminho lento e concorda', () => {
  // A calculada não está no armazenamento — `dicionarioDaColuna` devolve null e o
  // leitor tem de cair no valor, materializando a coluna como `columnValue` faria.
  const linhas = vistas();
  const ev = monta(linhas);
  const chaveDe = ev.leitorDeIdentidade('T', 'DOBRO');
  for (const l of linhas) assert.equal(chaveDe(l), identityKey(ev.columnValue('T', 'DOBRO', l)));
  assert.equal(chaveDe(linhas[1]!), identityKey(4));
});

test('leitorDeIdentidade: linha que não vem do armazenamento não recebe a chave da linha 0', () => {
  // O caminho rápido é decidido na PRIMEIRA linha. Se depois vier uma linha sem
  // índice (uma cópia de `ADDCOLUMNS`, por exemplo) e o leitor a indexasse mesmo
  // assim, ela receberia a chave de outra linha — agrupamento errado, calado.
  const linhas = vistas();
  const ev = monta(linhas);
  const chaveDe = ev.leitorDeIdentidade('T', 'cidade');
  assert.equal(chaveDe(linhas[3]!), identityKey('Esteio'), 'a vista responde pelo dicionário');

  const solta: Row = { cidade: 'Esteio' };
  assert.equal(indiceDaLinha(solta), -1, 'objeto simples não tem índice');
  assert.equal(chaveDe(solta), identityKey('Esteio'));
  assert.equal(chaveDe({ cidade: 'Canoas' } as Row), identityKey('Canoas'));
});

test('a vista entrega o dicionário da coluna física, e null para o resto', () => {
  const linhas = vistas();
  const d = dicionarioDaColuna(linhas[0]!, 'cidade');
  assert.ok(d, 'coluna física tem dicionário');
  assert.equal(d.ids.length, 5, 'um id por linha da tabela');
  assert.equal(d.valores[d.ids[3]!], 'Esteio');
  assert.equal(dicionarioDaColuna(linhas[0]!, 'dobro'), null, 'calculada não está no armazenamento');
  assert.equal(dicionarioDaColuna(linhas[0]!, 'inexistente'), null);
  assert.equal(dicionarioDaColuna({ cidade: 'x' } as Row, 'cidade'), null, 'objeto simples: null');
});

test('o array de valores distintos é O MESMO objeto a cada pedido', () => {
  // Não é detalhe: as chaves de identidade são cacheadas num `WeakMap` chaveado por
  // este array. Devolver uma cópia a cada chamada faria o cache nunca acertar — e
  // foi exatamente a falta desse cache que estourou 8 GB de heap em 14/09/2026,
  // com um array de chaves por LEITOR em vez de um por coluna.
  const linhas = vistas();
  const a = dicionarioDaColuna(linhas[0]!, 'cidade');
  const b = dicionarioDaColuna(linhas[4]!, 'cidade');
  assert.ok(a && b);
  assert.equal(a.valores, b.valores, 'mesma instância, de linhas diferentes');
  assert.equal(a.ids, b.ids);
});

test('indiceDaLinha dá a posição da vista e -1 para quem não é vista', () => {
  const linhas = vistas();
  for (let i = 0; i < linhas.length; i++) assert.equal(indiceDaLinha(linhas[i]!), i);
  assert.equal(indiceDaLinha({} as Row), -1);
});

test('leitorDeIdentidade: linha de OUTRA vista não indexa este dicionário', () => {
  // O caso que o guarda de protótipo existe para impedir, e o mais perigoso de
  // todos: a outra linha TEM índice, então conferir só "tem índice" a deixaria
  // passar — ela leria a posição dela no dicionário DESTA coluna e receberia a
  // chave de uma linha que não é a dela. Agrupamento errado, sem erro nenhum.
  const linhas = vistas();
  const ev = monta(linhas);
  const chaveDe = ev.leitorDeIdentidade('T', 'cidade');
  assert.equal(chaveDe(linhas[0]!), identityKey('Canoas'), 'primeiro a vista, para fixar o molde');

  const outraTabela = new ConstrutorDeTabela('U', ['cidade'], 2);
  outraTabela.poeLinha(['Gravataí']);
  outraTabela.poeLinha(['Sapucaia']);
  const outras = new VistaDeLinhas(outraTabela.fecha()).todas() as unknown as Row[];
  assert.equal(indiceDaLinha(outras[1]!), 1, 'ela tem índice — é isso que a torna perigosa');

  // Cai no caminho lento, que lê o valor da linha certa.
  assert.equal(chaveDe(outras[1]!), identityKey('Sapucaia'));
  assert.equal(chaveDe(outras[0]!), identityKey('Gravataí'));
});
