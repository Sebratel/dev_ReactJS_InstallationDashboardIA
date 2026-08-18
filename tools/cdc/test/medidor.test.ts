// O medidor de CDC — a conta que decide se a Fase 4 abre.
//
// **O que estes testes guardam, antes de tudo, é que dado de cliente não passa.**
// Um evento Debezium carrega a linha inteira. Se um dia alguém puser o payload em
// `EventoMinimo` "só para depurar", o primeiro teste daqui cai.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import { Medidor, leEnvelope, medianaDeIntervalos, tabelaDoTopico } from '../src/medidor.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const registry = (): QueryRegistry => QueryRegistry.fromSpecsDir(path.join(ROOT, 'specs'));

/** Um envelope Debezium com dado sensível dentro, como o de verdade tem. */
const COM_DADO = JSON.stringify({
  op: 'u',
  ts_ms: 1_754_900_000_000,
  source: { schema: 'erp', table: 'assignment_incidents', lsn: 12345 },
  before: { id: 1, cliente: 'FULANO DE TAL', endereco: 'RUA X, 123', cpf: '000.000.000-00' },
  after: { id: 1, cliente: 'FULANO DE TAL', endereco: 'RUA Y, 456', cpf: '000.000.000-00' },
});

// ---------------------------------------------------------------- privacidade

test('leEnvelope descarta o payload: nada do dado da linha sobrevive', () => {
  const e = leEnvelope('voalle.erp.assignment_incidents', COM_DADO, 1000);
  assert.ok(e);
  // A checagem é sobre o objeto **inteiro**, não sobre campos escolhidos a dedo:
  // um campo novo que carregasse payload seria pego aqui sem ninguém lembrar.
  const serializado = JSON.stringify(e);
  for (const vazamento of ['FULANO', 'RUA X', 'RUA Y', '000.000.000-00', 'before', 'after', 'cpf']) {
    assert.ok(!serializado.includes(vazamento), `vazou '${vazamento}' em: ${serializado}`);
  }
  assert.deepEqual(Object.keys(e).sort(), ['op', 'recebidoEm', 'schema', 'tabela', 'topico', 'ts']);
});

test('o relatório não carrega valor de linha', () => {
  const m = new Medidor(registry());
  m.registra(leEnvelope('voalle.erp.assignment_incidents', COM_DADO, 1000)!);
  const texto = JSON.stringify(m.relatorio(2000));
  for (const vazamento of ['FULANO', 'RUA', 'cpf']) {
    assert.ok(!texto.includes(vazamento), `vazou '${vazamento}'`);
  }
});

// -------------------------------------------------------------------- envelope

test('leEnvelope aceita o envelope com schema e o desembrulhado', () => {
  const desembrulhado = leEnvelope('voalle.erp.contracts', COM_DADO, 1);
  const comSchema = leEnvelope(
    'voalle.erp.contracts',
    JSON.stringify({ schema: { type: 'struct' }, payload: JSON.parse(COM_DADO) }),
    1,
  );
  assert.equal(desembrulhado?.tabela, 'assignment_incidents');
  assert.equal(comSchema?.tabela, 'assignment_incidents', 'o payload aninhado também é lido');
});

test('leEnvelope cai para o nome do tópico quando o envelope não traz source', () => {
  // É o que `ExtractNewRecordState` produz: sem `source`, só as colunas. Sem esta
  // rede o conector configurado assim daria 100% de eventos ilegíveis.
  const e = leEnvelope('voalle.erp.contracts', JSON.stringify({ id: 1, v_status: 3 }), 1);
  assert.equal(e?.tabela, 'contracts');
  assert.equal(e?.schema, 'erp');
  assert.equal(e?.op, '?', 'operação desconhecida é dita, não inventada');
});

test('leEnvelope trata a tombstone (valor nulo) como evento, não como lixo', () => {
  const e = leEnvelope('voalle.erp.contracts', null, 7);
  assert.equal(e?.op, 'tombstone');
  assert.equal(e?.tabela, 'contracts');
});

test('leEnvelope devolve null para o que não dá para entender', () => {
  assert.equal(leEnvelope('voalle.erp.t', 'isto não é json', 1), null);
  assert.equal(leEnvelope('voalle.erp.t', '"texto solto"', 1), null);
  assert.equal(leEnvelope('semponto', null, 1), null);
});

test('tabelaDoTopico: <prefixo>.<schema>.<tabela>', () => {
  assert.deepEqual(tabelaDoTopico('voalle.erp.assignment_incidents'), {
    schema: 'erp',
    tabela: 'assignment_incidents',
  });
  assert.deepEqual(tabelaDoTopico('maria.db_applicattion.installation_teams'), {
    schema: 'db_applicattion',
    tabela: 'installation_teams',
  });
  assert.deepEqual(tabelaDoTopico('so.dois'), { schema: null, tabela: 'dois' });
  assert.equal(tabelaDoTopico('um'), null);
});

