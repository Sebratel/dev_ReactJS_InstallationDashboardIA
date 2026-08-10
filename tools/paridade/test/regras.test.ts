// As regras de veredito da paridade.
//
// **O teste que este arquivo existe para ter é o da divergência invertida.** Uma
// divergência declarada em `specs/_catalog/divergencias.yaml` que **não** muda o
// número é uma decisão que ficou no papel — e é o tipo de coisa que passa
// despercebida para sempre, porque "o número bateu com o Power BI" parece uma boa
// notícia. Aqui, bater onde se decidiu divergir é **falha**.

import assert from 'node:assert/strict';
import test from 'node:test';
import { confere, type CardEsperado } from '../src/regras.ts';

const TOL = 0.005;

function card(extra: Partial<CardEsperado> = {}): CardEsperado {
  return { visual: 'v1', powerbi: 100, ...extra };
}

test('igual dentro da tolerância bate', () => {
  assert.equal(confere(card(), 100, undefined, TOL).veredito, 'bate');
  assert.equal(confere(card(), 100.4, undefined, TOL).veredito, 'bate');
});

test('fora da tolerância difere, e diz de quanto', () => {
  const r = confere(card(), 110, undefined, TOL);
  assert.equal(r.veredito, 'difere');
  assert.equal(r.delta, 0.1);
});

/**
 * Zero não tem "diferença relativa". Tratá-lo por regra de três daria divisão por
 * zero; tratá-lo com tolerância absoluta esconderia um 0 que virou 0,3 — que não é
 * arredondamento de tela, é conta diferente.
 */
test('esperado zero compara exato, sem tolerância relativa', () => {
  assert.equal(confere(card({ powerbi: 0 }), 0, undefined, TOL).veredito, 'bate');
  assert.equal(confere(card({ powerbi: 0 }), 0.3, undefined, TOL).veredito, 'difere');
});

test('sem número ditado não é aprovação — é "sem gabarito"', () => {
  assert.equal(confere(card({ powerbi: null }), 100, undefined, TOL).veredito, 'sem-gabarito');
});

test('visual que não calculou não vira "difere", vira erro', () => {
  assert.equal(confere(card(), null, 'estourou o heap', TOL).veredito, 'nao-calculou');
  assert.equal(confere(card(), null, undefined, TOL).veredito, 'nao-calculou');
});

/**
 * Nem todo card é número: `visao-geral` tem "Hora mais recente" e
 * `diario-instalacao` tem "Data mais recente". Exigir número deles daria dois falsos
 * "não calculou" — e um harness que grita errado ensina a ignorá-lo.
 */
test('card de texto compara exato, ignorando espaço nas pontas', () => {
  assert.equal(confere(card({ powerbi: '14:32' }), '14:32', undefined, TOL).veredito, 'bate');
  assert.equal(confere(card({ powerbi: '14:32' }), ' 14:32 ', undefined, TOL).veredito, 'bate');
  assert.equal(confere(card({ powerbi: '14:32' }), '14:33', undefined, TOL).veredito, 'difere');
});

test('tipo trocado difere, não explode', () => {
  assert.equal(confere(card({ powerbi: 100 }), 'cem', undefined, TOL).veredito, 'difere');
});

// ---------------------------------------------------------------------------
// A expectativa invertida
// ---------------------------------------------------------------------------

test('onde se decidiu divergir, DIFERIR é o resultado bom', () => {
  const r = confere(card({ divergente: 'peso-instalado-fim-de-semana' }), 110, undefined, TOL);
  assert.equal(r.veredito, 'divergencia-confirmada');
});

test('onde se decidiu divergir, BATER é falha — a decisão não chegou ao número', () => {
  const r = confere(card({ divergente: 'peso-instalado-fim-de-semana' }), 100, undefined, TOL);
  assert.equal(r.veredito, 'divergencia-nao-aplicada');
});

test('divergência declarada não dispensa o número ditado', () => {
  const r = confere(card({ powerbi: null, divergente: 'peso-instalado-fim-de-semana' }), 100, undefined, TOL);
  assert.equal(r.veredito, 'sem-gabarito', 'sem o valor do Power BI não há o que confirmar');
});
