// O catálogo da fonte ao vivo contra as specs de HOJE.
//
// O teste que importa é o primeiro: ele costura cada entrada de `ao-vivo.yaml` no SQL
// atual do catálogo e traduz os parâmetros como o conector faria. Se alguém mudar o SQL
// de `field-agenda-slot` ou de `protocolos-geral` e a âncora deixar de casar, quebra
// aqui — no CI —, e não em produção trazendo o conjunto inteiro como se fosse recorte.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { traduzParametros } from '../../query-engine/src/connectors-sql.ts';
import { QueryRegistry } from '../../query-engine/src/registry.ts';
import { costuraAoVivo, leCatalogoAoVivo, type ConsultaAoVivo } from '../src/catalogo.ts';

const SPECS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'specs');
const registry = QueryRegistry.fromSpecsDir(SPECS);
const catalogo = leCatalogoAoVivo(SPECS);

test('toda entrada de ao-vivo.yaml costura no SQL atual e usa exatamente os parâmetros declarados', () => {
  assert.ok(catalogo.size >= 2, `li ${catalogo.size} entrada(s) em ao-vivo.yaml`);
  for (const c of catalogo.values()) {
    const sql = registry.get(c.query).sql ?? '';
    const costurado = costuraAoVivo(sql, c);
    assert.notEqual(costurado, sql, `${c.query}: a costura não mudou nada`);
    const params = Object.fromEntries(c.parametros.map((p) => [p, 'x']));
    // Erra se faltar parâmetro no SQL ou se sobrar parâmetro sem uso — as duas pontas.
    const { values } = traduzParametros(costurado, params, (i) => `$${i}`);
    assert.ok(values.length >= c.parametros.length, `${c.query}: algum parâmetro não entrou`);
  }
});

test('a agenda é recortada pelos protocolos do período, e mantém a janela da agenda', () => {
  const c = catalogo.get('field-agenda-slot')!;
  const costurado = costuraAoVivo(registry.get('field-agenda-slot').sql ?? '', c);
  assert.match(costurado, /protocolos_do_periodo/);
  assert.match(costurado, /:desde::date/);
  assert.match(costurado, /:ate::date/);
  // A view sai do FROM: a consulta não pode voltar a passar por ela.
  assert.doesNotMatch(costurado, /FROM v_service_desk_slots_productivity_informative/);
  assert.ok(costurado.includes(c.janela!), 'a janela de 3 meses continua no filtro de fora');
});

test('os protocolos são recortados pela SOLICITAÇÃO, a partição do ROW_NUMBER', () => {
  const sql = registry.get('protocolos-geral').sql ?? '';
  assert.match(sql, /PARTITION BY a\.title/, 'a partição de PERSONA1 mudou: revise o recorte em ao-vivo.yaml');
  const costurado = costuraAoVivo(sql, catalogo.get('protocolos-geral')!);
  assert.match(costurado, /AND a\.title IN \(/);
  assert.match(costurado, /ai2\.protocol = ANY\(:protocolos::bigint\[\]\)/);
});

const BASE: ConsultaAoVivo = {
  query: 'q',
  parametros: ['desde'],
  recorte: { tipo: 'protocolos-da-lista', protocolo: 'P' },
  costura: [{ de: 'WHERE 1 = 1', para: 'WHERE x >= :desde' }],
};

test('âncora que sumiu do SQL recusa', () => {
  assert.throws(() => costuraAoVivo('SELECT 1', BASE), /aparece 0 vez/);
});

test('âncora que aparece duas vezes recusa — replace costuraria só a primeira', () => {
  assert.throws(() => costuraAoVivo('SELECT 1 WHERE 1 = 1 UNION SELECT 2 WHERE 1 = 1', BASE), /aparece 2 vez/);
});

test('costura que não cita o parâmetro recusa — traria o conjunto inteiro', () => {
  const semParametro = { ...BASE, costura: [{ de: 'WHERE 1 = 1', para: 'WHERE 2 = 2' }] };
  assert.throws(() => costuraAoVivo('SELECT 1 WHERE 1 = 1', semParametro), /não cita ':desde'/);
});

test('cast `::date` não conta como o parâmetro `:date`', () => {
  const soCast = { ...BASE, costura: [{ de: 'WHERE 1 = 1', para: "WHERE x >= '2026-01-01'::date" }], parametros: ['date'] };
  assert.throws(() => costuraAoVivo('SELECT 1 WHERE 1 = 1', soCast), /não cita ':date'/);
});

test('janela declarada que sumiu do SQL recusa', () => {
  const comJanela = { ...BASE, janela: "INTERVAL '3 months'" };
  assert.throws(() => costuraAoVivo('SELECT 1 WHERE 1 = 1', comJanela), /janela declarada/);
});

test('o texto de `para` entra literal, mesmo com $ (replace não interpreta $&)', () => {
  const comCifrao = { ...BASE, costura: [{ de: 'WHERE 1 = 1', para: "WHERE x >= :desde AND y = '$&'" }] };
  assert.equal(costuraAoVivo('SELECT 1 WHERE 1 = 1', comCifrao), "SELECT 1 WHERE x >= :desde AND y = '$&'");
});
