// A busca de tabela — `?busca=` recortando a consulta INTEIRA, no servidor.
//
// **O defeito que ela conserta.** O campo "Filtrar…" vivia inteiro em `Tabela.tsx` e
// peneirava `d.linhas`: as 200 linhas da janela já baixada. Em `PROTOCOLOS GERAL`,
// 95.157 linhas são 476 janelas — para o campo servir era preciso clicar até a janela
// onde o dado estava, o que não é buscar, é adivinhar a página. Medido em 16/09/2026,
// o protocolo que motivou isto (1784218) existe no snapshot em cinco tabelas, com
// 1.113 linhas em FIELD AGENDA: o dado nunca faltou, faltava como pedir por ele.
//
// O que estes testes guardam é a ORDEM — filtrar e depois cortar. Invertida, tudo
// continua "funcionando" e a busca passa a responder pela página em vez da tabela.

import assert from 'node:assert/strict';
import test from 'node:test';
import { casaComTermo, janelaDe, type Completo } from '../src/calcula.ts';

function tabela(linhas: unknown[][]): Completo {
  return {
    especie: 'tabela',
    colunas: [
      { nome: 'PROTOCOLO', tipo: 'string', chave: true, tabela: 'PROTOCOLOS GERAL', coluna: 'N°PROTOCOLO' },
      { nome: 'CIDADE', tipo: 'string', chave: false, tabela: 'PROTOCOLOS GERAL', coluna: 'CIDADE' },
    ],
    linhas,
    linhasTotais: linhas.length,
    filtros: [],
  };
}

/** 500 linhas com UMA que casa, e ela mora na linha 380 — fora da primeira janela. */
function quinhentasComOAlvoLonge(): Completo {
  const linhas: unknown[][] = [];
  for (let i = 0; i < 500; i++) {
    linhas.push([i === 380 ? '1784218' : `90${String(i).padStart(4, '0')}`, 'CASCAVEL']);
  }
  return tabela(linhas);
}

test('casaComTermo: qualquer célula da linha basta, e BLANK nunca casa', () => {
  assert.equal(casaComTermo(['1784218', 'CASCAVEL'], '1784218'), true);
  assert.equal(casaComTermo(['90001', 'CASCAVEL'], 'cascavel'), true, 'já vem em minúsculas de quem chama');
  assert.equal(casaComTermo(['90001', 'CASCAVEL'], '1784218'), false);
  // Casamento é por pedaço, não por igualdade: digitar o começo do número tem de
  // achar, senão a busca só serve para quem já sabe o valor inteiro.
  assert.equal(casaComTermo(['1784218', 'CASCAVEL'], '17842'), true);
  // Número não-texto também casa — a linha vem serializada, mas nem toda coluna é
  // string, e `String(4218)` contém `421`.
  assert.equal(casaComTermo([4218, null], '421'), true);
  // BLANK não é texto vazio que contém tudo. Se `null` casasse com qualquer termo,
  // toda linha com uma coluna vazia apareceria em toda busca.
  assert.equal(casaComTermo([null, undefined], 'x'), false);
  assert.equal(casaComTermo([null, undefined], ''), false);
});

test('janelaDe: sem termo, o comportamento é exatamente o de antes', () => {
  const c = quinhentasComOAlvoLonge();
  const r = janelaDe(c, { de: 0, linhas: 200 }) as { linhas: unknown[][]; linhasTotais: number; de: number };
  assert.equal(r.linhas.length, 200);
  assert.equal(r.linhasTotais, 500);
  assert.equal(r.de, 0);
  assert.equal((r as { totalSemBusca?: number }).totalSemBusca, undefined, 'sem busca, nada de campo novo');
});

