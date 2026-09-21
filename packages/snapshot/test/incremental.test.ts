// A carga incremental é a única parte do snapshot que pode **perder dado em
// silêncio**: ela decide o que NÃO buscar. Cada teste aqui existe por uma dessas
// portas, e o nome diz qual.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';
import {
  comoDia,
  costura,
  decideIncremental,
  desdeDe,
  lePoliticas,
  marcaDe,
  mescla,
  planejaBusca,
  type CabecalhoAnterior,
  type PoliticaIncremental,
} from '../src/incremental.ts';

const POLITICA: PoliticaIncremental = {
  query: 'q',
  parametro: 'desde',
  piso: '2026-01-01',
  marca: ['DATA CRIADO', 'DATA ENCERRADO'],
  chave: ['SOLICITACAO'],
  margemDias: 2,
  idadeMaximaDias: 7,
  costura: [{ de: 'WITH bruto AS (', para: 'WITH alvos AS (SELECT 1 WHERE x >= :desde), bruto AS (' }],
};

const d = (iso: string): Date => new Date(iso);

// --------------------------------------------------------------------- costura

test('a costura troca a âncora e exige o parâmetro', () => {
  const saida = costura('WITH bruto AS (SELECT 1)', POLITICA);
  assert.ok(saida.includes('alvos'));
  assert.ok(saida.includes(':desde'));
});

test('âncora que não existe no SQL derruba, em vez de rodar sem recorte', () => {
  // Se isto passasse, a consulta traria o conjunto INTEIRO e a mesclagem o
  // gravaria como se fosse só a janela — dado certo, marca errada.
  assert.throws(
    () => costura('SELECT 1', POLITICA),
    /aparece 0 vez\(es\)/,
  );
});

test('âncora repetida derruba: replace trocaria só a primeira', () => {
  assert.throws(
    () => costura('WITH bruto AS (x) WITH bruto AS (y)', POLITICA),
    /aparece 2 vez\(es\)/,
  );
});

test('costura que não deixa o parâmetro no SQL derruba', () => {
  const semParametro: PoliticaIncremental = {
    ...POLITICA,
    costura: [{ de: 'WITH bruto AS (', para: 'WITH bruto AS (' }],
  };
  assert.throws(() => costura('WITH bruto AS (SELECT 1)', semParametro), /não cita ':desde'/);
});

// ----------------------------------------------------------------- marca d'água

test('a marca é o MAIOR entre as colunas, e ignora nulo', () => {
  // `DATA ENCERRADO` é nula em solicitação que nunca mudou. Se a marca fosse só
  // ela, toda linha nova ficaria de fora da próxima janela.
  const linhas = [
    { 'data criado': d('2026-03-01T00:00:00Z'), 'data encerrado': null },
    { 'data criado': d('2026-02-01T00:00:00Z'), 'data encerrado': d('2026-08-20T00:00:00Z') },
  ];
  assert.equal(marcaDe(linhas, POLITICA.marca)!.toISOString(), '2026-08-20T00:00:00.000Z');
});

test('conjunto sem data devolve marca nula — não há de onde continuar', () => {
  assert.equal(marcaDe([{ 'data criado': null, 'data encerrado': null }], POLITICA.marca), null);
});

test('valor que não é Date não vira marca', () => {
  // Coluna de tipo misto pode trazer texto onde se esperava data. Ler '2026-99-99'
  // como marca daria um `:desde` no futuro e a janela viria vazia, calada.
  assert.equal(marcaDe([{ 'data criado': 'ontem' as never }], POLITICA.marca), null);
});

// ------------------------------------------------------------------------ desde

test('desde recua a margem a partir da marca', () => {
  assert.equal(desdeDe(d('2026-08-25T12:00:00Z'), POLITICA), '2026-08-23');
});

test('desde nunca desce abaixo do piso', () => {
  assert.equal(desdeDe(d('2026-01-02T00:00:00Z'), POLITICA), '2026-01-01');
});

test('comoDia é UTC, e não o fuso da máquina', () => {
  // Esta máquina roda em America/Sao_Paulo. Sem UTC, 21:00 do dia 25 viraria dia
  // 26 e a janela pularia um dia de dado.
  assert.equal(comoDia(d('2026-08-25T02:00:00Z')), '2026-08-25');
});

