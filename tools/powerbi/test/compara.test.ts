// A comparação de um valor do Power BI com o nosso.
//
// **O teste que importa é o de data**, e ele existe porque o defeito passou meses
// sem ser visto: a comparação era `String(p) === String(nosso)`, o Power BI manda
// data como TEXTO ISO no JSON da API e nós mandamos `Date`. `String(new Date(...))`
// dá `"Thu Sep 18 2026 …"`, então nunca casava — e a tabela mostrava o MESMO valor
// formatado nas duas colunas, marcado DIFERE. Medido em 18/09/2026: dez das onze
// páginas acusavam `Data mais recente` como divergência.
//
// Falso positivo num relatório de divergência é pior que ruído: ele ensina quem lê
// a ignorar a lista inteira.

import assert from 'node:assert/strict';
import test from 'node:test';
import { compara, comoInstante } from '../src/compara.ts';

test('data: texto do Power BI contra Date nosso, mesmo instante, BATE', () => {
  assert.equal(compara('d', '2026-09-18T00:00:00', new Date('2026-09-18T00:00:00Z')).veredito, 'bate');
  assert.equal(compara('d', '2026-09-18', new Date('2026-09-18T00:00:00Z')).veredito, 'bate');
});

/**
 * O contrapeso: o carimbo de refresh diverge de verdade, e tem de continuar
 * divergindo. Se este teste virar 'bate', o conserto acima virou cegueira.
 */
test('hora: instantes diferentes continuam DIFERE, e o detalhe diz quanto', () => {
  const r = compara('h', '1899-12-30T18:09:30.107', new Date('1899-12-30T18:10:49Z'));
  assert.equal(r.veredito, 'difere');
  assert.match(r.detalhe ?? '', /distam 79s/);
});

/**
 * `.1` é um DÉCIMO de segundo, não 1 milissegundo. Sem o padding à direita,
 * 100 ms viram 1 ms e uma igualdade vira divergência de 99 ms.
 */
test('fração de segundo: .1 são 100 ms, não 1 ms', () => {
  assert.equal(comoInstante('2026-01-01T00:00:00.1')! - comoInstante('2026-01-01T00:00:00')!, 100);
  assert.equal(comoInstante('2026-01-01T00:00:00.01')! - comoInstante('2026-01-01T00:00:00')!, 10);
  assert.equal(comoInstante('2026-01-01T00:00:00.001')! - comoInstante('2026-01-01T00:00:00')!, 1);
});

/**
 * Sem fuso, de propósito: DAX não tem fuso. `new Date(texto)` aplicaria a regra do
 * runtime e faria a comparação depender de ONDE o processo roda — dois
 * desenvolvedores em fusos diferentes veriam paridades diferentes do mesmo dado.
 */
test('a leitura é por componente, não pelo fuso do runtime', () => {
  assert.equal(comoInstante('2026-09-18T00:00:00'), Date.UTC(2026, 8, 18));
  assert.equal(comoInstante('2026-09-18'), Date.UTC(2026, 8, 18));
});

test('o que não é data devolve null e cai na comparação de texto', () => {
  assert.equal(comoInstante('Bauru'), null);
  assert.equal(comoInstante('2026-13-45'), Date.UTC(2026, 12, 45), 'regex não valida calendário; só forma');
  assert.equal(comoInstante(42 as never), null);
  assert.equal(compara('t', 'Bauru', 'Bauru').veredito, 'bate');
  assert.equal(compara('t', 'Bauru', 'Jaú').veredito, 'difere');
});

test('número segue na tolerância relativa, sem virar data', () => {
  assert.equal(compara('n', 1000, 1004).veredito, 'bate');
  assert.equal(compara('n', 1000, 1100).veredito, 'difere');
});
