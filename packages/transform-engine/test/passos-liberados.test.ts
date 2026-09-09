// Soltar as tabelas intermediárias do `let` — ver `avaliaQuery` e `referenciasDoLet`.
//
// **O defeito que isto ataca, medido em 09/09/2026.** `avaliaQuery` terminava
// resolvendo TODOS os bindings de novo, para devolver `passos` — a facilidade que
// permite comparar passo a passo com o Power Query. O efeito colateral é que as 56
// tabelas intermediárias de `protocolos-geral` ficavam vivas ao mesmo tempo,
// 94.166 linhas × 63 colunas cada:
//
//   guardando os passos   pico 9.778 MB   56 passos vivos   215-295 s   estourava 8 GB
//   sem guardar           pico 2.920 MB    1 passo vivo      77,5 s     coube
//
// Isso custava a query inteira: acima do teto de 8 GB do daemon, ela ficava fora
// de `specs/_catalog/refresh.yaml` e congelava 12 das 14 páginas em dado de dias.
// Quem materializa nunca leu `passos` — só `mrun --passos` e os testes leem.
//
// A hipótese ANTERIOR era grão multiplicado pelos quatro `Table.NestedJoin`, o
// padrão que resolveu `field-agenda`. Foi medida e descartada: fan-out médio de
// 1,04x. O custo era retenção de passo, não número de linhas.
//
// REGRA DE SAÍDA: nada aqui imprime valor de linha.

import assert from 'node:assert/strict';
import test from 'node:test';
import { MEvaluator } from '../src/evaluator.ts';
import { standardConstants, standardFunctions } from '../src/functions.ts';
import { deLinhas } from '../src/runner.ts';
import { isTable, toDatasetRows, type MValue } from '../src/value.ts';

const LINHAS = Array.from({ length: 200 }, (_, i) => ({ A: i, B: `x${i}` }));

function ev(): MEvaluator {
  const funcoes = new Map(standardFunctions());
  funcoes.set('Fonte.Teste', {
    name: 'Fonte.Teste',
    minArgs: 0,
    maxArgs: 0,
    call: () => deLinhas(LINHAS),
  });
  return new MEvaluator({ functions: funcoes, constants: standardConstants() });
}

/** As linhas como objetos simples, para comparar dois resultados sem olhar tipos internos. */
function linhasDe(v: MValue): readonly Record<string, unknown>[] {
  assert.ok(isTable(v), 'esperava tabela');
  return toDatasetRows(v).rows;
}

const CADEIA = `let
    p1 = Fonte.Teste(),
    p2 = Table.AddColumn(p1, "C1", each [A] * 2),
    p3 = Table.AddColumn(p2, "C2", each [A] + 1),
    p4 = Table.SelectRows(p3, each [A] < 100),
    p5 = Table.AddColumn(p4, "C3", each [C1] + [C2])
in
    p5`;

test('soltar os passos NÃO muda o resultado — é a única garantia que importa', () => {
  // Se este teste cair, a economia de memória virou dado errado, e dado errado
  // silencioso é pior do que estourar o heap: o heap avisa.
  const comPassos = ev().avaliaQuery(CADEIA, { guardaPassos: true });
  const semPassos = ev().avaliaQuery(CADEIA, { guardaPassos: false });
  assert.deepEqual(linhasDe(semPassos.valor), linhasDe(comPassos.valor));
});

test('o padrão continua guardando os passos — nenhum chamador antigo muda de comportamento', () => {
  const { passos } = ev().avaliaQuery(CADEIA);
  assert.deepEqual([...passos.keys()], ['p1', 'p2', 'p3', 'p4', 'p5']);
});

test('com guardaPassos:false, `passos` vem vazio em vez de mentir', () => {
  // Devolver um mapa parcial (só o que sobreviveu) seria pior que devolver nada:
  // quem compara passo a passo leria ausência como divergência.
  const { passos } = ev().avaliaQuery(CADEIA, { guardaPassos: false });
  assert.equal(passos.size, 0);
});

test('passo citado dentro de `each` NUNCA é solto — ele reavalia uma vez por linha', () => {
  // A regra conservadora de `referenciasDoLet`. Contagem estática só vale em linha
  // reta: aqui `limite` é UMA citação no texto e 200 resoluções em tempo de
  // execução. Soltá-lo na primeira quebraria a query inteira.
  const m = `let
      t = Fonte.Teste(),
      limite = 10,
      f = Table.SelectRows(t, each [A] < limite)
  in
      f`;
  const r = ev().avaliaQuery(m, { guardaPassos: false });
  assert.equal(linhasDe(r.valor).length, 10);
});

test('passo citado duas vezes só é solto na segunda', () => {
  // Se a contagem soltasse na primeira, `v` não acharia mais `t` e a query
  // recalcularia a fonte — ou pior, morreria por nome não encontrado.
  const m = `let
      t = Fonte.Teste(),
      u = Table.RowCount(t),
      v = Table.RowCount(t),
      w = u + v
  in
      w`;
  assert.equal(ev().avaliaQuery(m, { guardaPassos: false }).valor, 400);
});

test('passo citado dentro de `each` E em linha reta continua inteiro', () => {
  // O caso misto: `presos` tem de vencer a contagem, não somar com ela.
  const m = `let
      t = Fonte.Teste(),
      corte = 5,
      a = Table.SelectRows(t, each [A] < corte),
      b = Table.RowCount(a) + corte
  in
      b`;
  assert.equal(ev().avaliaQuery(m, { guardaPassos: false }).valor, 10);
});

test('expressão sem `let` não quebra com a opção nova', () => {
  const r = ev().avaliaQuery('1 + 1', { guardaPassos: false });
  assert.equal(r.valor, 2);
  assert.equal(r.passos.size, 0);
});
