// A formatação da tela.
//
// Roda em `node --test` sem navegador porque `formato.ts` não tem JSX nem DOM — é a
// razão de ele ser um `.ts` separado dos componentes.

import assert from 'node:assert/strict';
import { test } from 'vitest';
import { dataHora, diasDesde, duracao, formata, haQuanto, inteiro } from '../src/utils/formato.ts';

test('BLANK vira travessão e é marcado como vazio, não como zero', () => {
  // Um BLANK desenhado como "0" seria um número inventado. A tela precisa saber que
  // é vazio para pintar em cinza de "sem dado" — nunca em vermelho de erro.
  assert.deepEqual(formata(null, 'number'), { texto: '—', numerico: false, vazio: true });
  assert.deepEqual(formata(undefined, 'string'), { texto: '—', numerico: false, vazio: true });
  assert.equal(formata(0, 'number').vazio, false);
});

/**
 * **O teste que guarda a regra central deste módulo.**
 *
 * O tipo vem do servidor. Se alguém trocar a decisão por "adivinha pelo formato do
 * texto", um protocolo que se pareça com uma data viraria data — número errado
 * plausível. Aqui o mesmo texto ISO é formatado das duas maneiras, e a única coisa
 * que muda é o tipo declarado.
 */
test('o tipo decide, não o formato do texto', () => {
  const iso = '2026-03-15T00:00:00.000Z';
  assert.equal(formata(iso, 'date').texto, '15/03/2026');
  assert.equal(formata(iso, 'string').texto, iso);
});

test('data com hora mostra a hora no fuso local; meia-noite exata mostra só a data', () => {
  assert.equal(formata('2026-08-10T00:00:00.000Z', 'date').texto, '10/08/2026');
  assert.match(formata('2026-08-10T09:08:59.000Z', 'date').texto, /10\/08\/2026.*06:08/);
});

test('campo só-de-hora (época 1899) mostra só a hora, não a data da época', () => {
  // `MIN de HORA ATUALIZADO[Hora]` é um `time` gravado sobre 1899-12-30. Antes disto a
  // tela mostrava "30/12/1899, 18:23"; o ano da época não é dado desta operação.
  const f = formata('1899-12-30T18:23:00.000Z', 'date');
  assert.equal(f.texto, '18:23');
  assert.equal(f.numerico, true);
  assert.equal(f.vazio, false);
});

test('data é formatada em UTC, não no fuso local', () => {
  // O snapshot grava instante. Formatar no fuso local faria a mesma data virar o dia
  // anterior para quem estivesse a oeste de Greenwich — e o Brasil está.
  assert.equal(formata('2026-01-01T00:00:00.000Z', 'date').texto, '01/01/2026');
});

test('data inválida diz o valor cru em vez de "Invalid Date"', () => {
  const f = formata('não é data', 'date');
  assert.match(f.texto, /data inválida: não é data/);
  assert.equal(f.vazio, false);
});

test('inteiro e decimal usam separador pt-BR', () => {
  assert.equal(formata(32744, 'number').texto, '32.744');
  assert.equal(formata(1.5, 'number').texto, '1,5');
});

test('booleano vira Sim/Não', () => {
  assert.equal(formata(true, 'boolean').texto, 'Sim');
  assert.equal(formata(false, 'boolean').texto, 'Não');
  // `false` não é vazio: existe e vale "Não".
  assert.equal(formata(false, 'boolean').vazio, false);
});

test('número e data são marcados como numéricos, para alinhar à direita', () => {
  assert.equal(formata(1, 'number').numerico, true);
  assert.equal(formata('2026-01-01T00:00:00.000Z', 'date').numerico, true);
  assert.equal(formata('texto', 'string').numerico, false);
});

test('inteiro() separa milhar', () => {
  assert.equal(inteiro(1466202), '1.466.202');
});

test('dataHora aceita nulo e ISO inválido sem quebrar', () => {
  assert.equal(dataHora(null), '—');
  assert.equal(dataHora('xx'), '—');
  assert.match(dataHora('2026-08-10T12:00:00.000Z'), /10\/08\/2026/);
});