test('janelaDe: FILTRA E DEPOIS CORTA — a linha 380 aparece na primeira janela', () => {
  // Este é o teste inteiro. Cortando primeiro, o alvo cairia fora das 200 e a busca
  // devolveria vazio para um termo que casa — e o sintoma pareceria da busca, não da
  // ordem das operações.
  const c = quinhentasComOAlvoLonge();
  const r = janelaDe(c, { de: 0, linhas: 200, termo: '1784218' }) as {
    linhas: unknown[][];
    linhasTotais: number;
    totalSemBusca: number;
  };
  assert.equal(r.linhas.length, 1, 'uma linha casa, e ela tem de estar aqui');
  assert.equal(r.linhas[0]![0], '1784218');
  assert.equal(r.linhasTotais, 1, 'o total é o do RESULTADO da busca — é dele que o paginador conta as janelas');
  assert.equal(r.totalSemBusca, 500, 'e o universo de origem sobrevive, para a tela dizer "1 de 500"');
});

test('janelaDe: a busca é paginada como qualquer outro resultado', () => {
  // 300 linhas casam. A busca não pode devolver as 300 de uma vez só porque são
  // "poucas" perto do total: o teto de janela existe para o navegador não engasgar.
  const linhas: unknown[][] = [];
  for (let i = 0; i < 400; i++) linhas.push([i < 300 ? `1784218-${i}` : `outro-${i}`, 'CASCAVEL']);
  const c = tabela(linhas);

  const p1 = janelaDe(c, { de: 0, linhas: 200, termo: '1784218' }) as { linhas: unknown[][]; linhasTotais: number };
  assert.equal(p1.linhas.length, 200);
  assert.equal(p1.linhasTotais, 300);

  const p2 = janelaDe(c, { de: 200, linhas: 200, termo: '1784218' }) as { linhas: unknown[][]; de: number };
  assert.equal(p2.linhas.length, 100, 'a última janela é curta');
  assert.equal(p2.de, 200);
  // E o `de` indexa o RESULTADO DA BUSCA, não a tabela: a linha 200 da busca é a
  // `1784218-200`, não a 200ª linha da tabela.
  assert.equal(p2.linhas[0]![0], '1784218-200');
});

test('janelaDe: termo que não casa com nada devolve zero linhas, não a tabela inteira', () => {
  // O modo de falha a evitar é o silencioso: um filtro que não filtra devolve as 200
  // primeiras linhas e parece ter funcionado.
  const c = quinhentasComOAlvoLonge();
  const r = janelaDe(c, { de: 0, linhas: 200, termo: 'nao-existe' }) as {
    linhas: unknown[][];
    linhasTotais: number;
    totalSemBusca: number;
  };
  assert.equal(r.linhas.length, 0);
  assert.equal(r.linhasTotais, 0);
  assert.equal(r.totalSemBusca, 500);
});

test('janelaDe: a MATRIZ ignora o termo — linhas e células têm de continuar alinhadas', () => {
  // `celulas` é indexada pela posição da linha. Filtrar `linhas` sem reindexar
  // `celulas` poria cada número na linha errada: certo na forma, errado no valor.
  // A matriz não tem campo de busca na tela; se um dia tiver, os dois arrays têm de
  // ser recortados pelos MESMOS índices.
  const m: Completo = {
    especie: 'matriz',
    chavesDeLinha: [], chavesDeColuna: [], medidas: [],
    linhas: [['CASCAVEL'], ['TOLEDO'], ['MARINGA']],
    colunas: [['jan']],
    tiposDeLinha: ['string'], tiposDeColuna: ['string'], tiposDeMedida: ['number'],
    celulas: [[[1]], [[2]], [[3]]],
    linhasTotais: 3,
    descartadas: 0,
    filtros: [],
  };
  const r = janelaDe(m, { de: 0, linhas: 200, termo: 'cascavel' }) as {
    linhas: unknown[][];
    celulas: unknown[][][];
    linhasTotais: number;
  };
  assert.equal(r.linhas.length, 3, 'as três linhas continuam');
  assert.equal(r.celulas.length, 3, 'e as três células com elas');
  assert.equal(r.linhasTotais, 3);
  assert.equal((r as { totalSemBusca?: number }).totalSemBusca, undefined);
});
