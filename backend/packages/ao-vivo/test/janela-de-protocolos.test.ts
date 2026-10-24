// O conjunto da janela das páginas de protocolos: a janela é a das specs (desde o início
// do ano anterior), nenhuma página dele tem corte (senão as calculadas recalculadas
// diferem das congeladas, ACHADOS #205), e toda query buscada é usada por alguma página.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { QueryRegistry } from '../../query-engine/src/registry.ts';
import { cortesDaPagina } from '../../semantic-model/src/corte-por-pagina.ts';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import { planeja } from '../../snapshot/src/plano.ts';
import { loadDashboards } from '../../widget-engine/src/spec.ts';
import { decideDaJanela, PAGINAS_DA_JANELA, periodoDaJanela, QUERIES_DA_JANELA } from '../src/janela-de-protocolos.ts';
import { PAGINAS_DO_ANO } from '../src/instalacao-do-ano.ts';

const SPECS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'specs');
const model = SemanticModel.fromSpecsDir(SPECS);
const paginas = loadDashboards(SPECS).filter((d) => PAGINAS_DA_JANELA.includes(d.id));

test('a janela vai do início do ano anterior ao início do próximo, no fuso do RS', () => {
  assert.deepEqual(periodoDaJanela(new Date('2026-10-24T15:00:00Z')), { desde: '2025-01-01', ate: '2027-01-01' });
  assert.deepEqual(periodoDaJanela(new Date('2027-01-01T02:30:00Z')), { desde: '2025-01-01', ate: '2027-01-01' }, '31/12 23:30 no RS');
  assert.deepEqual(periodoDaJanela(new Date('2027-01-01T03:30:00Z')), { desde: '2026-01-01', ate: '2028-01-01' });
});

test('é o mesmo piso das specs: a PG do catálogo começa no início do ano anterior', () => {
  const sql = QueryRegistry.fromSpecsDir(SPECS).get('protocolos-geral').sql ?? '';
  assert.ok(sql.includes("a.created >= (DATE_TRUNC('year', CURRENT_DATE) - INTERVAL '1 year')"), 'o piso da PG mudou: revise a janela');
});

test('nenhuma página da janela tem corte, nem está também no conjunto do ano', () => {
  assert.equal(paginas.length, PAGINAS_DA_JANELA.length, 'toda página da lista existe');
  for (const d of paginas) {
    assert.deepEqual(cortesDaPagina(model.cortes, d.id), [], `${d.id} tem corte: as calculadas recalculadas não valeriam`);
    assert.ok(!PAGINAS_DO_ANO.includes(d.id), `${d.id} em dois conjuntos`);
  }
});

test('toda query buscada é usada, e a agenda vem no grão de slot', () => {
  const usadas = new Set(paginas.flatMap((d) => planeja([d], model).queries));
  for (const q of QUERIES_DA_JANELA.filter((q) => q !== 'field-agenda-slot')) assert.ok(usadas.has(q), `${q} buscada e não usada`);
  assert.ok(usadas.has('field-agenda'), 'nenhuma página da janela usa a agenda: tire field-agenda-slot da busca');
  assert.ok(QUERIES_DA_JANELA.includes('field-agenda-slot') && !QUERIES_DA_JANELA.includes('field-agenda'));
});

test('visuais que citam o grão relato ficam fora; o resto da página vai ao vivo', () => {
  for (const d of paginas) {
    const r = decideDaJanela(d, model, new Date('2026-10-24T15:00:00Z'));
    assert.ok('periodo' in r);
    for (const motivo of r.fora.values()) assert.match(motivo, /grão relato|horizonte/);
    assert.ok(r.fora.size < (d.visuals ?? []).length, `${d.id}: nada iria ao vivo`);
  }
});
