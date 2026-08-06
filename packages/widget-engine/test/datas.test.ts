// Resolução das datas relativas dos filtros.
//
// Tudo aqui é conferível à mão, e é de propósito: o resto do Widget Engine
// depende destas cinco funções, então um erro aqui aparece como número errado em
// qualquer card com filtro de data — que são 8 dos filtros do relatório.
//
// O "agora" é sempre injetado. Nenhum teste deste arquivo chama `new Date()`, e
// nenhum passaria em dia diferente se chamasse.

import assert from 'node:assert/strict';
import test from 'node:test';
import { DaxEvalError } from '../../measure-engine/src/value.ts';
import { ancora, deslocar, resolveBorda, resolveSpan, truncar } from '../src/datas.ts';
import type { BordaSpec, SpanSpec } from '../src/spec.ts';

/** 15/03/2026 às 14:37:52 — domingo. Hora quebrada para o truncamento ter o que cortar. */
const AGORA = new Date(Date.UTC(2026, 2, 15, 14, 37, 52, 123));

const iso = (d: Date): string => d.toISOString();

// ---------------------------------------------------------------------------
// truncar
// ---------------------------------------------------------------------------

test('truncar corta a data no início de cada unidade', () => {
  assert.equal(iso(truncar(AGORA, 'year', 'x')), '2026-01-01T00:00:00.000Z');
  assert.equal(iso(truncar(AGORA, 'month', 'x')), '2026-03-01T00:00:00.000Z');
  assert.equal(iso(truncar(AGORA, 'day', 'x')), '2026-03-15T00:00:00.000Z');
  assert.equal(iso(truncar(AGORA, 'hour', 'x')), '2026-03-15T14:00:00.000Z');
  assert.equal(iso(truncar(AGORA, 'minute', 'x')), '2026-03-15T14:37:00.000Z');
  assert.equal(iso(truncar(AGORA, 'second', 'x')), '2026-03-15T14:37:52.000Z');
});

/**
 * O truncamento é em **UTC**, e este teste é o que segura isso.
 *
 * A máquina que roda o projeto está em UTC-3. Se `truncar` usasse os getters
 * locais, o início de março seria `2026-03-01T03:00:00Z` e as três horas de
 * diferença moveriam para fevereiro toda linha de 01/03 entre 00h e 03h. É pouca
 * linha e número plausível — o pior tipo de erro que este projeto pode ter.
 */
test('truncar trabalha em UTC, não no fuso da máquina', () => {
  const viradaDoMes = new Date(Date.UTC(2026, 2, 1, 1, 30));
  assert.equal(iso(truncar(viradaDoMes, 'month', 'x')), '2026-03-01T00:00:00.000Z');
  assert.equal(iso(truncar(viradaDoMes, 'day', 'x')), '2026-03-01T00:00:00.000Z');
});

test("truncar recusa 'week' pelo nome, em vez de escolher uma convenção", () => {
  assert.throws(() => truncar(AGORA, 'week', 'filtro X'), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /filtro X/);
    assert.match(e.message, /week/);
    return true;
  });
});

// ---------------------------------------------------------------------------
// deslocar
// ---------------------------------------------------------------------------

test('deslocar anda em dias, horas, minutos e segundos', () => {
  assert.equal(iso(deslocar(AGORA, -7, 'day', 'x')), '2026-03-08T14:37:52.123Z');
  assert.equal(iso(deslocar(AGORA, 1, 'day', 'x')), '2026-03-16T14:37:52.123Z');
  assert.equal(iso(deslocar(AGORA, -2, 'hour', 'x')), '2026-03-15T12:37:52.123Z');
  assert.equal(iso(deslocar(AGORA, 30, 'minute', 'x')), '2026-03-15T15:07:52.123Z');
  assert.equal(iso(deslocar(AGORA, 8, 'second', 'x')), '2026-03-15T14:38:00.123Z');
});

