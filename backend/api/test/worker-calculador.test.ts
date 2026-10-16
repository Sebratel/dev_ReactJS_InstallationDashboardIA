// `chaveDeCarga` — a identidade de `cacheDeCarga` (worker-calculador.ts).
//
// Testado isolado, sem worker thread nenhuma: é função pura, e o que ela tem
// de acertar é justamente o que não dá para ver numa integração — duas chaves
// que deveriam ser iguais e não são (cache que nunca acerta) são invisíveis
// num teste de ponta a ponta, porque o pedido ainda funciona, só mais devagar.

import assert from 'node:assert/strict';
import test from 'node:test';
import { chaveDeCarga, linhaDeRecusaPorRecongelamento } from '../src/worker-calculador.ts';

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

// ---------------------------------------------------------------------------
// A carga recusada por recongelamento vira uma linha de log na worker
// ---------------------------------------------------------------------------

test('linhaDeRecusaPorRecongelamento: a recusa passageira vira UMA linha, com página, calculada e tempo', () => {
  const motivo =
    "Snapshot desatualizado: 'CALENDARIO CRIADO' foi congelada em 2026-10-16T16:52:26.799Z, antes da " +
    "materialização mais recente de 'PROTOCOLOS GERAL', de que ela nasce (2026-10-16T17:09:36.670Z).";
  const linha = linhaDeRecusaPorRecongelamento(motivo, 'visao-geral', 12, 3);
  assert.equal(
    linha,
    "[worker 3] carga de 'visao-geral' recusada em 12 ms: 'CALENDARIO CRIADO' está sendo " +
      'recongelada pelo refresh (a thread principal espera e repete)',
  );
  assert.equal(linha!.includes('\n'), false, 'uma linha só');
});

test('linhaDeRecusaPorRecongelamento: recusa permanente e erro qualquer não logam aqui', () => {
  // Esses já viram resposta de erro e log na thread principal (uma linha por motivo);
  // repetir aqui duplicaria o log sem dizer nada novo.
  const permanente =
    "Snapshot desatualizado: o DAX de 'CALENDARIO CRIADO'[PESO] mudou desde a materialização (a -> b).";
  assert.equal(linhaDeRecusaPorRecongelamento(permanente, 'visao-geral', 5, 1), null);
  assert.equal(linhaDeRecusaPorRecongelamento('ENOENT: arquivo sumiu', 'visao-geral', 5, 1), null);
});
