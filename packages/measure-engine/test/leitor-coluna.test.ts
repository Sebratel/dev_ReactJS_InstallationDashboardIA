// `leitorDeColuna` tem de ser `columnValue` com as normalizações içadas — e nada mais.
//
// O risco desta otimização não é ficar lenta: é os dois caminhos DIVERGIREM num
// ramo pouco visitado e o número sair errado sem erro nenhum. São quatro ramos, e
// o segundo é o que já mordeu antes (achado #48): a linha esparsa, que tem de dar
// BLANK e não cair no caminho de coluna calculada.
//
// Cada teste pergunta a mesma coisa das duas formas e exige a MESMA resposta,
// em vez de fixar o valor esperado à mão nos dois lugares. Fixar à mão deixaria
// passar o caso em que as duas mudam juntas para o lado errado.

import assert from 'node:assert/strict';
import test from 'node:test';
import { Dataset } from '../src/dataset.ts';
import { Evaluator } from '../src/evaluator.ts';
import { NO_PROPAGATION } from '../src/propagation.ts';
import { SemanticModel, type ModelColumn } from '../../semantic-model/src/model.ts';

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

function monta(linhas: Record<string, unknown>[]) {
  const m = new SemanticModel();
  m.addTable({
    id: 't',
    name: 'T',
    queryRef: 'q-t',
    columns: [col('valor'), col('DOBRO', { calculated: true, dax: "'T'[valor] * 2" })],
  });
  const dataset = new Dataset();
  dataset.adotaTabela('T', linhas as never);
  return new Evaluator({ model: m, dataset, now: new Date(Date.UTC(2026, 8, 14)) });
}

test('leitorDeColuna: coluna física dá o mesmo que columnValue', () => {
  const linhas = [{ valor: 3 }, { valor: 5 }];
  const ev = monta(linhas);
  const ler = ev.leitorDeColuna('T', 'VALOR'); // nome CRU, com caixa diferente
  for (const l of linhas) {
    assert.equal(ler(l as never), ev.columnValue('T', 'VALOR', l as never));
  }
  assert.equal(ler(linhas[0] as never), 3, 'e o valor é o da coluna, não BLANK');
});

test('leitorDeColuna: coluna calculada avalia E memoriza na linha, como columnValue', () => {
  // A memorização é o que impede a regra de dias úteis de rodar uma vez por linha
  // por medida. Um leitor que avaliasse sem gravar seria correto e lentíssimo —
  // e o teste de valor sozinho não pegaria isso.
  const linhas: Record<string, unknown>[] = [{ valor: 3 }];
  const ev = monta(linhas);
  assert.equal(ev.leitorDeColuna('T', 'DOBRO')(linhas[0] as never), 6);
  assert.equal(linhas[0]!.dobro, 6, 'tem de ter caído na linha, sob o nome normalizado');
});

test('leitorDeColuna: linha esparsa dá BLANK, não erro de coluna calculada', () => {
  // `adotaTabela` monta as colunas físicas como a UNIÃO das chaves de todas as
  // linhas, então 'extra' é física mesmo faltando na primeira linha. Sem o teste de
  // coluna física, esta leitura cairia no ramo de calculada e erraria alto.
  const linhas = [{ valor: 3 }, { valor: 5, extra: 9 }];
  const ev = monta(linhas);
  const ler = ev.leitorDeColuna('T', 'extra');
  assert.equal(ler(linhas[0] as never), ev.columnValue('T', 'extra', linhas[0] as never));
  assert.equal(ler(linhas[0] as never), null, 'BLANK');
  assert.equal(ler(linhas[1] as never), 9);
});

test('leitorDeColuna: coluna fora do modelo erra alto, com a mesma mensagem', () => {
  const linhas = [{ valor: 3 }];
  const ev = monta(linhas);
  const ler = ev.leitorDeColuna('T', 'NAO EXISTE');
  const pega = (f: () => unknown): string => {
    try {
      f();
    } catch (e) {
      return (e as Error).message;
    }
    return '(não errou)';
  };
  const doLeitor = pega(() => ler(linhas[0] as never));
  const doMetodo = pega(() => ev.columnValue('T', 'NAO EXISTE', linhas[0] as never));
  assert.equal(doLeitor, doMetodo);
  assert.match(doLeitor, /não existe no modelo/);
});

test('leitorDeColuna: pedir o leitor não lê nada — o erro sai na leitura', () => {
  // Importa para `NO_PROPAGATION` e para qualquer laço sobre coleção vazia: antes,
  // `joinValue` só errava quando havia linha. Se a fábrica errasse, uma varredura de
  // zero linhas passaria a falhar onde hoje não falha.
  const ev = monta([{ valor: 3 }]);
  assert.doesNotThrow(() => ev.leitorDeColuna('T', 'NAO EXISTE'));
  assert.doesNotThrow(() => NO_PROPAGATION.joinReader('T', 'valor'));
  assert.throws(() => NO_PROPAGATION.joinReader('T', 'valor')({} as never), /NO_PROPAGATION/);
});

test('leitorDeColuna: o mesmo leitor serve linhas diferentes, sem guardar estado', () => {
  // O fecho captura NOME normalizado, não linha nem valor. Se capturasse resultado,
  // a segunda linha receberia o valor da primeira — e num laço sobre 1,4 milhão de
  // linhas isso seria uma coluna inteira constante, sem erro nenhum.
  const linhas = Array.from({ length: 200 }, (_, i) => ({ valor: i }));
  const ev = monta(linhas);
  const ler = ev.leitorDeColuna('T', 'valor');
  assert.deepEqual(
    linhas.map((l) => ler(l as never)),
    linhas.map((l) => l.valor),
  );
});