// ---------------------------------------------------------------------- decisão

const AGORA = d('2026-08-25T12:00:00Z');

test('com marca fresca e completa recente, pode', () => {
  const r = decideIncremental(
    { marca: '2026-08-25T00:00:00Z', geradoEm: '2026-08-25T11:00:00Z', completoEm: '2026-08-24T10:00:00Z' },
    POLITICA,
    AGORA,
  );
  assert.equal(r.pode, true);
  assert.equal(r.pode && r.desde, '2026-08-23');
  assert.equal(r.pode && r.completoEm, '2026-08-24T10:00:00Z');
});

test('arquivo sem marca não pode: é de antes desta versão do formato', () => {
  const r = decideIncremental({ geradoEm: '2026-08-25T11:00:00Z' }, POLITICA, AGORA);
  assert.equal(r.pode, false);
  assert.match(r.pode === false ? r.porque : '', /antes da marca/);
});

test('a idade que conta é a da última COMPLETA, não a do arquivo', () => {
  // O caso que a trava existe para pegar: uma corrente de incrementais mantém
  // `geradoEm` de hoje e mesmo assim vai ficando cega para o que sumiu da fonte.
  const r = decideIncremental(
    {
      marca: '2026-08-25T00:00:00Z',
      geradoEm: '2026-08-25T11:00:00Z', // recentíssimo
      completoEm: '2026-08-10T10:00:00Z', // 15 dias
      modo: 'incremental',
    },
    POLITICA,
    AGORA,
  );
  assert.equal(r.pode, false);
  assert.match(r.pode === false ? r.porque : '', /15\.1 dias \(teto: 7\)/);
});

test('sem completoEm, o geradoEm serve — arquivo antigo é de carga completa', () => {
  const r = decideIncremental(
    { marca: '2026-08-25T00:00:00Z', geradoEm: '2026-08-24T10:00:00Z' },
    POLITICA,
    AGORA,
  );
  assert.equal(r.pode, true);
  assert.equal(r.pode && r.completoEm, '2026-08-24T10:00:00Z');
});

test('marca no futuro não pode: a janela viria vazia com cara de refresh que deu certo', () => {
  const r = decideIncremental(
    { marca: '2026-09-30T00:00:00Z', geradoEm: '2026-08-25T11:00:00Z', completoEm: '2026-08-25T10:00:00Z' },
    POLITICA,
    AGORA,
  );
  assert.equal(r.pode, false);
  assert.match(r.pode === false ? r.porque : '', /no futuro/);
});

test('marca de hoje à noite não é "futuro": um dia de folga cobre o fuso', () => {
  // A marca sai de `::date` em UTC e o processo roda em America/Sao_Paulo. Sem a
  // folga de um dia, todo refresh depois das 21h se recusaria a rodar.
  const r = decideIncremental(
    { marca: '2026-08-25T00:00:00Z', geradoEm: '2026-08-25T11:00:00Z', completoEm: '2026-08-25T10:00:00Z' },
    POLITICA,
    d('2026-08-25T02:00:00Z'),
  );
  assert.equal(r.pode, true);
});

test('data de completa ilegível não pode', () => {
  const r = decideIncremental(
    { marca: '2026-08-25T00:00:00Z', geradoEm: 'ontem', completoEm: 'anteontem' },
    POLITICA,
    AGORA,
  );
  assert.equal(r.pode, false);
  assert.match(r.pode === false ? r.porque : '', /não é data/);
});

// -------------------------------------------------------------------- mesclagem

const corte = d('2026-08-20T00:00:00Z');

function linha(sol: string, criado: string, encerrado: string | null = null) {
  return {
    solicitacao: sol,
    'data criado': d(criado),
    'data encerrado': encerrado === null ? null : d(encerrado),
  };
}

test('linha antiga fora da janela e sem grupo novo é mantida', () => {
  const m = mescla({
    antigas: [linha('A', '2026-03-01T00:00:00Z')],
    novas: [],
    chave: POLITICA.chave,
    marca: POLITICA.marca,
    corte,
  });
  assert.equal(m.mantidas, 1);
  assert.equal(m.linhas.length, 1);
});

