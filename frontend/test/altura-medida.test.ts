import assert from 'node:assert/strict';
import { test } from 'vitest';
import { calculaAlturasDeFaixa, contaFaixasLargasPorAltura } from '../src/hooks/useAlturaMedida.ts';

test('sem faixa de largura cheia, não publica nada (null)', () => {
  assert.equal(calculaAlturasDeFaixa(0, 0, 0, 585), null);
});

test('utilPx não finito não publica nada — nunca "NaNpx" numa altura', () => {
  // Este é o defeito medido em 28/08/2026: `getPropertyValue('--util')` cru devolvia a
  // string do calc() sem resolver, `parseFloat` dava NaN, e "NaNpx" invalidava
  // `height`, caindo pra `auto` — cartão do tamanho do conteúdo cru (2.312px, 4.024px).
  assert.equal(calculaAlturasDeFaixa(1, 0, 0, NaN), null);
  assert.equal(calculaAlturasDeFaixa(1, 0, 0, Infinity), null);
});

test('uma faixa sozinha de cada tipo reproduz EXATAMENTE a fração fixa de hoje', () => {
  // É o caso que existia antes desta fase inteira, e não pode regredir: a primeira
  // versão desta conta (peso relativo entre tipos, dividindo --util inteiro) inflava
  // exatamente este caso — uma tabela larga sozinha passava de 54,5% para 100% de
  // --util. Ver o comentário de `FRACAO_POOL` em useAlturaMedida.ts.
  const util = 600;
  assert.equal(calculaAlturasDeFaixa(1, 0, 0, util)!.grafico, Math.round(util * 0.455));
  assert.equal(calculaAlturasDeFaixa(0, 1, 0, util)!.tabela, Math.round(util * 0.545));
  assert.equal(calculaAlturasDeFaixa(0, 0, 1, util)!.matriz, util); // matriz sempre pegou 100% sozinha
});

test('duas matrizes dividem o --util inteiro entre si, não pedem 100% cada uma', () => {
  const r = calculaAlturasDeFaixa(0, 0, 2, 1200);
  assert.equal(r!.matriz, 600); // 1200/2 — diario-instalacao, medido: 4.6 -> 1.0 tela
});

test('três matrizes + duas tabelas largas + um gráfico largo: cada tipo no seu próprio pool', () => {
  const util = 1200;
  const r = calculaAlturasDeFaixa(1, 2, 3, util)!;
  assert.equal(r.grafico, 430); // 0,455*1200=546, mas o teto do tipo (430) vence — sozinho, mas grande
  assert.equal(r.tabela, 327); // (0,545*1200)/2=327, dentro de [280,500]
  assert.equal(r.matriz, 400); // 1200/3=400, dentro de [360,900]
});

test('nunca passa do teto, não importa quão grande --util seja', () => {
  const r = calculaAlturasDeFaixa(0, 0, 1, 100_000);
  assert.equal(r!.matriz, 900);
});

test('nunca fica abaixo do piso, não importa quantas faixas do mesmo tipo existam', () => {
  // agendamento-field: 2 gráficos largos + 3 tabelas largas + 3 matrizes, --util pequeno
  const r = calculaAlturasDeFaixa(2, 3, 3, 100)!;
  assert.equal(r.grafico, 273);
  assert.equal(r.tabela, 280);
  assert.equal(r.matriz, 360);
});

test('contaFaixasLargasPorAltura: só conta faixa de 1 coluna (span 12)', () => {
  const faixas = [
    { altura: 'grafico', colunas: [1, 2, 3] }, // compacto — 3 colunas, não conta
    { altura: 'grafico', colunas: [1] }, // largo — conta
    { altura: 'tabela', colunas: [1] },
    { altura: 'tabela', colunas: [1] },
    { altura: 'matriz', colunas: [1, 2, 3, 4] }, // hipotético compacto de matriz — não conta
  ];
  assert.deepEqual(contaFaixasLargasPorAltura(faixas), { grafico: 1, tabela: 2, matriz: 0 });
});

test('contaFaixasLargasPorAltura: sem faixa nenhuma dá zero em tudo', () => {
  assert.deepEqual(contaFaixasLargasPorAltura([]), { grafico: 0, tabela: 0, matriz: 0 });
});

test('contaFaixasLargasPorAltura: visao-geral de hoje (1 faixa de 3 gráficos, 1 faixa de 1 tabela)', () => {
  // Reproduz backend/specs/layout/visao-geral.layout.yaml — prova que a Fase L4 não muda o
  // número de entrada de `useAlturaDasFaixasLargas` nesta página.
  const faixas = [
    { altura: 'grafico', colunas: [1, 2, 3] },
    { altura: 'tabela', colunas: [1] },
  ];
  assert.deepEqual(contaFaixasLargasPorAltura(faixas), { grafico: 0, tabela: 1, matriz: 0 });
});