/**
 * Deslocar em dias atravessa a virada do ano e do mês sem tratamento especial —
 * é aritmética de instante, e é o que a base usa (os 12 deslocamentos do
 * relatório são todos em dias, travado em cobertura.test.ts).
 */
test('deslocar em dias atravessa mês e ano', () => {
  const ano = new Date(Date.UTC(2026, 0, 3));
  assert.equal(iso(deslocar(ano, -7, 'day', 'x')), '2025-12-27T00:00:00.000Z');
});

test('deslocar em mês e ano anda por calendário, não por 30/365 dias', () => {
  const jan31 = new Date(Date.UTC(2026, 0, 31));
  assert.equal(iso(deslocar(jan31, 12, 'month', 'x')), '2027-01-31T00:00:00.000Z');
  assert.equal(iso(deslocar(jan31, 1, 'year', 'x')), '2027-01-31T00:00:00.000Z');
});

/**
 * **Divergência conhecida e hoje inalcançável: dia que não existe no mês destino.**
 *
 * 31/01 + 1 mês transborda para 03/03 (é o `Date.UTC` do JS somando ao mês), e o
 * `DateAdd` do Power BI grampeia em 28/02. Este teste **documenta** o
 * comportamento em vez de afirmar que ele está certo.
 *
 * Não está corrigido porque nenhum filtro da base desloca em mês — os 12
 * deslocamentos do relatório são em dias, e cobertura.test.ts falha se isso
 * mudar. É esse teste, e não este, que avisa quando o conserto passa a ser
 * necessário: grampear agora seria escrever regra sem caso de uso para conferir.
 */
test('deslocar em mês transborda no dia inexistente — divergência declarada', () => {
  const jan31 = new Date(Date.UTC(2026, 0, 31));
  assert.equal(iso(deslocar(jan31, 1, 'month', 'x')), '2026-03-03T00:00:00.000Z');
});

test('deslocar recusa unidade que não conhece', () => {
  assert.throws(() => deslocar(AGORA, 1, 'week', 'filtro Y'), /filtro Y.*week/s);
});

// ---------------------------------------------------------------------------
// ancora
// ---------------------------------------------------------------------------

test('âncora `agora` é o relógio injetado, não o do sistema', () => {
  assert.equal(ancora({ anchor_kind: 'agora', anchor: null }, AGORA, 'x').getTime(), AGORA.getTime());
});

/**
 * O literal não traz fuso (`2026-01-01T00:00:00`) e é lido como UTC.
 *
 * Sem o `Z`, `new Date()` leria em fuso local: em UTC-3 a data viraria
 * `2026-01-01T03:00:00Z`, e um filtro `>= 01/01/2026` passaria a excluir as
 * linhas da madrugada do dia 1º.
 */
test('âncora literal é lida como UTC, não no fuso local', () => {
  const d = ancora({ anchor_kind: 'literal', anchor: '2026-01-01T00:00:00' }, AGORA, 'x');
  assert.equal(iso(d), '2026-01-01T00:00:00.000Z');
});

test('âncora literal sem data legível erra alto', () => {
  assert.throws(() => ancora({ anchor_kind: 'literal', anchor: null }, AGORA, 'x'), DaxEvalError);
  assert.throws(() => ancora({ anchor_kind: 'literal', anchor: 'ontem' }, AGORA, 'x'), DaxEvalError);
});

/**
 * `desconhecido` é o caso que o ACHADOS #29 registra: antes, âncora que o extrator
 * não soube ler virava "agora" por presunção. Presumir aqui dá um número plausível
 * — e errado sempre que a âncora for uma data fixa.
 */
test('âncora desconhecida erra alto em vez de presumir "agora"', () => {
  assert.throws(() => ancora({ anchor_kind: 'desconhecido', anchor: null }, AGORA, 'card Z'), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /card Z/);
    assert.match(e.message, /#29/);
    return true;
  });
});

// ---------------------------------------------------------------------------
// resolveSpan
// ---------------------------------------------------------------------------