test('diasDesde mede a idade do dado, e aceita nulo e ISO inválido', () => {
  assert.equal(diasDesde(null), null);
  assert.equal(diasDesde('xx'), null);
  const tresDiasAtras = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const idade = diasDesde(tresDiasAtras);
  assert.ok(idade !== null && idade > 2.9 && idade < 3.1, `esperava ~3 dias, veio ${idade}`);
});

/**
 * Uma página desta base leva de 40 ms a 104 minutos. "6240000 ms" é ilegível
 * exatamente no caso em que o número importa — o de `agendamento-field`.
 */
test('duração escolhe a unidade que cabe', () => {
  assert.equal(duracao(350), '350 ms');
  assert.equal(duracao(2358), '2.4 s');
  assert.equal(duracao(6_240_000), '104 min 00 s');
});

test('haQuanto dá a idade curta da capa, e travessão quando não há data', () => {
  const agora = Date.parse('2026-10-02T12:00:00Z');
  assert.equal(haQuanto(null, agora), '—');
  assert.equal(haQuanto('xx', agora), '—');
  assert.equal(haQuanto('2026-10-02T11:59:40Z', agora), 'agora');
  assert.equal(haQuanto('2026-10-02T11:57:00Z', agora), 'há 3min');
  assert.equal(haQuanto('2026-10-02T09:30:00Z', agora), 'há 2h');
  assert.equal(haQuanto('2026-09-28T12:00:00Z', agora), 'há 4d');
});

test('razão de coluna percentual: sempre ×100, sem palpite de escala', async () => {
  const { razaoComoPercentual } = await import('../src/utils/formato.ts');
  assert.equal(razaoComoPercentual(0.2929), '29,3%');
  assert.equal(razaoComoPercentual(-0.0168), '-1,7%');
  assert.equal(razaoComoPercentual(93.714), '9.371,4%', 'variação de +9.371% é real, não "93,71%"');
  assert.equal(razaoComoPercentual(null), '—');
});

test('as casas da porcentagem vêm do formato da medida (QA D-12)', async () => {
  const { razaoComoPercentual } = await import('../src/utils/formato.ts');
  // `MÉDIA GERAL` é `REINCIDÊNCIA[Porcentagem]`, formato `0.00%`: o QA viu "0,064".
  assert.equal(razaoComoPercentual(0.064, 2), '6,40%');
  // `% Diferença` da Premiação, mesmo formato: o QA viu "-0,23", que é a razão crua.
  assert.equal(razaoComoPercentual(-0.23, 2), '-23,00%');
  // Sem casas, o padrão de antes — é o que as medidas nativas (`0.0%`) pedem.
  assert.equal(razaoComoPercentual(0.064), '6,4%');
  assert.equal(razaoComoPercentual(0.064, 0), '6%');
});

test('as casas do número comum vêm do formato da medida (19/11/2026)', () => {
  // `PRAZO MÉDIO (DIAS)` é `format: "0.0"`. O genérico da tela escrevia `5,25` — e no
  // gráfico de coluna agrupada esse caractere a mais fazia o rótulo não caber na fatia,
  // deixando onze dos doze meses sem número nenhum.
  assert.equal(formata(5.254, 'number', { casas: 1 }).texto, '5,3');
  assert.equal(formata(2.8, 'number', { casas: 1 }).texto, '2,8');
  // Inteiro com uma casa declarada ganha a casa: é o que o Power BI mostra.
  assert.equal(formata(3, 'number', { casas: 1 }).texto, '3,0');
  // `format: "0"` arredonda, com o separador de milhar de sempre.
  assert.equal(formata(3612.7, 'number', { casas: 0 }).texto, '3.613');
  // Sem casas declaradas, nada muda: o genérico de até duas continua valendo.
  assert.equal(formata(5.254, 'number').texto, '5,25');
  assert.equal(formata(5.254, 'number', { casas: null }).texto, '5,25');
  // BLANK não vira "0,0".
  assert.equal(formata(null, 'number', { casas: 1 }).texto, '—');
});
