// Os percentis — e por que a média não bastava.
//
// A F3 precisa responder "o clique está passando na frente?", e a média não
// responde. Duas filas com a mesma média de 8 s são coisas opostas: uma em que
// todo clique espera 8 s, e uma em que 95% dos cliques passam em 20 ms e um
// aquecimento espera 3 min. É a segunda que dá certo.
//
// O percentil daqui é o TETO DO BALDE, não a amostra. Ele erra para cima, nunca
// para baixo — e isso é uma propriedade, não uma concessão: uma métrica de
// latência que erra para baixo faz o sistema parecer melhor do que é justamente
// quando está pior.

import assert from 'node:assert/strict';
import test from 'node:test';
import { Metricas } from '../src/metricas.ts';

test('sem observação nenhuma, a duração simplesmente não existe', () => {
  const m = new Metricas();
  assert.deepEqual(m.instantaneo().duracoes, {});
});

test('o percentil é o teto do balde — 95 rápidas e 5 lentas não escondem as lentas', () => {
  const m = new Metricas();
  for (let i = 0; i < 95; i++) m.observa('fila_ms_interactive', 3);
  for (let i = 0; i < 5; i++) m.observa('fila_ms_interactive', 40_000);

  const d = m.instantaneo().duracoes.fila_ms_interactive!;
  assert.equal(d.n, 100);
  assert.equal(d.p50Ms, 5, '3 ms cai no balde de teto 5');
  assert.equal(d.p95Ms, 5, 'os 95% rápidos ainda estão no balde de 5 ms');
  assert.equal(d.p99Ms, 40_000, 'o percentil 99 já é das lentas — e aparece, limitado pelo máximo real');
  // A média sozinha diria 2 s, um número que não descreve ninguém: nem os 95
  // pedidos de 3 ms, nem os 5 de 40 s.
  assert.equal(d.mediaMs, 2002.9);
  assert.equal(d.maxMs, 40_000);
});

test('acima do maior balde, o percentil devolve o MÁXIMO real, não o teto da escala', () => {
  // Dizer 300.000 aqui seria mentir para baixo, que é o único erro que esta
  // escala não pode cometer.
  const m = new Metricas();
  m.observa('lento_ms', 900_000);
  const d = m.instantaneo().duracoes.lento_ms!;
  assert.equal(d.p50Ms, 900_000);
  assert.equal(d.p99Ms, 900_000);
});

test('uma observação só: os três percentis são ela — e não o teto do balde', () => {
  const m = new Metricas();
  m.observa('x_ms', 7);
  const d = m.instantaneo().duracoes.x_ms!;
  // O balde de 7 ms tem teto 10, mas nenhuma observação passou de 7: publicar 10
  // seria um percentil maior que o máximo, que lê como instrumento quebrado.
  assert.deepEqual([d.p50Ms, d.p95Ms, d.p99Ms], [7, 7, 7]);
});

test('o histograma não aloca por observação — o custo é fixo por métrica', () => {
  // O argumento que barrava percentil aqui era a memória: guardar a amostra num
  // processo que já mede a memória em GB é o instrumento virando o problema. Um
  // histograma de baldes fixos custa 18 inteiros, para sempre. Este teste é o
  // que impede alguém de "melhorar" o percentil guardando a amostra.
  const m = new Metricas();
  for (let i = 0; i < 200_000; i++) m.observa('muitas_ms', i % 5000);
  const antes = process.memoryUsage().heapUsed;
  for (let i = 0; i < 200_000; i++) m.observa('muitas_ms', i % 5000);
  const cresceuMB = (process.memoryUsage().heapUsed - antes) / 1048576;
  assert.ok(
    cresceuMB < 5,
    `200 mil observações cresceram ${cresceuMB.toFixed(1)} MB — o histograma virou amostra`,
  );
  assert.equal(m.instantaneo().duracoes.muitas_ms!.n, 400_000);
});

test('zera() apaga o histograma junto — senão o percentil descreveria a janela anterior', () => {
  const m = new Metricas();
  m.observa('x_ms', 50_000);
  m.zera();
  m.observa('x_ms', 1);
  assert.equal(m.instantaneo().duracoes.x_ms!.p99Ms, 1);
});
