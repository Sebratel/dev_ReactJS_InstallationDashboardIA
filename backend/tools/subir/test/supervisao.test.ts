// A supervisão do daemon de refresh: quando ressuscitar, e quando parar de tentar.
//
// O caso real que a motivou está no docstring de `../src/supervisao.ts` — a stack fora
// do ar por 3h43 sem que nada avisasse. Estes testes cobrem a decisão, que é pura; o
// respawn em si (`spawn` + `setTimeout`) vive em `index.ts` e não é testável sem subir
// a API inteira.
//
// As esperas são injetadas para que o teste não dependa de relógio real.

import assert from 'node:assert/strict';
import test from 'node:test';
import { decideRessurreicao, ESPERAS_MS, VIDA_MINIMA_MS } from '../src/supervisao.ts';

const ESPERAS_DE_TESTE = [10, 20, 30] as const;
const VIDA_DE_TESTE = 1_000;

test('supervisao: primeira morte rápida ressuscita com a primeira espera', () => {
  const d = decideRessurreicao(50, 0, ESPERAS_DE_TESTE, VIDA_DE_TESTE);
  assert.equal(d.ressuscita, true);
  assert.equal(d.esperaMs, 10);
  assert.equal(d.mortesSeguidas, 1);
});

test('supervisao: mortes rápidas seguidas escalam a espera', () => {
  const esperas: number[] = [];
  let contador = 0;
  for (let i = 0; i < 3; i += 1) {
    const d = decideRessurreicao(50, contador, ESPERAS_DE_TESTE, VIDA_DE_TESTE);
    assert.equal(d.ressuscita, true);
    contador = d.mortesSeguidas;
    esperas.push(d.esperaMs);
  }
  assert.deepEqual(esperas, [10, 20, 30]);
  assert.equal(contador, 3);
});

// O teto é o que separa "queda transitória" de "defeito determinístico". Sem ele, um
// `.env` quebrado viraria um terminal rolando para sempre, e a mensagem que diz o que
// consertar sumiria de vista.
test('supervisao: passado o teto, desiste — e não sugere espera nenhuma', () => {
  const d = decideRessurreicao(50, ESPERAS_DE_TESTE.length, ESPERAS_DE_TESTE, VIDA_DE_TESTE);
  assert.equal(d.ressuscita, false);
  assert.equal(d.esperaMs, 0);
  assert.equal(d.mortesSeguidas, ESPERAS_DE_TESTE.length + 1);
});

// A conta mede falha em SE SUSTENTAR, não falha alguma vez. Sem isto, cinco quedas
// isoladas em semanas diferentes esgotariam o orçamento de um daemon que nunca deu
// problema.
test('supervisao: morte depois de vida longa zera a conta e volta à primeira espera', () => {
  const d = decideRessurreicao(VIDA_DE_TESTE, 2, ESPERAS_DE_TESTE, VIDA_DE_TESTE);
  assert.equal(d.ressuscita, true);
  assert.equal(d.esperaMs, 10);
  assert.equal(d.mortesSeguidas, 1);
});

test('supervisao: a vida mínima é inclusiva — exatamente no limite já conta como sustentado', () => {
  assert.equal(decideRessurreicao(VIDA_DE_TESTE, 2, ESPERAS_DE_TESTE, VIDA_DE_TESTE).mortesSeguidas, 1);
  assert.equal(decideRessurreicao(VIDA_DE_TESTE - 1, 2, ESPERAS_DE_TESTE, VIDA_DE_TESTE).mortesSeguidas, 3);
});

// Um daemon que já tinha estourado o teto e é ressuscitado à mão não pode ficar preso
// na recusa: se ele se sustentar, a conta zera como a de qualquer outro.
test('supervisao: depois de desistir, uma vida longa devolve o orçamento inteiro', () => {
  const desistiu = decideRessurreicao(50, ESPERAS_DE_TESTE.length, ESPERAS_DE_TESTE, VIDA_DE_TESTE);
  assert.equal(desistiu.ressuscita, false);
  const voltou = decideRessurreicao(VIDA_DE_TESTE * 10, desistiu.mortesSeguidas, ESPERAS_DE_TESTE, VIDA_DE_TESTE);
  assert.equal(voltou.ressuscita, true);
  assert.equal(voltou.mortesSeguidas, 1);
});

test('supervisao: os padrões de produção são crescentes e terminam em minutos, não segundos', () => {
  assert.ok(ESPERAS_MS.length >= 3, 'menos de três tentativas é pouco para queda transitória');
  for (let i = 1; i < ESPERAS_MS.length; i += 1) {
    assert.ok(ESPERAS_MS[i]! > ESPERAS_MS[i - 1]!, `espera ${i} devia ser maior que a anterior`);
  }
  assert.ok(ESPERAS_MS[0]! <= 10_000, 'a primeira tentativa tem de ser rápida');
  assert.ok(ESPERAS_MS[ESPERAS_MS.length - 1]! >= 60_000, 'a última tem de dar folga de verdade');
  assert.ok(VIDA_MINIMA_MS >= 30_000, 'vida mínima curta demais zeraria a conta em qualquer crash-loop');
});

test('supervisao: com os padrões de produção, a sequência é 5s, 15s, 45s, 2min, 5min e então desiste', () => {
  const esperas: number[] = [];
  let contador = 0;
  for (let i = 0; i < ESPERAS_MS.length; i += 1) {
    const d = decideRessurreicao(0, contador);
    contador = d.mortesSeguidas;
    esperas.push(d.esperaMs);
  }
  assert.deepEqual(esperas, [5_000, 15_000, 45_000, 120_000, 300_000]);
  assert.equal(decideRessurreicao(0, contador).ressuscita, false);
});
