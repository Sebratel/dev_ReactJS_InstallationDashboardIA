// As contas da tabela e da matriz que saíram dos componentes na fase 4: ordenação,
// escala da barra, selo de status, janela de colunas (normal e transposta) e o CSV.

import assert from 'node:assert/strict';
import test from 'node:test';
import type { DadosDeMatriz } from '../src/services/dashboardService.ts';
import { textoCsv } from '../src/utils/csv.ts';
import { escalasDaTabela, ordenaLinhas, seloDeStatus } from '../src/utils/tabelaDados.ts';
import {
  cabecalhosDaDireita,
  corpoDaMatriz,
  csvDaMatriz,
  escalasPorMedida,
} from '../src/utils/matrizDados.ts';

test('ordenar: vazio no fim nos dois sentidos, número como número, texto sem caixa', () => {
  const linhas = [
    ['b', 10],
    [null, 3],
    ['A', 2],
    ['c', null],
  ];
  assert.deepEqual(
    ordenaLinhas(linhas, 1, false).map((l) => l[1]),
    [2, 3, 10, null],
  );
  assert.deepEqual(
    ordenaLinhas(linhas, 1, true).map((l) => l[1]),
    [10, 3, 2, null],
  );
  assert.deepEqual(
    ordenaLinhas(linhas, 0, false).map((l) => l[0]),
    ['A', 'b', 'c', null],
  );
  // Sem coluna: a ordem do servidor, num array novo.
  const igual = ordenaLinhas(linhas, null, false);
  assert.deepEqual(igual, linhas);
  assert.notEqual(igual, linhas);
});

test('a barra de dados só existe em coluna de magnitude que VARIA', () => {
  const colunas = [
    { nome: 'PROTOCOLO', tipo: 'number' as const },
    { nome: 'QTD', tipo: 'number' as const },
    { nome: 'Total', tipo: 'number' as const },
  ];
  const linhas = [
    [1, 1, 5],
    [2, 1, -20],
  ];
  // PROTOCOLO não é nome de medida; QTD é 1 em toda linha (barra cheia = tinta).
  assert.deepEqual([...escalasDaTabela(colunas, linhas)], [[2, 20]]);
});

test('selo de status', () => {
  assert.equal(seloDeStatus('SIM'), 'badge-sim');
  assert.equal(seloDeStatus('Não'), 'badge-nao');
  assert.equal(seloDeStatus('3 dias Fora do SLA'), 'badge-alerta');
  assert.equal(seloDeStatus('Canoas'), null);
});

test('o CSV: BOM, ponto e vírgula, tudo entre aspas, aspas dobradas', () => {
  assert.equal(
    textoCsv(
      ['a', 'b"c'],
      [
        ['1', 'x;y'],
        ['2', ''],
      ],
    ),
    '﻿"a";"b""c"\n"1";"x;y"\n"2";""',
  );
});

/** 2 status × 3 dias, uma medida. */
function matriz(): DadosDeMatriz {
  return {
    chavesDeLinha: [{ nome: 'Status', coluna: 'status' }],
    chavesDeColuna: [{ nome: null, coluna: 'dia' }],
    medidas: ['Qtd'],
    linhas: [['ok'], ['falhou']],
    colunas: [['d1'], ['d2'], ['d3']],
    tiposDeLinha: ['string'],
    tiposDeColuna: ['string'],
    tiposDeMedida: ['number'],
    celulas: [
      [[1], [2], [3]],
      [[4], [null], [6]],
    ],
    linhasTotais: 2,
    de: 0,
    descartadas: { linhas: 0, colunas: 0 },
    filtros: [],
  };
}

test('a janela de colunas corta de verdade, nas duas orientações', () => {
  const d = matriz();
  const escalas = escalasPorMedida(d);
  assert.equal(escalas[0], 6);
  const normal = corpoDaMatriz(d, false, 1, 3, escalas);
  assert.deepEqual(
    normal.map((l) => l.rotulo),
    ['ok', 'falhou'],
  );
  assert.deepEqual(
    normal[1]!.celulas.map((c) => c.vazio),
    [true, false],
  );
  assert.deepEqual(cabecalhosDaDireita(d, false, 1, 3), ['d2', 'd3']);
  // Transposta: os dias viram linhas, e a janela anda sobre os status.
  const transposta = corpoDaMatriz(d, true, 0, 1, escalas);
  assert.deepEqual(
    transposta.map((l) => l.rotulo),
    ['d1', 'd2', 'd3'],
  );
  assert.deepEqual(
    transposta.map((l) => l.celulas.length),
    [1, 1, 1],
  );
  assert.deepEqual(cabecalhosDaDireita(d, true, 0, 1), ['ok']);
});

test('o CSV da matriz sai na orientação original, com todas as colunas', () => {
  const { cabecalho, linhas } = csvDaMatriz(matriz());
  assert.deepEqual(cabecalho, ['Status', 'd1', 'd2', 'd3']);
  assert.equal(linhas.length, 2);
  assert.equal(linhas[0]![0], 'ok');
  assert.equal(linhas[0]!.length, 4);
});
