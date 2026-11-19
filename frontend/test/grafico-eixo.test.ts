// As contas do eixo do gráfico, que saíram de `Grafico.tsx` na fase 4. Um rótulo de
// eixo errado não quebra nada: só mostra vinte colunas com o mesmo texto.

import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  caminhoDaSerie,
  maiorIndice,
  bandaMinimaPara,
  orcamentoDoRotulo,
  orcamentoPorAltura,
  passoDoEixo,
  prefixoComum,
  rotuloDoEixo,
} from '../src/utils/graficoEixo.ts';

test('o prefixo comum é o que se repete em TODAS as categorias, e sempre sobra um nível', () => {
  const partes = [
    ['2026', 'julho', '1'],
    ['2026', 'julho', '2'],
    ['2026', 'agosto', '1'],
  ];
  assert.equal(prefixoComum(partes), 1);
  assert.equal(
    prefixoComum([
      ['2026', 'julho'],
      ['2026', 'julho'],
    ]),
    1,
  );
  assert.equal(prefixoComum([['Canoas']]), 0);
  assert.equal(prefixoComum([]), 0);
});

test('o rótulo vem do nível mais específico para trás, e nunca come o dia', () => {
  // O defeito antigo: cortar pelo começo devolvia "2026 / julho /…" em toda coluna.
  assert.equal(rotuloDoEixo(['2026', 'julho', '15'], '2026 / julho / 15', 10), 'julho/15');
  assert.equal(rotuloDoEixo(['2026', 'julho', '15'], '2026 / julho / 15', 20), '2026/julho/15');
  assert.equal(rotuloDoEixo(['julho', '15'], 'x', 4), '15');
  // Um nível longo sozinho corta no fim.
  assert.equal(rotuloDoEixo(['Equipe Field Service'], 'x', 8), 'Equipe …');
  // Sem partes, o rótulo inteiro.
  assert.equal(rotuloDoEixo([], 'Canoas', 10), 'Canoas');
});

test('o passo do eixo afina com a banda', () => {
  assert.equal(passoDoEixo(24), 3);
  assert.equal(passoDoEixo(40), 2);
  assert.equal(passoDoEixo(64), 1);
});

test('o passo pelo RÓTULO: a banda de 41px que pulava mês passa a escrever todos', () => {
  // MANUTENÇÃO INICIAL POR MÊS, 19/11/2026: dois gráficos em `span: 6`, plot de ~740px e
  // ~18 meses dão banda de ~41px. Pela régua antiga isso é passo 2 — um mês sim, um não —
  // e quem olha lê "outubro sumiu", porque a coluna continua lá e só o nome não é escrito.
  assert.equal(passoDoEixo(41), 2);
  assert.equal(passoDoEixo(41, 'outubro'.length), 1);
});

test('o passo ainda cresce quando o rótulo REALMENTE não cabe', () => {
  // 10px de banda não comportam nem 4 caracteres na diagonal: cai no teto de 3.
  assert.equal(passoDoEixo(10, 20), 3);
  // Rótulo médio numa banda estreita: 2 bandas resolvem.
  assert.equal(passoDoEixo(24, 8), 2);
  // Sem o argumento, a régua antiga continua valendo — nada que já chamava mudou.
  assert.equal(passoDoEixo(24), 3);
});

test('o orçamento por altura é a metade da conta que não depende do passo', () => {
  assert.equal(orcamentoPorAltura(64), Math.floor((64 - 22) / (5.6 * 0.71)));
  // É ele que `orcamentoDoRotulo` usa quando a altura é quem limita.
  assert.equal(orcamentoDoRotulo(330, 1, 64), orcamentoPorAltura(64));
});

test('o orçamento do rótulo respeita a largura E a altura', () => {
  // Poucas categorias: a banda larga liberaria o rótulo inteiro, e é a altura que limita.
  // Medido em 27/08/2026: sem a conta da altura, o rótulo descia 66px além da caixa.
  assert.equal(orcamentoDoRotulo(330, 1, 64), Math.floor((64 - 22) / (5.6 * 0.71)));
  // Muitas categorias: a largura limita.
  assert.equal(orcamentoDoRotulo(24, 3, 200), Math.floor((24 * 3) / 0.71 / 5.6));
  // Nunca abaixo de 4.
  assert.equal(orcamentoDoRotulo(5, 1, 20), 4);
});

test('o caminho da série é interrompido pelo nulo', () => {
  const x = (i: number) => i * 10;
  const y = (v: number) => 100 - v;
  assert.equal(caminhoDaSerie([1, 2, null, 4], x, y), 'M0.0 99.0 L10.0 98.0 M30.0 96.0');
  assert.equal(caminhoDaSerie([null, null], x, y), '');
});

test('o maior índice ignora nulo e fica com o primeiro no empate', () => {
  assert.equal(maiorIndice([3, null, 7, 7, 1]), 2);
  assert.equal(maiorIndice([null, null]), null);
  assert.equal(maiorIndice([]), null);
});

test('a banda minima sai do ROTULO: um mes de dias cabe onde uma data nao cabe', () => {
  // 19/11/2026: com o P/M/G fora, o 40px fixo virou lei e o PROTOCOLOS GERADOS passou a
  // mostrar "1-18 de 30" num cartao de meia largura (~740px de plot). Rotulo de dia tem
  // 1-2 caracteres e nao precisa de 40px.
  const plot = 740;
  assert.ok(Math.floor(plot / bandaMinimaPara(2)) >= 30, 'um mes inteiro tem de caber');
  // Piso: nem rotulo de 1 caractere espreme a coluna.
  assert.equal(bandaMinimaPara(1), 18);
  // Teto: 40, o MESMO valor fixo de antes. Rotulo longo (cidade, equipe) nao pode pedir
  // mais largura do que pedia, senao esta mudanca pioraria o caso que ela nao quer tocar.
  assert.equal(bandaMinimaPara(10), 40);
  assert.equal(bandaMinimaPara(40), 40);
  // E com rotulo longo cabe pelo menos o que cabia antes.
  assert.ok(Math.floor(plot / bandaMinimaPara(30)) >= Math.floor(plot / 40));
});