const span = (p: Partial<SpanSpec>): SpanSpec => ({
  anchor_kind: 'agora', anchor: null, time_unit: 'month', time_unit_code: null, ...p,
});

test('resolveSpan trunca a âncora na unidade do span', () => {
  assert.equal(iso(resolveSpan(span({ time_unit: 'month' }), AGORA, 'x')), '2026-03-01T00:00:00.000Z');
  assert.equal(iso(resolveSpan(span({ time_unit: 'year' }), AGORA, 'x')), '2026-01-01T00:00:00.000Z');
});

test('resolveSpan sem unidade erra alto', () => {
  assert.throws(() => resolveSpan(span({ time_unit: null }), AGORA, 'x'), DaxEvalError);
});

// ---------------------------------------------------------------------------
// resolveBorda
// ---------------------------------------------------------------------------

const borda = (p: Partial<BordaSpec>): BordaSpec => ({
  anchor_kind: 'agora', anchor: null, truncate: 'day', truncate_code: null, offsets: [], ...p,
});

/** É a forma real de "os últimos 7 dias" no relatório: agora − 7 dias, truncado no dia. */
test('resolveBorda aplica deslocamento e depois trunca', () => {
  const b = borda({ offsets: [{ amount: -7, time_unit: 'day', time_unit_code: null }] });
  assert.equal(iso(resolveBorda(b, AGORA, 'x')), '2026-03-08T00:00:00.000Z');
});

test('resolveBorda sem deslocamento nenhum é a âncora truncada', () => {
  assert.equal(iso(resolveBorda(borda({}), AGORA, 'x')), '2026-03-15T00:00:00.000Z');
});

/**
 * **A ordem dos deslocamentos é a inversa da que a spec grava.** A spec segue o
 * aninhamento do JSON do PBIP, onde o `DateAdd` mais externo aparece primeiro e é
 * o que acontece por **último**.
 *
 * Achar um caso que separa as duas ordens deu trabalho, e o motivo vale registro:
 * somar mês no JS é "troca o índice do mês e deixa o dia transbordar", e isso
 * comuta com somar dia em quase toda data — 31/01 dá 02/03 nas duas ordens. Só
 * separa quando o deslocamento de dia atravessa a fronteira do mês, e é o caso
 * abaixo: 01/03 é o primeiro dia do mês, então −1 dia cai em fevereiro.
 */
test('os deslocamentos são aplicados do mais interno para o mais externo', () => {
  // spec: [+1 mês, −1 dia] => acontece −1 dia primeiro, depois +1 mês.
  const b = borda({
    anchor_kind: 'literal',
    anchor: '2026-03-01T00:00:00',
    truncate: 'day',
    offsets: [
      { amount: 1, time_unit: 'month', time_unit_code: null },
      { amount: -1, time_unit: 'day', time_unit_code: null },
    ],
  });
  // 01/03 − 1 dia = 28/02; +1 mês = 28/03. Na ordem trocada daria 31/03.
  assert.equal(iso(resolveBorda(b, AGORA, 'x')), '2026-03-28T00:00:00.000Z');
});

test('resolveBorda com deslocamento incompleto erra alto', () => {
  const b = borda({ offsets: [{ amount: null, time_unit: 'day', time_unit_code: null }] });
  assert.throws(() => resolveBorda(b, AGORA, 'x'), DaxEvalError);
});

/**
 * Sem truncamento, "os últimos 7 dias" começaria às 14h37 de sete dias atrás e
 * perderia as linhas da manhã daquele dia. O erro cita o achado porque foi
 * exatamente esse o defeito.
 */
test('resolveBorda sem truncamento erra alto', () => {
  assert.throws(() => resolveBorda(borda({ truncate: null }), AGORA, 'x'), (e: unknown) => {
    assert.ok(e instanceof DaxEvalError);
    assert.match(e.message, /#29/);
    return true;
  });
});
