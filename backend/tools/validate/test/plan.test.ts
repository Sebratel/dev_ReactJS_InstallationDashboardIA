import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import { assertReadOnly } from '../../../packages/query-engine/src/connectors-sql.ts';
import { EXECUTABLE_DATASOURCES, groupSkipped, planValidation } from '../src/plan.ts';
import { wrapCount, wrapSample } from '../src/profile.ts';
import type { ResolvedQuery } from '../../../packages/query-engine/src/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SPECS = path.join(ROOT, 'backend', 'specs');

function q(partial: Partial<ResolvedQuery> & { id: string }): ResolvedQuery {
  return {
    name: partial.id,
    origin: 'expression',
    source_type: 'odbc',
    datasource: 'dbVoalle',
    sql: 'select 1',
    url: null,
    source_tables: ['t'],
    cache: { ttl: 300, realtime: true },
    ...partial,
  } as ResolvedQuery;
}

test('planValidation: query pronta com datasource configurado é executável', () => {
  const plan = planValidation([q({ id: 'a' })], { configured: ['dbVoalle'] });
  assert.equal(plan.runnable.length, 1);
  assert.equal(plan.skipped.length, 0);
});

test('planValidation: datasource sem credencial é pulado, não é falha', () => {
  const plan = planValidation([q({ id: 'a' })], { configured: [] });
  assert.equal(plan.runnable.length, 0);
  assert.equal(plan.skipped[0].reason, 'datasource-nao-configurado');
});

test('planValidation: gsheets/web/inline/computed ficam fora', () => {
  const queries = [
    q({ id: 'sheet', datasource: 'gsheets', source_type: 'googlesheets', sql: null, url: 'https://x' }),
    q({ id: 'clima', datasource: 'web', source_type: 'web', sql: null, url: 'https://x' }),
    q({ id: 'feriados', datasource: 'inline', source_type: 'inline', sql: null }),
    q({ id: 'hora', datasource: 'computed', source_type: 'computed', sql: null }),
  ];
  const plan = planValidation(queries, { configured: [...EXECUTABLE_DATASOURCES] });
  assert.equal(plan.runnable.length, 0);
  assert.equal(plan.skipped.length, 4);
  for (const s of plan.skipped) assert.equal(s.reason, 'datasource-nao-suportado');
});

test('planValidation: datasource suportado mas sem SQL é pulado como sem-sql', () => {
  const plan = planValidation([q({ id: 'a', sql: null })], { configured: ['dbVoalle'] });
  assert.equal(plan.skipped[0].reason, 'sem-sql');
});

test('planValidation: --only filtra o resto', () => {
  const plan = planValidation([q({ id: 'a' }), q({ id: 'b' })], {
    configured: ['dbVoalle'],
    only: ['b'],
  });
  assert.deepEqual(plan.runnable.map((i) => i.query.id), ['b']);
  assert.equal(plan.skipped.find((s) => s.query.id === 'a')!.reason, 'filtrado');
});

test('planValidation: saída é ordenada por id (relatório estável)', () => {
  const plan = planValidation([q({ id: 'c' }), q({ id: 'a' }), q({ id: 'b' })], {
    configured: ['dbVoalle'],
  });
  assert.deepEqual(plan.runnable.map((i) => i.query.id), ['a', 'b', 'c']);
});

test('groupSkipped: agrupa por motivo', () => {
  const plan = planValidation(
    [q({ id: 'a', sql: null }), q({ id: 'b', datasource: 'gsheets', sql: null })],
    { configured: ['dbVoalle'] },
  );
  const grupos = groupSkipped(plan.skipped);
  assert.equal(grupos.get('sem-sql')!.length, 1);
  assert.equal(grupos.get('datasource-nao-suportado')!.length, 1);
});

// ------------------------------------------------------------ specs reais

test('specs reais: o plano cobre as 24 queries SQL (18 do PBIP + 2 de mão + 1 gerada + 3 planilhas)', () => {
  // 18 do PBIP + 2 de mão, registradas em docs/SPEC-DRIVEN.md: `field-agenda-slot`
  // (ACHADOS #87, o grão de slot de `field-agenda`) e `protocolos-tipo` (ACHADOS #200, o
  // par protocolo/tipo para a mesclagem de `backlog-agendado-futuro`). As duas no
  // dbVoalle: 15 → 17; dbMaria não muda.
  //
  // 20 → 23 (14/10/2026, ACHADOS #209): `quadro-funcional`, `capacidade-equipe` e
  // `apuracao-premiacao` saíram do Google Sheets para o dbMaria (DB_InstallationDashboard).
  //
  // 23 → 24 (26/10/2026): `relatos-do-dia`, gerada (`npm run gera:relatos-do-dia`), no
  // dbVoalle: 17 → 18 (docs/SPEC-DRIVEN.md).
  const registry = QueryRegistry.fromSpecsDir(SPECS);
  const plan = planValidation(registry.list(), { configured: [...EXECUTABLE_DATASOURCES] });

  assert.equal(plan.runnable.length + plan.skipped.length, registry.queries.size);
  assert.equal(plan.runnable.length, 24, 'dbVoalle + dbMaria com SQL');

  const porFonte = new Map<string, number>();
  for (const item of plan.runnable) {
    porFonte.set(item.datasource, (porFonte.get(item.datasource) ?? 0) + 1);
  }
  assert.equal(porFonte.get('dbVoalle'), 18);
  assert.equal(porFonte.get('dbMaria'), 6);
});

test('specs reais: nenhuma query executável é barrada pelo guard read-only', () => {
  const registry = QueryRegistry.fromSpecsDir(SPECS);
  const plan = planValidation(registry.list(), { configured: [...EXECUTABLE_DATASOURCES] });
  for (const { query } of plan.runnable) {
    assert.doesNotThrow(() => assertReadOnly(query.sql!), `${query.id} foi bloqueada`);
  }
});

test('specs reais: o SQL embrulhado também passa no guard read-only', () => {
  // O embrulho em subquery é o que o validate manda ao banco. Se o guard
  // barrasse a versão embrulhada, a validação falharia só com credencial na mão.
  const registry = QueryRegistry.fromSpecsDir(SPECS);
  const plan = planValidation(registry.list(), { configured: [...EXECUTABLE_DATASOURCES] });
  for (const { query } of plan.runnable) {
    assert.doesNotThrow(() => assertReadOnly(wrapCount(query.sql!)), `count de ${query.id}`);
    assert.doesNotThrow(() => assertReadOnly(wrapSample(query.sql!, 10)), `amostra de ${query.id}`);
  }
});

test('specs reais: comentário na última linha do SQL não quebra o embrulho', () => {
  const registry = QueryRegistry.fromSpecsDir(SPECS);
  const plan = planValidation(registry.list(), { configured: [...EXECUTABLE_DATASOURCES] });
  for (const { query } of plan.runnable) {
    for (const sql of [wrapCount(query.sql!), wrapSample(query.sql!, 10)]) {
      const ultimaLinha = sql.split('\n').at(-1)!;
      assert.ok(
        !/--/.test(ultimaLinha),
        `${query.id}: o fechamento da subquery caiu dentro de um comentário`,
      );
      assert.ok(sql.includes('\n) as _t'), `${query.id}: parêntese não isolado`);
    }
  }
});
