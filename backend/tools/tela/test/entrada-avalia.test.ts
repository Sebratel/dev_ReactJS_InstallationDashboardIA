import assert from 'node:assert/strict';
import test from 'node:test';
import { avalia, ordemDeMedida, resume, PAGINA_PRINCIPAL } from '../src/entrada-avalia.ts';

test('a agendamento-field é medida primeiro, venha onde vier na lista', () => {
  assert.deepEqual(ordemDeMedida(['capa', 'visao-geral', PAGINA_PRINCIPAL]), [PAGINA_PRINCIPAL, 'capa', 'visao-geral']);
  assert.deepEqual(ordemDeMedida(['capa']), ['capa']);
});

test('a meta da VISÃO PRODUTIVA é 1 s; a das análises detalhadas, 2 s', () => {
  assert.equal(avalia({ pagina: PAGINA_PRINCIPAL, htmlMs: 300, prontaMs: 1500, carregando: 0 }).passou, false);
  assert.equal(avalia({ pagina: 'capa', htmlMs: 300, prontaMs: 1500, carregando: 0 }).passou, true);
});

test('"carregando" visível reprova mesmo dentro do tempo', () => {
  const v = avalia({ pagina: 'capa', htmlMs: 300, prontaMs: 500, carregando: 1 });
  assert.equal(v.passou, false);
  assert.match(v.motivo ?? '', /carregando/);
});

test('HTML que não chega e página que não fica pronta são reprovações distintas', () => {
  assert.equal(avalia({ pagina: 'capa', htmlMs: null, prontaMs: null, carregando: 0 }).motivo, 'a tela nem chegou');
  assert.equal(avalia({ pagina: 'capa', htmlMs: 300, prontaMs: null, carregando: 0 }).motivo, 'não ficou pronta');
});

test('resume: o pior caso é o que conta, e rodada sem ficar pronta é pior que qualquer número', () => {
  const r = (prontaMs: number | null) => avalia({ pagina: 'capa', htmlMs: 300, prontaMs, carregando: 0 });
  assert.deepEqual(resume([r(500), r(900), r(700)]), { pagina: 'capa', rodadas: 3, reprovadas: 0, piorMs: 900, medianaMs: 700 });
  const comFalha = resume([r(500), r(null)]);
  assert.equal(comFalha.piorMs, null);
  assert.equal(comFalha.reprovadas, 1);
});