test('grupo reentregue substitui o que estava, mesmo fora da janela', () => {
  // Uma solicitação de março ENCERRADA hoje: fora da janela pela criação, dentro
  // dela pela busca. Sem esta regra ela apareceria duas vezes.
  const m = mescla({
    antigas: [linha('A', '2026-03-01T00:00:00Z')],
    novas: [linha('A', '2026-03-01T00:00:00Z', '2026-08-24T00:00:00Z')],
    chave: POLITICA.chave,
    marca: POLITICA.marca,
    corte,
  });
  assert.equal(m.substituidas, 1);
  assert.equal(m.linhas.length, 1);
  assert.equal(m.linhas[0]!['data encerrado']?.toString(), d('2026-08-24T00:00:00Z').toString());
});

test('linha dentro da janela que a fonte não reentregou some', () => {
  // Cancelada, ou saiu do filtro. Mantê-la seria ressuscitar dado que a fonte
  // já não tem.
  const m = mescla({
    antigas: [linha('A', '2026-08-22T00:00:00Z')],
    novas: [],
    chave: POLITICA.chave,
    marca: POLITICA.marca,
    corte,
  });
  assert.equal(m.sumidas, 1);
  assert.equal(m.linhas.length, 0);
});

test('a multiplicidade do append é preservada: o grupo entra inteiro', () => {
  // O SQL de `protocolos-produtividade` entrega a MESMA linha duas vezes de
  // propósito (dois ramos). Um `Map` por linha achataria isso e a tela contaria
  // menos. A substituição é por grupo justamente por causa disto.
  const m = mescla({
    antigas: [linha('A', '2026-03-01T00:00:00Z'), linha('A', '2026-03-01T00:00:00Z')],
    novas: [
      linha('A', '2026-03-01T00:00:00Z', '2026-08-24T00:00:00Z'),
      linha('A', '2026-03-01T00:00:00Z', '2026-08-24T00:00:00Z'),
    ],
    chave: POLITICA.chave,
    marca: POLITICA.marca,
    corte,
  });
  assert.equal(m.substituidas, 2);
  assert.equal(m.linhas.length, 2);
});

test('linha nova de grupo que não existia é acrescentada', () => {
  const m = mescla({
    antigas: [linha('A', '2026-03-01T00:00:00Z')],
    novas: [linha('B', '2026-08-24T00:00:00Z')],
    chave: POLITICA.chave,
    marca: POLITICA.marca,
    corte,
  });
  assert.equal(m.mantidas, 1);
  assert.equal(m.novas, 1);
  assert.equal(m.linhas.length, 2);
});

test('chave nula não colide com chave vazia', () => {
  // `null` e `''` como SOLICITACAO viravam a mesma identidade se a junção fosse
  // por concatenação crua — e um grupo apagaria o outro.
  const nulo = { solicitacao: null, 'data criado': d('2026-03-01T00:00:00Z'), 'data encerrado': null };
  const vazio = { solicitacao: '', 'data criado': d('2026-03-01T00:00:00Z'), 'data encerrado': null };
  const m = mescla({
    antigas: [nulo, vazio],
    novas: [{ ...vazio, 'data encerrado': d('2026-08-24T00:00:00Z') }],
    chave: POLITICA.chave,
    marca: POLITICA.marca,
    corte,
  });
  assert.equal(m.substituidas, 1, 'só o grupo de chave vazia deveria ter sido substituído');
  assert.equal(m.mantidas, 1);
});

// ------------------------------------------------------------------- a política

test('sem o arquivo, ninguém é incremental — e isso não é erro', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'incr-'));
  assert.equal(lePoliticas(dir).size, 0);
});

test('política sem chave derruba na leitura, não na hora de mesclar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'incr-'));
  fs.mkdirSync(path.join(dir, '_catalog'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '_catalog', 'incremental.yaml'),
    'formato: 1\nqueries:\n  q:\n    parametro: desde\n    piso: "2026-01-01"\n    marca: [X]\n',
    'utf8',
  );
  assert.throws(() => lePoliticas(dir), /não declara 'chave'/);
});

