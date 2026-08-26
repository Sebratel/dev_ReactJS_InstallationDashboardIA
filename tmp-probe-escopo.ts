// Probe temporário: qual escopo reproduz os números da auditoria (Visão Geral).
import path from 'node:path';
import { applyDotEnv, loadConfig } from './packages/query-engine/src/config.ts';
import { createVoallePool, postgresRunner } from './packages/query-engine/src/connectors-sql.ts';

applyDotEnv(path.resolve('.'));
const cfg = loadConfig();
const pool = await createVoallePool(cfg.voalle);
const run = postgresRunner(pool);

const FROM = `
  FROM assignment_incidents ai
  LEFT JOIN assignments a ON a.id = ai.assignment_id
  LEFT JOIN incident_types it ON it.id = ai.incident_type_id
  LEFT JOIN people p ON p.id = a.requestor_id
  LEFT JOIN schedules s ON s.assignment_id = a.id
`;
const TYPES = "('12','1014','1254','1255','1256','1136','249','268','1160','1015','279','15')";

async function conta(rotulo: string, where: string) {
  const sql = `
    WITH base AS (
      SELECT ai.protocol AS proto, p.name AS cliente, a.title AS atitle,
             ROW_NUMBER() OVER (PARTITION BY a.title ORDER BY s.start_date DESC) AS rn
      ${FROM}
      ${where}
    )
    SELECT COUNT(DISTINCT proto) AS protocolos, COUNT(DISTINCT cliente) AS clientes
    FROM base WHERE rn = 1`;
  try {
    const r = await run(sql, []);
    console.log(rotulo.padEnd(46), JSON.stringify(r[0]));
  } catch (e) {
    console.log(rotulo.padEnd(46), 'ERRO', (e as Error).message.slice(0, 140));
  }
}

console.log('ALVO auditoria: protocolos=91337 clientes=70933 (instalados=64592)\n');
await conta('A) sem filtro nenhum', '');
await conta('B) so tipos instalacao (sem ano)', `WHERE it.id IN ${TYPES}`);
await conta('C) so ano >=2026 (todos tipos)', `WHERE a.created >= '2026-01-01'`);
await conta('D) tipos + ano>=2026 (=nosso hoje)', `WHERE it.id IN ${TYPES} AND a.created >= '2026-01-01'`);
await conta('E) tipos + ano>=2025', `WHERE it.id IN ${TYPES} AND a.created >= '2025-01-01'`);

await (pool as unknown as { end?: () => Promise<void> }).end?.();
