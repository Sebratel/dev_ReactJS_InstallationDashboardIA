// O que dá para travar sem token: a fronteira de saída e a comparação.
//
// A parte que fala com a rede não é testada aqui de propósito — testar `fetch`
// contra um mock provaria que o mock funciona. O que **precisa** de teste é o que
// decide número: a tolerância, o BLANK, e a garantia de que só `EVALUATE` sai.

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSomenteEvaluate, daUrl } from '../src/api.ts';

test('assertSomenteEvaluate: EVALUATE e DEFINE+EVALUATE passam', () => {
  assertSomenteEvaluate('EVALUATE ROW("n", 1)');
  assertSomenteEvaluate('  evaluate VALUES(T[c])  ');
  assertSomenteEvaluate('DEFINE MEASURE T[x] = 1 EVALUATE ROW("n", [x])');
  assertSomenteEvaluate('-- comentario\nEVALUATE ROW("n", 1)');
  assertSomenteEvaluate('/* bloco */ EVALUATE ROW("n", 1)');
});

test('assertSomenteEvaluate: qualquer outra coisa é bloqueada', () => {
  for (const dax of [
    'ALTER TABLE x',
    'CREATE MEASURE T[y] = 1',
    'select 1',
    '',
    'ROW("n", 1)',
  ]) {
    assert.throws(() => assertSomenteEvaluate(dax), /DAX bloqueado/, `deveria bloquear: ${dax}`);
  }
});

test('assertSomenteEvaluate: comentário não disfarça comando', () => {
  // Sem remover o comentário, `/* EVALUATE */ ALTER ...` passaria pela regex.
  assert.throws(() => assertSomenteEvaluate('/* EVALUATE */ ALTER TABLE x'), /DAX bloqueado/);
});

test('daUrl: extrai reportId e ctid do link de embed', () => {
  const r = daUrl(
    'https://app.powerbi.com/reportEmbed?reportId=5576f259-5fe4-41ec-9b16-c1248191d46d' +
      '&autoAuth=true&ctid=022ee013-720c-4beb-a166-aaf0ae268166',
  );
  assert.equal(r.reportId, '5576f259-5fe4-41ec-9b16-c1248191d46d');
  assert.equal(r.tenant, '022ee013-720c-4beb-a166-aaf0ae268166');
});

test('daUrl: também lê o formato de caminho /groups/<g>/reports/<r>', () => {
  const r = daUrl(
    'https://app.powerbi.com/groups/11111111-2222-3333-4444-555555555555' +
      '/reports/5576f259-5fe4-41ec-9b16-c1248191d46d/ReportSection',
  );
  assert.equal(r.reportId, '5576f259-5fe4-41ec-9b16-c1248191d46d');
});

// Esta é a forma que o navegador realmente mostra, e era a única que falhava:
// achar o `ctid` fazia a função devolver cedo, sem nunca olhar o caminho.
test('daUrl: caminho com reportId E ctid na query — as duas coisas juntas', () => {
  const r = daUrl(
    'https://app.powerbi.com/groups/11111111-2222-3333-4444-555555555555' +
      '/reports/5576f259-5fe4-41ec-9b16-c1248191d46d/ReportSection' +
      '?ctid=022ee013-720c-4beb-a166-aaf0ae268166&experience=power-bi',
  );
  assert.equal(r.reportId, '5576f259-5fe4-41ec-9b16-c1248191d46d');
  assert.equal(r.tenant, '022ee013-720c-4beb-a166-aaf0ae268166');
});

test('daUrl: lixo não derruba, devolve vazio', () => {
  assert.deepEqual(daUrl('nao é url'), {});
  assert.deepEqual(daUrl('https://exemplo.com/'), {});
});
