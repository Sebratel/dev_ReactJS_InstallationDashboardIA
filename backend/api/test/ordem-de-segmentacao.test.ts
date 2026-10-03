// A ordem em que um seletor oferece seus valores — ver `comparaValorDeSegmentacao`.
//
// **O defeito que isto guarda, encontrado usando a aplicação em 08/09/2026.** A
// lista de valores é truncada em `teto` antes de chegar à tela. Ordenada de
// forma CRESCENTE, o corte jogava fora a metade mais recente:
// `CALENDARIO INSTALADO`[DATA INSTALADO] tem 713 datas distintas, a tela recebia
// 500, e a árvore de período terminava em JUNHO/2026 — enquanto a mesma página
// abre filtrada em AGOSTO. O mês que a tela pedia por padrão não estava na lista
// que ela oferecia.
//
// Por fora, isso se manifestava como «nenhum filtro funciona»: os únicos meses
// selecionáveis eram velhos, e escolher qualquer um deles trocava um recorte
// vazio por outro.
//
// E a suíte inteira passava verde com a ordem trocada — a decisão morava dentro
// de um `sort()` anônimo, onde nenhum teste a alcançava.
//
// REGRA DE SAÍDA: nada aqui imprime valor de linha.

import assert from 'node:assert/strict';
import test from 'node:test';
import { comparaValorDeSegmentacao as compara } from '../src/servidor.ts';

const ordena = <T>(vs: readonly T[]): T[] => [...vs].sort(compara as (a: T, b: T) => number);

test('data: a mais RECENTE primeiro — é o corte que essa ordem protege', () => {
  const d = (iso: string): Date => new Date(iso);
  const ordenadas = ordena([
    d('2025-01-18T00:00:00Z'),
    d('2026-08-31T00:00:00Z'),
    d('2026-06-01T00:00:00Z'),
    d('2025-12-25T00:00:00Z'),
  ]) as Date[];

  assert.equal(ordenadas[0]!.toISOString(), '2026-08-31T00:00:00.000Z');
  assert.equal(ordenadas.at(-1)!.toISOString(), '2025-01-18T00:00:00.000Z');

  // O TESTE QUE IMPORTA: com a lista cortada, o que sobra tem de ser o recente.
  const cortada = ordenadas.slice(0, 2);
  assert.ok(
    cortada.every((x) => x.getUTCFullYear() === 2026),
    'truncar tem de descartar o passado, nunca o presente',
  );
});

test('número: o maior primeiro', () => {
  assert.deepEqual(ordena([3, 10, 1, 7]), [10, 7, 3, 1]);
});

test('texto continua em A–Z, com acento no lugar certo', () => {
  // Em nome de pessoa ou de equipe é alfabético que se procura; não há «mais
  // recente» que privilegiar, e inverter só tornaria a busca visual mais difícil.
  assert.deepEqual(ordena(['Zeca', 'Ana', 'Ápia', 'Bruno']), ['Ana', 'Ápia', 'Bruno', 'Zeca']);
});

test('BLANK vai para o fim, seja qual for o tipo ao lado', () => {
  // No topo, um único vazio empurraria a lista inteira para baixo em toda coluna
  // que tenha um.
  const comVazio = ordena([null, 5, 1, null, 9]);
  assert.deepEqual(comVazio.slice(0, 3), [9, 5, 1]);
  assert.equal(comVazio[3], null);
  assert.equal(comVazio[4], null);
});

test('a comparação é estável para valores iguais', () => {
  assert.equal(compara(5, 5), 0);
  assert.equal(compara(new Date('2026-01-01'), new Date('2026-01-01')), 0);
  assert.equal(compara(null, null), 0);
});
