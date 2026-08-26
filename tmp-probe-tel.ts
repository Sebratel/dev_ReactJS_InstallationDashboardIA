import path from 'node:path';
import { applyDotEnv, loadConfig } from './packages/query-engine/src/config.ts';
import { createVoallePool, postgresRunner } from './packages/query-engine/src/connectors-sql.ts';
applyDotEnv(path.resolve('.'));
const pool = await createVoallePool(loadConfig().voalle);
const run = postgresRunner(pool);
const FROM = `FROM assignment_incidents ai
  LEFT JOIN assignments a ON a.id=ai.assignment_id
  LEFT JOIN schedules s ON s.assignment_id=a.id
  LEFT JOIN incident_types it ON it.id=ai.incident_type_id
  LEFT JOIN people p ON p.id=a.requestor_id`;
const TYPES = "('1011','275','269')";
async function c(rot: string, where: string) {
  const sql = `WITH b AS (SELECT ai.protocol proto, p.name cli,
      ROW_NUMBER() OVER (PARTITION BY a.title ORDER BY s.start_date DESC) rn ${FROM} ${where})
    SELECT COUNT(DISTINCT proto) protocolos, COUNT(DISTINCT cli) clientes FROM b WHERE rn=1`;
  try { const r = await run(sql, []); console.log(rot.padEnd(34), JSON.stringify(r[0])); }
  catch(e){ console.log(rot.padEnd(34),'ERRO',(e as Error).message.slice(0,120)); }
}
console.log('ALVO Telefonia: protocolos=1990 clientes=1563\n');
await c('tipos + 2026 (nosso hoje)', `WHERE it.id IN ${TYPES} AND a.created >= '2026-01-01'`);
await c('tipos + 2025', `WHERE it.id IN ${TYPES} AND a.created >= '2025-01-01'`);
await c('tipos + sem ano', `WHERE it.id IN ${TYPES}`);
await (pool as unknown as {end?:()=>Promise<void>}).end?.();
