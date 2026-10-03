// `semOrdemDeTopo` decide o que a sonda de custo pode cortar do SQL, e cortar
// errado inverte a conclusão dela: se ela arrancar um `order by` que faz parte da
// semântica (o de um `row_number() over (...)`, por exemplo), a medição "sem
// ordem" passa a ser de OUTRA query, e a diferença que a sonda atribui à
// ordenação vira ruído — com cara de número medido.
//
// Por isso o corte é da última ocorrência com parênteses equilibrados até o fim
// do texto, e não um `replace` de `order by`. Estes testes fixam essa regra.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { semOrdemDeTopo } from '../src/ordem-de-topo.ts';

describe('semOrdemDeTopo', () => {
  test('corta o order by de topo', () => {
    const r = semOrdemDeTopo('select a from t order by a asc');
    assert.equal(r.achou, true);
    assert.equal(r.sql, 'select a from t');
  });

  test('não corta order by dentro de janela — ali ele é semântica, não apresentação', () => {
    const sql =
      'select row_number() over (partition by x order by contrato, active) as n from t';
    const r = semOrdemDeTopo(sql);
    assert.equal(r.achou, false, 'o único order by está dentro de parênteses');
    assert.equal(r.sql, sql);
  });

  test('não corta order by dentro de subconsulta', () => {
    const sql = 'select * from (select a from t order by a) x';
    const r = semOrdemDeTopo(sql);
    assert.equal(r.achou, false);
    assert.equal(r.sql, sql);
  });

  test('com janela E order by de topo, corta só o de topo', () => {
    const sql =
      'select row_number() over (partition by x order by contrato) n from t order by n desc';
    const r = semOrdemDeTopo(sql);
    assert.equal(r.achou, true);
    assert.equal(r.sql, 'select row_number() over (partition by x order by contrato) n from t');
  });

  test('SQL sem order by nenhum volta intacto, e diz que não achou', () => {
    const r = semOrdemDeTopo('select a from t where b is not null');
    assert.equal(r.achou, false);
    assert.equal(r.sql, 'select a from t where b is not null');
  });

  test('o order by real de contratos é o de topo e sai inteiro', () => {
    // O da spec, com a quebra de linha e a tabulação que ela tem.
    const sql = 'select p.name\n\tfrom authentication_contracts ac\n\twhere x is not true\n\torder by p.name asc';
    const r = semOrdemDeTopo(sql);
    assert.equal(r.achou, true);
    assert.equal(r.sql.includes('order by'), false);
    assert.equal(r.sql.includes('where x is not true'), true);
  });
});