// ---------------------------------------------------------------------- mapa

test('a tabela é ligada às queries pelo source_tables que já existe', () => {
  const m = new Medidor(registry());
  m.registra(leEnvelope('voalle.erp.assignment_incidents', COM_DADO, 1000)!);
  const r = m.relatorio(2000);

  const t = r.tabelas.find((x) => x.tabela === 'assignment_incidents');
  assert.ok(t, 'a tabela entrou no relatório');
  assert.ok(t.queries.includes('protocolos-geral'), `queries: ${t.queries.join(', ')}`);
  assert.ok(r.queries.some((q) => q.query === 'protocolos-geral' && q.sujeiras === 1));
});

test('dbMaria declara schema.tabela, e isso também resolve', () => {
  // `gestores-equipes` declara `db_applicattion.installation_teams`; `dbVoalle`
  // declara o nome pelado. Procurar só uma das formas deixaria metade fora do mapa.
  const m = new Medidor(registry());
  m.registra({
    topico: 'maria.db_applicattion.installation_teams',
    schema: 'db_applicattion',
    tabela: 'installation_teams',
    op: 'u',
    ts: null,
    recebidoEm: 1,
  });
  const r = m.relatorio(2);
  assert.ok(
    r.queries.some((q) => q.query === 'gestores-equipes'),
    `queries: ${r.queries.map((q) => q.query).join(', ')}`,
  );
});

test('tabela que nenhuma query usa aparece como desconhecida, não some', () => {
  const m = new Medidor(registry());
  m.registra({
    topico: 'voalle.erp.tabela_que_ninguem_usa',
    schema: 'erp',
    tabela: 'tabela_que_ninguem_usa',
    op: 'c',
    ts: null,
    recebidoEm: 1,
  });
  const r = m.relatorio(2);
  assert.deepEqual(r.desconhecidas, ['tabela_que_ninguem_usa']);
  assert.equal(r.queries.length, 0, 'nenhuma query fica suja por ela');
});

test('o ilegível é contado, e conta como evento', () => {
  const m = new Medidor(registry());
  m.ilegivel(10);
  m.ilegivel(20);
  const r = m.relatorio(30);
  assert.equal(r.ilegiveis, 2);
  assert.equal(r.eventos, 2, 'esconder o ilegível do total faria a taxa parecer menor');
});

// ------------------------------------------------------------------ mediana

test('medianaDeIntervalos: menos de dois eventos não têm intervalo', () => {
  assert.equal(medianaDeIntervalos([]), null);
  assert.equal(medianaDeIntervalos([5]), null);
});

test('medianaDeIntervalos: ímpar pega o do meio, par tira a média dos dois', () => {
  assert.equal(medianaDeIntervalos([0, 10, 30, 60]), 20); // gaps 10,20,30 → 20
  assert.equal(medianaDeIntervalos([0, 10, 30]), 15); // gaps 10,20 → 15
});

test('medianaDeIntervalos: uma rajada não faz a base parecer que muda o tempo todo', () => {
  // 100 eventos no mesmo milissegundo (uma importação) e depois um a cada hora.
  // A média diria ~36 s; a mediana diz 0 ms para a rajada — e é por isso que o
  // relatório usa mediana e ainda assim mostra a contagem ao lado.
  const rajada = Array.from({ length: 100 }, (_, i) => 1000 + i);
  const espacados = [4_600_000, 8_200_000, 11_800_000];
  const m = medianaDeIntervalos([...rajada, ...espacados])!;
  assert.ok(m < 1000, `mediana ${m} deveria refletir a rajada, não a média`);
});

test('Medidor: a janela de amostras é limitada — vigiar o fim de semana não vaza memória', () => {
  const m = new Medidor(registry());
  const total = Medidor.AMOSTRAS_MAXIMO + 500;
  for (let i = 0; i < total; i += 1) {
    m.registra({
      topico: 'voalle.erp.assignment_incidents',
      schema: 'erp',
      tabela: 'assignment_incidents',
      op: 'u',
      ts: null,
      recebidoEm: i,
    });
  }
  const r = m.relatorio(total);
  assert.equal(r.eventos, total, 'o total continua contando tudo');
  const q = r.queries.find((x) => x.query === 'protocolos-geral')!;
  assert.equal(q.sujeiras, Medidor.AMOSTRAS_MAXIMO, 'só as amostras é que são limitadas');
});