test("token 'ano-corrente' resolve para YYYY-01-01 do ano atual, nunca hardcoded", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'incr-'));
  fs.mkdirSync(path.join(dir, '_catalog'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '_catalog', 'incremental.yaml'),
    'formato: 1\nqueries:\n  q:\n    parametro: desde\n    piso: ano-corrente\n    marca: [X]\n    chave: [Y]\n    costura:\n      - de: WITH bruto AS (\n        para: WITH alvos AS (SELECT 1 WHERE x >= :desde), bruto AS (\n',
    'utf8',
  );
  const pols = lePoliticas(dir);
  const p = pols.get('q')!;
  const anoEsperado = new Date().getUTCFullYear();
  assert.equal(p.piso, `${anoEsperado}-01-01`, 'deve ser o primeiro dia do ano atual, não 2026');
});

test('a política de verdade do catálogo carrega e costura o SQL de produção', () => {
  // Guarda contra o caso que mais assusta: alguém edita o SQL da spec, a âncora
  // some, e ninguém descobre até a próxima carga incremental rodar em produção.
  const raiz = path.resolve(import.meta.dirname, '..', '..', '..');
  const politicas = lePoliticas(path.join(raiz, 'specs'));
  assert.ok(politicas.size > 0, 'specs/_catalog/incremental.yaml deveria ter ao menos uma query');
  for (const [id, p] of politicas) {
    const spec = path.join(raiz, 'specs', '_catalog', 'queries', `${id}.spec.yaml`);
    assert.ok(fs.existsSync(spec), `${id}: a spec da query não existe`);
    const { sql } = parseYaml(fs.readFileSync(spec, 'utf8')) as { sql: string | null };
    assert.ok(sql, `${id}: a spec não tem campo sql:`);
    const saida = costura(sql, p);
    assert.ok(saida.includes(`:${p.parametro}`), `${id}: o SQL costurado perdeu :${p.parametro}`);
    assert.ok(saida.length > sql.length, `${id}: a costura não acrescentou nada ao SQL`);
  }
});

test('o sql: de protocolos-produtividade é cópia FIEL do SQL de produção em docs/', () => {
  // ESTE É O TESTE QUE FALTAVA, e a falta dele custou o `INSTALADOR`.
  //
  // O teste acima já costurava o SQL real — e passou, verde, durante o dia inteiro
  // de 26/08/2026 com o SQL ERRADO. Ele guardava a ÂNCORA, não o CONTEÚDO: um
  // `git reset --hard` devolveu o `sql:` à versão extraída do PBIP (100 linhas, um
  // ramo, sem `INSTALADOR`), alguém reancorou a costura para casar com ela, e a
  // suíte continuou verde. O snapshot em disco ficou com 70.991 linhas — saída do
  // SQL de dois ramos — enquanto a spec produzia 70.868.
  //
  // `docs/sql/datahub-protocolos-produtividade.sql` diz no próprio cabeçalho:
  // "ESTE SQL É O QUE RODA EM PRODUÇÃO DESDE 25/08/2026 ... o campo `sql:` da spec
  // é uma cópia deste arquivo". Este teste transforma essa frase em invariante.
  //
  // Se você mudou o SQL de propósito: mude os DOIS arquivos. O documento é onde
  // vive o porquê de cada CTE; a spec é o que executa. Divergir é como se perde.
  const raiz = path.resolve(import.meta.dirname, '..', '..', '..');
  const doc = path.join(raiz, 'docs', 'sql', 'datahub-protocolos-produtividade.sql');
  const spec = path.join(raiz, 'specs', '_catalog', 'queries', 'protocolos-produtividade.spec.yaml');

  const daDoc = fs.readFileSync(doc, 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '');
  const { sql } = parseYaml(fs.readFileSync(spec, 'utf8')) as { sql: string | null };
  assert.ok(sql, 'a spec não tem campo sql:');

  assert.equal(
    sql.replace(/\r\n/g, '\n'),
    daDoc,
    'o `sql:` da spec divergiu de docs/sql/datahub-protocolos-produtividade.sql',
  );

  // As marcas do que se perdeu, nomeadas. Se o `assert.equal` acima falhar, estas
  // dizem O QUE falta — e é isso que se quer ler numa saída de teste.
  for (const marca of ['ramo_produtividade AS (', 'ramo_auxiliares AS (', 'UNION ALL', '"INSTALADOR"']) {
    assert.ok(sql.includes(marca), `o SQL perdeu \`${marca}\` — é o append dos dois ramos`);
  }
});

