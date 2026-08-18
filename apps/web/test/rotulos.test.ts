import assert from 'node:assert/strict';
import test from 'node:test';
import { sigla } from '../src/rotulos.ts';

/**
 * **As três páginas `L.` são o caso que motivou a função.**
 *
 * Sem o ponto como separador, `L.INST`, `L.MAPA` e `L.TEC` viram três ícones "L."
 * idênticos — e a barra lateral em repouso (62px) mostra só o ícone. Se este teste
 * cair, três das catorze páginas voltaram a ser indistinguíveis no estado normal
 * da navegação.
 */
test('páginas L. ganham siglas distintas', () => {
  assert.equal(sigla('L.INST'), 'LI');
  assert.equal(sigla('L.MAPA'), 'LM');
  assert.equal(sigla('L.TEC'), 'LT');
});

test('nome de duas palavras usa a inicial de cada uma', () => {
  assert.equal(sigla('VISÃO GERAL'), 'VG');
  assert.equal(sigla('AGENDAMENTO FIELD'), 'AF');
  assert.equal(sigla('TELEFONIA & OUVIDORIA'), 'TO');
  assert.equal(sigla('INSTALAÇÃO/ REINCIDENTE'), 'IR');
});

test('nome de uma palavra usa as duas primeiras letras', () => {
  assert.equal(sigla('CAPA'), 'CA');
});

test('nome vazio não quebra', () => {
  assert.equal(sigla(''), '??');
  assert.equal(sigla('   '), '??');
});
