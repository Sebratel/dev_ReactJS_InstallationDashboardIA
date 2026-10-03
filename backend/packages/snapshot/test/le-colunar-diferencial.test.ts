// O diferencial: o MESMO arquivo, lido pelos dois caminhos, tem de dar as mesmas
// células.
//
// É o único teste que autoriza a troca de representação embaixo do avaliador.
// `le()` devolve um objeto por linha e é o que roda hoje; `leColunar()` devolve
// `TabelaColunar`. Enquanto as duas existirem, esta comparação é o que impede uma
// de derivar da outra em silêncio — que seria a falha cara: número plausível e
// diferente, sem erro nenhum.
//
// Os casos aqui são escolhidos pelo que QUEBRARIA: tipo misto, data, nulo, texto
// que parece número, coluna só de nulos, e a omissão de colunas.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { escreve, le, leColunar, type Escalar } from '../src/formato.ts';
import { normalizeName } from '../../semantic-model/src/model.ts';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'colunar-dif-'));
}

/** Grava um arquivo de snapshot e devolve o caminho que a leitura deve abrir. */
async function gravado(
  dir: string,
  nome: string,
  linhas: Record<string, Escalar>[],
): Promise<string> {
  const alvo = path.join(dir, `${nome}.jsonl`);
  // As colunas vêm da UNIÃO das linhas, não da primeira: coluna que só aparece
  // depois existe, e omiti-la aqui esconderia justamente o caso que interessa.
  const colunas = [...new Set(linhas.flatMap((l) => Object.keys(l)))];
  await escreve(alvo, { query: nome, tabelas: [nome] }, colunas, linhas);
  return fs.existsSync(alvo) ? alvo : `${alvo}.gz`;
}

/**
 * Compara célula a célula. Data compara por instante — o objeto é outro nos dois
 * caminhos, e `deepEqual` de `Date` compara valor, mas comparar explicitamente
 * deixa a falha legível quando acontecer.
 */
function mesmaCelula(a: Escalar, b: Escalar, onde: string): void {
  if (a instanceof Date || b instanceof Date) {
    assert.ok(a instanceof Date && b instanceof Date, `${onde}: um é Date e o outro não`);
    assert.equal(a.getTime(), b.getTime(), `${onde}: instantes diferentes`);
    return;
  }
  assert.equal(a, b, onde);
  assert.equal(typeof a, typeof b, `${onde}: tipos diferentes (${typeof a} vs ${typeof b})`);
}

async function conferePar(
  dir: string,
  nome: string,
  linhas: Record<string, Escalar>[],
  omitir?: ReadonlySet<string>,
): Promise<void> {
  const arquivo = await gravado(dir, nome, linhas);
  const porLinha = await le(arquivo, omitir);
  const porColuna = await leColunar(arquivo, omitir);

  assert.equal(porColuna.tabela.linhas, porLinha.linhas.length, `${nome}: contagem de linhas`);
  assert.equal(
    porColuna.cabecalho.linhas,
    porLinha.cabecalho.linhas,
    `${nome}: o cabeçalho tem de ser o mesmo`,
  );

  const colunas = porColuna.tabela.nomes;
  const doObjeto = porLinha.linhas[0] ? Object.keys(porLinha.linhas[0]) : colunas;
  assert.deepEqual([...colunas].sort(), [...doObjeto].sort(), `${nome}: mesmas colunas`);

  for (let i = 0; i < porLinha.linhas.length; i++) {
    for (const c of colunas) {
      mesmaCelula(porLinha.linhas[i]![c]!, porColuna.tabela.valor(c, i), `${nome}[${i}].${c}`);
    }
  }
}

test('diferencial: tipos simples, nulos e repetição', async () => {
  const dir = tmp();
  await conferePar(dir, 'simples', [
    { CIDADE: 'Canoas', N: 1, OK: true, QUANDO: new Date('2026-01-05T00:00:00.000Z'), VAZIO: null },
    { CIDADE: 'Canoas', N: 2, OK: false, QUANDO: new Date('2026-01-06T00:00:00.000Z'), VAZIO: null },
    { CIDADE: 'Esteio', N: 1, OK: true, QUANDO: null, VAZIO: null },
  ]);
});

test('diferencial: coluna de tipo MISTO, que é onde o formato etiqueta valor a valor', async () => {
  const dir = tmp();
  await conferePar(dir, 'misto', [
    { X: 1 },
    { X: 'um' },
    { X: true },
    { X: new Date('2026-02-01T00:00:00.000Z') },
    { X: null },
  ]);
});

test('diferencial: texto que PARECE número continua texto nos dois caminhos', async () => {
  // É a armadilha que o cabeçalho tipado existe para evitar: `"1.234"` em pt-BR.
  const dir = tmp();
  await conferePar(dir, 'quase-numero', [{ T: '1.234' }, { T: '0007' }, { T: '1e3' }, { T: '1' }]);
});

test('diferencial: coluna só de nulos', async () => {
  const dir = tmp();
  await conferePar(dir, 'so-nulo', [{ A: null, B: 'x' }, { A: null, B: 'y' }]);
});

test('diferencial: com colunas OMITIDAS, os dois caminhos omitem as mesmas', async () => {
  const dir = tmp();
  await conferePar(
    dir,
    'omitidas',
    [
      { MANTIDA: 'a', FORA: 'lixo', OUTRA: 1 },
      { MANTIDA: 'b', FORA: 'lixo', OUTRA: 2 },
    ],
    new Set([normalizeName('FORA')]),
  );
});

test('diferencial: tabela de uma linha e tabela de muitas linhas iguais', async () => {
  const dir = tmp();
  await conferePar(dir, 'uma', [{ A: 'x' }]);
  await conferePar(
    dir,
    'repetida',
    Array.from({ length: 500 }, () => ({ A: 'igual', B: 7 })),
  );
});

test('leColunar erra alto em arquivo truncado, com a mesma mensagem de le()', async () => {
  const dir = tmp();
  // DUAS colunas, e o corte tira a última linha: desde o formato 2 (15/09/2026) o
  // corpo é uma linha por COLUNA, então truncar por linha de tabela não trunca nada.
  // O que este teste fixa é que os dois leitores reclamam IGUAL, e isso não mudou.
  const arquivo = await gravado(dir, 'truncado', [
    { A: 1, B: 'x' },
    { A: 2, B: 'y' },
    { A: 3, B: 'z' },
  ]);
  const texto = fs.readFileSync(arquivo, 'utf8');
  const cortado = texto.split('\n').slice(0, 2).join('\n') + '\n';
  const outro = path.join(dir, 'cortado.jsonl');
  fs.writeFileSync(outro, cortado, 'utf8');

  await assert.rejects(() => leColunar(outro), /Arquivo truncado/);
  await assert.rejects(() => le(outro), /Arquivo truncado/);
});
