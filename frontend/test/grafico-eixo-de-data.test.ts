// O eixo de data do gráfico (ACHADOS #220): o motor entrega os dias na ordem de primeira
// aparição, e "AGENDA + CAPACIDADE POR TURNO" saía 17, 10, 14, 19, 9… — parecia número
// errado. A forma ordena por calendário e rotula o dia para ele se ler sozinho.

import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { DadosDeGrafico, Valor } from '../src/services/dashboardService.ts';
import { montaGrafico } from '../src/utils/graficoForma.ts';

const CHAVES_DE_DATA = [
  { tabela: 'calendar', coluna: 'Data', nivel: 'Ano', nome: 'Data Ano', papel: 'Category' },
  { tabela: 'calendar', coluna: 'Data', nivel: 'Mês', nome: 'Data Mês', papel: 'Category' },
  { tabela: 'calendar', coluna: 'Data', nivel: 'Dia', nome: 'Data Dia', papel: 'Category' },
];

function dados(
  pontos: [Valor, Valor, Valor, number][],
  chaves: unknown[] = CHAVES_DE_DATA,
): DadosDeGrafico {
  return {
    tipo: 'lineStackedColumnComboChart',
    chaves,
    series: [{ nome: 'CAPACIDADE MANHÃ', papel: 'Y' }],
    tiposDeSerie: ['number'],
    tiposDeChave: ['number', 'string', 'number'],
    pontos: pontos.map(([a, m, d, v]) => ({ categoria: [a, m, d], valores: [v] })),
    filtros: [],
  };
}

test('eixo de data sai em ordem de calendário, e o valor acompanha o dia', () => {
  const g = montaGrafico(
    dados([
      [2026, 'outubro', 17, 61],
      [2026, 'outubro', 10, 48],
      [2026, 'setembro', 30, 88],
      [2026, 'outubro', 2, 84],
      [2026, 'novembro', 5, 86],
    ]),
  );
  assert.deepEqual(
    g.categorias.map((c) => c.valores),
    [
      [2026, 'setembro', 30],
      [2026, 'outubro', 2],
      [2026, 'outubro', 10],
      [2026, 'outubro', 17],
      [2026, 'novembro', 5],
    ],
  );
  assert.deepEqual(g.series[0]!.valores, [88, 84, 48, 61, 86]);
});

test('dentro de um mês o eixo é só o dia; cruzando meses, dd/mm; cruzando anos, dd/mm/aa', () => {
  const umMes = montaGrafico(
    dados([
      [2026, 'outubro', 17, 1],
      [2026, 'outubro', 3, 1],
    ]),
  );
  assert.deepEqual(
    umMes.categorias.map((c) => c.eixo),
    ['3', '17'],
  );
  assert.equal(umMes.categorias[1]!.rotulo, 'sáb, 17/10/2026');

  const meses = montaGrafico(
    dados([
      [2026, 'outubro', 1, 1],
      [2026, 'setembro', 30, 1],
    ]),
  );
  assert.deepEqual(
    meses.categorias.map((c) => c.eixo),
    ['30/09', '01/10'],
  );

  const anos = montaGrafico(
    dados([
      [2026, 'janeiro', 2, 1],
      [2025, 'dezembro', 31, 1],
    ]),
  );
  assert.deepEqual(
    anos.categorias.map((c) => c.eixo),
    ['31/12/25', '02/01/26'],
  );
});

test('eixo que não é hierarquia de data fica na ordem do motor e sem rótulo próprio', () => {
  const chaves = [
    { tabela: 'T', coluna: 'CIDADE', nivel: null, nome: 'CIDADE', papel: 'Category' },
  ];
  const g = montaGrafico({
    ...dados([]),
    chaves,
    tiposDeChave: ['string'],
    pontos: [
      { categoria: ['Pelotas'], valores: [2] },
      { categoria: ['Bagé'], valores: [1] },
    ],
  });
  assert.deepEqual(
    g.categorias.map((c) => c.rotulo),
    ['Pelotas', 'Bagé'],
  );
  assert.equal(g.categorias[0]!.eixo, undefined);
});
