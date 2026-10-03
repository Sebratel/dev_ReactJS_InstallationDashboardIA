// Trava a leitura de `timestamp`/`date` SEM fuso como UTC.
//
// O que estes testes protegem, em uma frase: o número que o banco escreveu é o
// número que a medida vê. `Protocolos Manhã` dava 20 contra 12.269 do Power BI
// porque `2026-08-10 10:00:00` chegava como `13:00Z`, e `HOUR()` respondia 13.
//
// Estes testes falham se alguém trocar `parseSemFuso` por `new Date(texto)` —
// que é exatamente o que o `pg` faz de fábrica, e exatamente o bug. Por isso o
// teste de mutação está no fim, escrito.

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSemFuso, tiposSemFuso } from '../src/connectors-sql.ts';

test('parseSemFuso: timestamp sem fuso não anda de hora', () => {
  const d = parseSemFuso('2026-08-10 10:00:00');
  assert.ok(d instanceof Date);
  assert.equal(d.toISOString(), '2026-08-10T10:00:00.000Z');
  // A asserção que interessa de verdade: é isto que `HOUR()` chama.
  assert.equal(d.getUTCHours(), 10, 'dez da manhã no banco é dez da manhã aqui');
});

test('parseSemFuso: o caso real do card — 10:00 é manhã, não tarde', () => {
  // Linha real de FIELD AGENDA, sem os campos identificáveis: o slot é
  // `2026-08-10 10:00:00` e o texto do relato diz "turno da MANHÃ".
  const slot = parseSemFuso('2026-08-10 10:00:00');
  assert.ok(slot !== null);
  const turno = slot.getUTCHours() < 12 ? 'Manhã' : 'Tarde';
  assert.equal(turno, 'Manhã');

  // E o slot da tarde continua tarde — o conserto não empurra tudo para um lado.
  const tarde = parseSemFuso('2026-08-10 14:00:00');
  assert.ok(tarde !== null);
  assert.equal(tarde.getUTCHours() < 12 ? 'Manhã' : 'Tarde', 'Tarde');
});

test('parseSemFuso: 21h não vira o dia seguinte', () => {
  // O estrago silencioso: sob hora de Brasília isto virava 2026-08-10T00:30:00Z,
  // e todo agrupamento por dia contava a linha no dia errado.
  const d = parseSemFuso('2026-08-09 21:30:00');
  assert.ok(d !== null);
  assert.equal(d.toISOString(), '2026-08-09T21:30:00.000Z');
  assert.equal(d.getUTCDate(), 9);
});

test('parseSemFuso: `date` puro é meia-noite UTC', () => {
  const d = parseSemFuso('2026-08-10');
  assert.ok(d !== null);
  assert.equal(d.toISOString(), '2026-08-10T00:00:00.000Z');
});

test('parseSemFuso: aceita `T` como separador e fração de segundo', () => {
  assert.equal(parseSemFuso('2026-08-10T10:00:00')?.toISOString(), '2026-08-10T10:00:00.000Z');
  assert.equal(parseSemFuso('2026-08-10 10:00:00.123')?.toISOString(), '2026-08-10T10:00:00.123Z');
  // O Postgres manda até 6 casas; `Date` só guarda 3. Truncar é a única opção,
  // e truncar em silêncio é aceitável aqui: perde microssegundo, não hora.
  assert.equal(parseSemFuso('2026-08-10 10:00:00.123456')?.toISOString(), '2026-08-10T10:00:00.123Z');
  assert.equal(parseSemFuso('2026-08-10 10:00:00.1')?.toISOString(), '2026-08-10T10:00:00.100Z');
});

test('parseSemFuso: nulo e vazio são nulo, não Invalid Date', () => {
  assert.equal(parseSemFuso(null), null);
  assert.equal(parseSemFuso(''), null);
  assert.equal(parseSemFuso('   '), null);
});

test('parseSemFuso: o que não sabe ler, erra alto', () => {
  // `new Date('10/08/2026')` devolveria 10 de agosto ou 8 de outubro conforme a
  // biblioteca. Nenhuma das duas é resposta: a pergunta é ambígua.
  for (const ruim of ['10/08/2026', '2026-08-10 10:00', 'ontem', '2026-13-99 10:00:00']) {
    assert.throws(() => parseSemFuso(ruim), /não consegui ler/i, `deveria recusar: ${ruim}`);
  }
});

test('parseSemFuso: infinity erra alto em vez de virar NaN', () => {
  assert.throws(() => parseSemFuso('infinity'), /não tem representação/);
  assert.throws(() => parseSemFuso('-infinity'), /não tem representação/);
});

// -------------------------------------------------------------- os OIDs

test('tiposSemFuso: intercepta timestamp (1114) e date (1082), e só eles', () => {
  const marcador = Symbol('parser de fábrica');
  const { getTypeParser } = tiposSemFuso(() => marcador);

  assert.equal(getTypeParser(1114), parseSemFuso, 'timestamp without time zone');
  assert.equal(getTypeParser(1082), parseSemFuso, 'date');

  // 1184 é `timestamptz`: ali o instante é real e o `pg` acerta. Trocar o parser
  // dele moveria dado que estava certo — é o erro simétrico deste conserto.
  assert.equal(getTypeParser(1184), marcador, 'timestamptz fica com o parser de fábrica');
  for (const oid of [23, 25, 701, 1700, 16]) {
    assert.equal(getTypeParser(oid), marcador, `OID ${oid} não é nosso`);
  }
});

test('tiposSemFuso: formato binário fica com o parser de fábrica', () => {
  // `parseSemFuso` lê texto. Se o driver pedir binário, quem sabe decodificar é
  // ele — devolver nosso parser ali entregaria um Buffer para uma regex.
  const marcador = Symbol('parser de fábrica');
  const { getTypeParser } = tiposSemFuso(() => marcador);
  assert.equal(getTypeParser(1114, 'binary'), marcador);
  assert.equal(getTypeParser(1114, 'text'), parseSemFuso);
});

// -------------------------------------------------------------- mutação

test('mutação: o parser de fábrica do `pg` faria o card errar de novo', () => {
  // Este é o teste que dá sentido aos outros. `new Date('2026-08-10 10:00:00')`
  // é o que o `pg` faz quando ninguém escolhe fuso — e o resultado depende do
  // fuso do processo. Aqui a máquina está em America/Sao_Paulo, então ele
  // devolve 13:00Z e o turno vira "Tarde".
  //
  // Se algum dia este teste começar a falhar, leia o `assert` de baixo antes de
  // consertar: ou o fuso da máquina mudou, ou alguém já removeu o conserto.
  const offsetHoras = -new Date('2026-08-10T12:00:00Z').getTimezoneOffset() / 60;
  if (offsetHoras !== -3) {
    // Em CI com TZ=UTC o bug não se manifesta, e é justamente por isso que ele
    // sobreviveu tanto tempo: some na máquina errada.
    return;
  }

  const comoOPgFazia = new Date('2026-08-10 10:00:00');
  assert.equal(comoOPgFazia.getUTCHours(), 13, 'o bug: dez da manhã lida como 13:00Z');
  assert.equal(comoOPgFazia.getUTCHours() < 12 ? 'Manhã' : 'Tarde', 'Tarde');

  const consertado = parseSemFuso('2026-08-10 10:00:00');
  assert.ok(consertado !== null);
  assert.equal(consertado.getUTCHours() < 12 ? 'Manhã' : 'Tarde', 'Manhã');
  assert.notEqual(
    consertado.getTime(),
    comoOPgFazia.getTime(),
    'se os dois derem o mesmo instante, o conserto saiu do lugar',
  );
});
