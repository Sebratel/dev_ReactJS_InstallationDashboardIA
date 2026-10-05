// O contexto filho reaproveita do pai o que o filtro novo não alcança (ACHADOS #177).
//
// Uma tabela agrupada por protocolo cria um contexto por linha, e cada um nascia de
// cache vazio: com um filtro de outra tabela na tela, a propagação era refeita por
// linha — mais de 220 s e 6 GB numa abertura da `agendamento-field`. A regra que estes
// testes fixam: a resposta só é reaproveitada quando a travessia de relacionamentos da
// tabela não passa por nenhuma tabela cujos filtros mudaram; quando passa, recalcula.
// A paridade nas 14 páginas reais é `npm run bench:filtro-pai-paridade`.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn } from '../../semantic-model/src/types.ts';
import { Dataset, type Row } from '../src/dataset.ts';
import { Evaluator } from '../src/evaluator.ts';
import { defineReaproveitamentoDoPai, type TableFilter } from '../src/filter.ts';
import { makeDate } from '../src/value.ts';

function col(name: string): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null };
}

/** `CAL` (lado "one") filtra `PG` (lado "many") por `DATA`; `OUTRA` não se liga a nada. */
function montar(): Evaluator {
  const model = new SemanticModel();
  model.addTable({ id: 'cal', name: 'CAL', queryRef: null, columns: [col('DATA')] });
  model.addTable({ id: 'pg', name: 'PG', queryRef: null, columns: [col('SOLICITACAO'), col('DATA')] });
  model.addTable({ id: 'outra', name: 'OUTRA', queryRef: null, columns: [col('X')] });
  model.relationships.push({
    id: 'r1', fromTable: 'PG', fromColumn: 'DATA', toTable: 'CAL', toColumn: 'DATA',
    fromCardinality: 'many', toCardinality: 'one', active: true, crossFilter: 'oneDirection', joinOnDateBehavior: null,
  });
  const d = (n: number) => makeDate(2026, 1, n);
  const dataset = new Dataset();
  dataset.addTable('CAL', [{ DATA: d(1) }, { DATA: d(2) }, { DATA: d(3) }] as Row[]);
  dataset.addTable('PG', [
    { SOLICITACAO: 'S1', DATA: d(1) },
    { SOLICITACAO: 'S2', DATA: d(2) },
    { SOLICITACAO: 'S3', DATA: d(3) },
  ] as Row[]);
  dataset.addTable('OUTRA', [{ X: 1 }, { X: 2 }] as Row[]);
  return new Evaluator({ model, dataset, now: d(5) });
}

function filtro(table: string, coluna: string, ok: (v: unknown) => boolean): TableFilter {
  return { table, columns: new Set([coluna]), origem: `${table}[${coluna}]`, keep: (r: Row) => ok((r as Record<string, unknown>)[coluna]) };
}

test('o filho devolve o MESMO array do pai para a tabela que o filtro novo não alcança', () => {
  defineReaproveitamentoDoPai(true);
  const ev = montar();
  // Pai: filtro no calendário (dias 2 e 3), que propaga para PG.
  const pai = ev.rootScope().filter.with([filtro('cal', 'data', (v) => (v as Date).getUTCDate() >= 2)]);
  const pgDoPai = pai.rowsOf('PG');
  assert.equal(pgDoPai.length, 2);
  // Filho: um filtro em OUTRA, que não se liga a PG nem a CAL.
  const filho = pai.with([filtro('outra', 'x', (v) => v === 1)]);
  assert.equal(filho.rowsOf('PG'), pgDoPai, 'devia reaproveitar a propagação do pai');
  assert.equal(filho.rowsOf('OUTRA').length, 1);
});

test('a tabela que o filtro novo ALCANÇA é recalculada, com a resposta certa', () => {
  defineReaproveitamentoDoPai(true);
  const ev = montar();
  const pai = ev.rootScope().filter.with([filtro('cal', 'data', (v) => (v as Date).getUTCDate() >= 2)]);
  const pgDoPai = pai.rowsOf('PG');
  // Filtro em PG: PG muda (S2 só) — e CAL não, porque oneDirection não volta.
  const filhoPg = pai.with([filtro('pg', 'solicitacao', (v) => v === 'S2')]);
  assert.notEqual(filhoPg.rowsOf('PG'), pgDoPai);
  assert.deepEqual(filhoPg.rowsOf('PG').map((r) => (r as Record<string, unknown>).solicitacao), ['S2']);
  assert.equal(filhoPg.rowsOf('CAL'), pai.rowsOf('CAL'));
  // Filtro novo no CALENDÁRIO substitui o do pai e chega em PG pela propagação.
  const filhoCal = pai.with([filtro('cal', 'data', (v) => (v as Date).getUTCDate() === 1)]);
  assert.deepEqual(filhoCal.rowsOf('PG').map((r) => (r as Record<string, unknown>).solicitacao), ['S1']);
});

test('desligado, cada contexto calcula do zero — e chega à mesma resposta', () => {
  const ev = montar();
  const casos = (ligado: boolean) => {
    defineReaproveitamentoDoPai(ligado);
    const pai = ev.rootScope().filter.with([filtro('cal', 'data', (v) => (v as Date).getUTCDate() >= 2)]);
    const filho = pai.with([filtro('outra', 'x', (v) => v === 2)]).with([filtro('pg', 'solicitacao', (v) => v !== 'S3')]);
    return ['PG', 'CAL', 'OUTRA'].map((t) => filho.rowsOf(t).length);
  };
  try {
    assert.deepEqual(casos(true), casos(false));
  } finally {
    defineReaproveitamentoDoPai(true);
  }
});
