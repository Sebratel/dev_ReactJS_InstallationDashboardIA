// O conjunto do ano da Premiação e do Diário: o período é o do corte da página (a mesma
// régua do carregador), nenhum visual fica de fora, e as listas de queries e calculadas
// batem com o plano de carga das duas páginas — se alguém acrescentar uma tabela a elas,
// este teste diz de onde ela tem de vir.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { cortesDaPagina, inicioDoCorte } from '../../semantic-model/src/corte-por-pagina.ts';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import { planeja } from '../../snapshot/src/plano.ts';
import { loadDashboards } from '../../widget-engine/src/spec.ts';
import {
  CALCULADAS_DO_ANO,
  decideDoAno,
  PAGINAS_DO_ANO,
  periodoDoAno,
  QUERIES_DO_ANO,
} from '../src/instalacao-do-ano.ts';

const SPECS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'specs');
const model = SemanticModel.fromSpecsDir(SPECS);
const paginas = loadDashboards(SPECS).filter((d) => PAGINAS_DO_ANO.includes(d.id));

test('o ano é o do corte da página, no fuso do RS — inclusive na virada', () => {
  assert.equal(paginas.length, 2);
  for (const d of paginas) {
    assert.deepEqual(periodoDoAno(model, d.id, new Date('2026-10-24T15:00:00Z')), { desde: '2026-01-01', ate: '2027-01-01' });
    // 31/12 às 23:30 no RS já é 1º/01 em UTC: o ano ainda é 2026.
    assert.deepEqual(periodoDoAno(model, d.id, new Date('2027-01-01T02:30:00Z')), { desde: '2026-01-01', ate: '2027-01-01' });
    assert.deepEqual(periodoDoAno(model, d.id, new Date('2027-01-01T03:30:00Z')), { desde: '2027-01-01', ate: '2028-01-01' });
    const corte = cortesDaPagina(model.cortes, d.id)[0]!;
    const agora = new Date('2026-06-15T12:00:00Z');
    assert.equal(periodoDoAno(model, d.id, agora).desde, inicioDoCorte(corte, agora).toISOString().slice(0, 10), 'a régua do carregador');
  }
});

test('todo pedido vai pelo ano, e nenhum visual fica de fora', () => {
  for (const d of paginas) {
    const r = decideDoAno(model, d.id, new Date('2026-10-24T15:00:00Z'));
    assert.ok('periodo' in r);
    assert.equal(r.fora.size, 0);
  }
});

test('as queries do SRD e as calculadas congeladas são as do plano das duas páginas', () => {
  for (const d of paginas) {
    const plano = planeja([d], model);
    for (const q of QUERIES_DO_ANO) assert.ok(plano.queries.includes(q), `${d.id} não carrega ${q}`);
    assert.deepEqual(plano.calculadas, [...CALCULADAS_DO_ANO], `${d.id}: calculada nova precisa decidir de onde vem`);
  }
});