// ----------------------------------------------------------------- planejaBusca

const SQL_ORIGINAL = 'SELECT * FROM x WITH bruto AS (SELECT 1)';
const CAB_BOM: CabecalhoAnterior = {
  marca: '2026-08-25T00:00:00.000Z',
  completoEm: '2026-08-25T19:34:00.000Z',
  geradoEm: '2026-08-25T19:34:00.000Z',
};

test('planejaBusca: sem política é sempre completo, mesmo pedindo incremental', () => {
  const { plano, aviso } = planejaBusca(SQL_ORIGINAL, CAB_BOM, undefined, d('2026-09-01'), true);
  assert.equal(plano.modo, 'completo');
  assert.equal(plano.sql, SQL_ORIGINAL);
  assert.deepEqual(plano.params, {});
  assert.equal(plano.corte, null);
  assert.equal(aviso, null);
});

test('planejaBusca: com política mas sem --incremental, continua completo — a intenção é do operador', () => {
  const { plano, aviso } = planejaBusca(SQL_ORIGINAL, CAB_BOM, POLITICA, d('2026-09-01'), false);
  assert.equal(plano.modo, 'completo');
  assert.equal(plano.sql, SQL_ORIGINAL, 'não costura sem --incremental');
  assert.equal(aviso, null);
});

test('planejaBusca: sem arquivo anterior é sempre completo, sem aviso — é a primeira carga', () => {
  const { plano, aviso } = planejaBusca(SQL_ORIGINAL, null, POLITICA, d('2026-09-01'), true);
  assert.equal(plano.modo, 'completo');
  assert.equal(aviso, null, 'primeira carga não é uma recusa — é o estado esperado');
});

test('planejaBusca: política + --incremental + arquivo bom decide incremental de verdade', () => {
  const { plano, aviso } = planejaBusca(SQL_ORIGINAL, CAB_BOM, POLITICA, d('2026-09-01'), true);
  assert.equal(aviso, null);
  assert.equal(plano.modo, 'incremental');
  assert.ok(plano.sql.includes(':desde'), 'o SQL tem de estar costurado');
  assert.notEqual(plano.sql, SQL_ORIGINAL);
  // marca (25/08) - margemDias (2) = 23/08, e desdeDe já é testado à parte —
  // aqui o que importa é que o valor CHEGA em params sob o nome certo.
  assert.equal(plano.params.desde, '2026-08-23');
  assert.ok(plano.corte instanceof Date);
  assert.equal(plano.corte!.toISOString().slice(0, 10), '2026-08-23');
  assert.equal(plano.completoEm, CAB_BOM.completoEm, 'herda a data da última completa, não avança');
});

test('planejaBusca: idade estourada recusa e volta pra completo, com o motivo no aviso', () => {
  const cabVelho: CabecalhoAnterior = {
    marca: '2026-08-01T00:00:00.000Z',
    completoEm: '2026-08-01T00:00:00.000Z', // > 7 dias antes de 2026-09-01: teto de POLITICA
    geradoEm: '2026-08-01T00:00:00.000Z',
  };
  const { plano, aviso } = planejaBusca(SQL_ORIGINAL, cabVelho, POLITICA, d('2026-09-01'), true);
  assert.equal(plano.modo, 'completo');
  assert.equal(plano.sql, SQL_ORIGINAL);
  assert.match(aviso!, /incremental recusada/);
  assert.match(aviso!, /teto/);
});

test('planejaBusca: carga completa (com política) grava completoEm = agora, não herda', () => {
  const { plano } = planejaBusca(SQL_ORIGINAL, CAB_BOM, POLITICA, d('2026-09-01T12:00:00.000Z'), false);
  assert.equal(plano.modo, 'completo');
  assert.equal(plano.completoEm, '2026-09-01T12:00:00.000Z');
});
