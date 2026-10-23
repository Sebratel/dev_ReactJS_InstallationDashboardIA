// TODAY()/NOW() na hora de parede do RS, a mesma régua das datas do banco.
//
// O defeito (22/10/2026): o motor usava o instante real, e das 21:00 à meia-noite do RS o
// dia em UTC já é o seguinte — TODAY() devolvia amanhã. NOW() ficava 3 h à frente das
// datas do banco (que o motor guarda como "relógio de parede em UTC").

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import { Dataset } from '../src/dataset.ts';
import { Evaluator } from '../src/evaluator.ts';
import { relogioDeParede } from '../src/relogio.ts';

/** 22/10/2026 às 22:30 no RS = 23/10/2026 às 01:30 em UTC. */
const NOITE_NO_RS = new Date('2026-10-23T01:30:00.000Z');

function avaliador(agoraReal: Date): Evaluator {
  return new Evaluator({ model: new SemanticModel(), dataset: new Dataset(), now: relogioDeParede(agoraReal) });
}

test('relogioDeParede: os campos UTC passam a ser a hora do RS', () => {
  assert.equal(relogioDeParede(NOITE_NO_RS).toISOString(), '2026-10-22T22:30:00.000Z');
  assert.equal(relogioDeParede(new Date('2026-10-22T15:00:00.000Z')).toISOString(), '2026-10-22T12:00:00.000Z');
  // Meia-noite e um minuto no RS ainda é 03:01 em UTC: o dia novo começa aqui, não lá.
  assert.equal(relogioDeParede(new Date('2026-10-23T03:01:00.000Z')).toISOString(), '2026-10-23T00:01:00.000Z');
  // Os milissegundos não se perdem na conversão.
  assert.equal(relogioDeParede(new Date('2026-10-22T15:00:00.250Z')).getUTCMilliseconds(), 250);
});

test('TODAY() às 22:30 do RS é o dia de hoje, não o de amanhã', () => {
  const ev = avaliador(NOITE_NO_RS);
  assert.equal(ev.evaluateExpression('DAY(TODAY())'), 22);
  assert.equal(ev.evaluateExpression('MONTH(TODAY())'), 10);
});

test('NOW() às 22:30 do RS tem hora 22, a mesma régua das datas do banco', () => {
  const ev = avaliador(NOITE_NO_RS);
  assert.equal(ev.evaluateExpression('HOUR(NOW())'), 22);
  // Um prazo gravado no banco às 23:00 de hoje ainda não venceu às 22:30.
  assert.equal(ev.evaluateExpression('IF(DATE(2026, 10, 22) + TIME(23, 0, 0) > NOW(), 1, 0)'), 1);
});
