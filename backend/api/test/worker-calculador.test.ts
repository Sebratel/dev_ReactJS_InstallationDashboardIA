// `chaveDeCarga` — a identidade de `cacheDeCarga` (worker-calculador.ts).
//
// Testado isolado, sem worker thread nenhuma: é função pura, e o que ela tem
// de acertar é justamente o que não dá para ver numa integração — duas chaves
// que deveriam ser iguais e não são (cache que nunca acerta) são invisíveis
// num teste de ponta a ponta, porque o pedido ainda funciona, só mais devagar.

import assert from 'node:assert/strict';
import test from 'node:test';
import { chaveDeCarga } from '../src/worker-calculador.ts';

test('chaveDeCarga: mesmos conjuntos, ordem diferente, mesma chave', () => {
  const a = chaveDeCarga('visao-geral', ['v1', 'v2', 'v3'], ['ColA'], ['TabelaX', 'TabelaY']);
  const b = chaveDeCarga('visao-geral', ['v3', 'v1', 'v2'], ['ColA'], ['TabelaY', 'TabelaX']);
  assert.equal(a, b, 'a ordem de chegada dos ids não pode inventar duas chaves para o mesmo pedido');
});

test('chaveDeCarga: páginas diferentes nunca colidem', () => {
  const a = chaveDeCarga('visao-geral', ['v1'], [], []);
  const b = chaveDeCarga('relatorio-do-mes', ['v1'], [], []);
  assert.notEqual(a, b);
});

test('chaveDeCarga: conjuntos de visuais diferentes na MESMA página são chaves diferentes', () => {
  // A razão de existir: `dashboardSpec.visuals` chega recortado para os
  // `?visual=` do pedido (a abertura eager pede uns, a rolagem completa com
  // outros um de cada vez). `colunasUsadas()` (dentro de `carrega()`) decide o
  // que fica de fora olhando esse recorte — reaproveitar entre dois recortes
  // diferentes arriscaria servir um dataset que faltou omitir uma coluna que só
  // o segundo recorte usa. Ver o comentário de `cacheDeCarga`.
  const eager = chaveDeCarga('visao-geral', ['kpi1', 'kpi2', 'tabela', 'grafico1'], [], []);
  const rolagem = chaveDeCarga('visao-geral', ['grafico-fora-da-dobra'], [], []);
  assert.notEqual(eager, rolagem);
});

test('chaveDeCarga: liberação de sob-demanda diferente é chave diferente', () => {
  const semLiberar = chaveDeCarga('protocolos-detalhados', ['v1'], [], []);
  const comLiberar = chaveDeCarga('protocolos-detalhados', ['v1'], ['DESCRICAO LIVRE'], []);
  assert.notEqual(semLiberar, comLiberar);
});

test('chaveDeCarga: forma completa diferente é chave diferente', () => {
  const padrao = chaveDeCarga('visao-geral', ['v1'], [], []);
  const formaCompleta = chaveDeCarga('visao-geral', ['v1'], [], ['ALOCACAO PATRIMONIO']);
  assert.notEqual(padrao, formaCompleta);
});
