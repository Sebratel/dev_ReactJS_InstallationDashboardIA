#!/usr/bin/env node
// `npm run probe:paridade-divisao` — a `protocolos-geral` dividida por `a.created` dá
// EXATAMENTE as linhas da consulta inteira?
//
// **Por que a pergunta é de SQL, e não de M.** O plano (handoff de 16/10/2026, item 2)
// junta o histórico e a parte recente ANTES do M. Então o M recebe a mesma entrada se, e
// só se, `histórico ∪ recente` for o mesmo multiconjunto de linhas que a consulta
// inteira — e é isso que esta sonda mede, dentro do banco, sem trazer linha nenhuma.
//
// **O que pode quebrar.** `ROW_NUMBER() OVER (PARTITION BY a.title …)`: se um mesmo
// `a.title` tiver atribuições dos dois lados do corte, cada metade escolhe a sua
// vencedora e a solicitação sai duas vezes (ou com outra linha). A sonda conta essas
// solicitações à parte, para a diferença ter nome quando aparecer.
//
// **Uma instrução só, numa transação `REPEATABLE READ READ ONLY`**: as três consultas
// enxergam o mesmo estado do banco, então dado novo entrando no meio não se confunde
// com diferença da divisão.
//
// REGRA DE SAÍDA: só contagens. Nunca valor de linha.
//
// Uso:
//   npm run probe:paridade-divisao
//   npm run probe:paridade-divisao -- --corte=2026-07-01 --env=<pasta com o .env>

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import yaml from 'yaml';
import { applyDotEnv, loadConfig } from '../../../packages/query-engine/src/config.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

let corte: string | null = null;
let envDir = ROOT;
for (const raw of process.argv.slice(2)) {
  if (raw.startsWith('--corte=')) corte = raw.slice('--corte='.length);
  else if (raw.startsWith('--env=')) envDir = path.resolve(raw.slice('--env='.length));
  else {
    console.error(`argumento desconhecido: ${raw}`);
    process.exit(2);
  }
}
applyDotEnv(envDir);
const cfg = loadConfig();

/** O 1º dia do mês de 3 meses antes do corrente — o corte proposto no handoff. */
function cortePadrao(hoje = new Date()): string {
  const d = new Date(hoje.getFullYear(), hoje.getMonth() - 3, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
corte ??= cortePadrao();
if (!/^\d{4}-\d{2}-\d{2}$/.test(corte)) {
  console.error(`--corte tem de ser AAAA-MM-DD, veio '${corte}'.`);
  process.exit(2);
}

const spec = yaml.parse(
  fs.readFileSync(path.join(ROOT, 'backend/specs/_catalog/queries/protocolos-geral.spec.yaml'), 'utf8'),
) as { sql: string };
const PISO = "a.created >= '2025-01-01'";
const sql = spec.sql.trim().replace(/;\s*$/, '');
if (sql.split(PISO).length !== 2) {
  console.error(`o \`sql:\` da protocolos-geral não tem exatamente um "${PISO}" — a costura mudou.`);
  process.exit(2);
}
const comCorte = (op: '<' | '>='): string => sql.replace(PISO, `${PISO} AND a.created ${op} '${corte}'`);

const consulta = `
WITH inteira AS MATERIALIZED (${sql}),
     historico AS MATERIALIZED (${comCorte('<')}),
     recente AS MATERIALIZED (${comCorte('>=')}),
     dividida AS (SELECT * FROM historico UNION ALL SELECT * FROM recente)
SELECT
  (SELECT count(*) FROM inteira) AS inteira,
  (SELECT count(*) FROM historico) AS historico,
  (SELECT count(*) FROM recente) AS recente,
  (SELECT count(*) FROM (SELECT * FROM inteira EXCEPT ALL SELECT * FROM dividida) x) AS so_na_inteira,
  (SELECT count(*) FROM (SELECT * FROM dividida EXCEPT ALL SELECT * FROM inteira) x) AS so_na_dividida,
  (SELECT count(*) FROM (
     SELECT a.title FROM assignment_incidents ai
     JOIN assignments a ON a.id = ai.assignment_id
     WHERE ai.incident_type_id IN ('12', '1014', '1254', '1255', '1256', '1136', '249', '268', '1160', '1015', '279', '15')
       AND ${PISO}
     GROUP BY a.title
     HAVING min(a.created) < '${corte}' AND max(a.created) >= '${corte}'
   ) x) AS titulos_dos_dois_lados,
  (SELECT count(*) FROM (SELECT "SOLICITACAO" FROM dividida GROUP BY 1 HAVING count(*) > 1) x) AS solicitacoes_repetidas_na_dividida,
  (SELECT count(*) FROM (SELECT "SOLICITACAO" FROM inteira GROUP BY 1 HAVING count(*) > 1) x) AS solicitacoes_repetidas_na_inteira
`;

const client = new pg.Client({
  host: cfg.voalle.host,
  port: cfg.voalle.port,
  database: cfg.voalle.database,
  user: cfg.voalle.user,
  password: cfg.voalle.password,
  ssl: cfg.voalle.ssl,
  statement_timeout: 0,
});
await client.connect();
if (cfg.voalle.schema) await client.query(`SET search_path TO ${cfg.voalle.schema}`);
await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
const t0 = Date.now();
const r = await client.query(consulta);
const ms = Date.now() - t0;
await client.query('COMMIT');
await client.end();

const n = (v: unknown): string => Number(v).toLocaleString('pt-BR');
const l = r.rows[0] as Record<string, unknown>;
console.log(`\nprotocolos-geral dividida em ${corte} (${n(ms)} ms, uma transação)`);
for (const [k, v] of Object.entries(l)) console.log(`  ${k.padEnd(36, '.')} ${n(v).padStart(8)}`);
const igual = Number(l.so_na_inteira) === 0 && Number(l.so_na_dividida) === 0;
console.log(igual ? '\nIGUAL: histórico ∪ recente = inteira, linha a linha.' : '\nDIFERENTE: ver as contagens acima.');
process.exit(igual ? 0 : 1);
