#!/usr/bin/env node
// `npm run probe:determinismo-pg` — a MESMA consulta, duas vezes, dentro do MESMO
// snapshot de transação: ela devolve o mesmo valor?
//
// **Por que dentro de uma transação.** `REPEATABLE READ READ ONLY` congela o estado
// do banco entre as duas execuções. Sem isso, dado novo entrando no meio se
// confundiria com instabilidade do SQL, e as duas causas pedem conserto oposto —
// uma é a vida do banco, a outra é um `ROW_NUMBER()` decidindo no cara ou coroa.
//
// **O defeito que ele existe para achar.** `ROW_NUMBER() OVER (PARTITION BY x ORDER
// BY y DESC)` com `y` empatado: os `LEFT JOIN` de `authentication_*` multiplicam a
// partição (um contrato de autenticação tem várias portas de splitter, uma
// assignment tem vários schedules, um cliente tem vários endereços), e quando o
// critério de ordem empata, o PostgreSQL escolhe **uma qualquer** — outra a cada
// execução. O `WHERE PERSONA1 = 1` então guarda uma linha diferente, e colunas como
// LATITUDE, CTO, OLT e PONTO DE ACESSO mudam de valor sozinhas, sem ninguém tocar em
// nada.
//
// Achado em `protocolos-geral` (14.090 de 98.110 solicitações, 14,4%) e decidido por
// Erick em 04/09/2026; o desempate está no `sql:` dela e em
// `docs/ACHADOS.md`. As IRMÃS nunca foram medidas — daí este probe ter deixado de
// ser específico de uma query.
//
// REGRA DE SAÍDA: nunca CLIENTE, TELEFONE, RUA — só contagens e nomes de coluna.
//
// Uso:
//   npm run probe:determinismo-pg
//   npm run probe:determinismo-pg -- --query=protocolos-telefonia --chave=SOLICITACAO
//   npm run probe:determinismo-pg -- --query=protocolos-auxiliares

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import pg from 'pg';
import yaml from 'yaml';
import { applyDotEnv, loadConfig } from '../../../packages/query-engine/src/config.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
applyDotEnv(ROOT);
const cfg = loadConfig();

let queryId = 'protocolos-geral';
let chave = 'N°PROTOCOLO';
for (const raw of process.argv.slice(2)) {
  if (raw.startsWith('--query=')) queryId = raw.slice('--query='.length);
  else if (raw.startsWith('--chave=')) chave = raw.slice('--chave='.length);
  else {
    console.error(`argumento desconhecido: ${raw}`);
    process.exit(2);
  }
}

const arquivo = path.join(ROOT, 'backend/specs/_catalog/queries', `${queryId}.spec.yaml`);
if (!fs.existsSync(arquivo)) {
  console.error(`não achei ${path.relative(ROOT, arquivo)}`);
  process.exit(2);
}
const spec = yaml.parse(fs.readFileSync(arquivo, 'utf8')) as { sql?: string; datasource?: string };
if (!spec.sql) {
  console.error(`${queryId} não tem \`sql:\` — nada a medir aqui.`);
  process.exit(2);
}
if (spec.datasource !== 'dbVoalle') {
  console.error(`${queryId} é '${spec.datasource}', e este probe fala PostgreSQL.`);
  process.exit(2);
}

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

const t1 = Date.now();
const r1 = await client.query(spec.sql);
const dt1 = Date.now() - t1;

const t2 = Date.now();
const r2 = await client.query(spec.sql);
const dt2 = Date.now() - t2;

await client.query('COMMIT');
await client.end();

console.log('');
console.log(`${queryId} — chave '${chave}'`);
console.log(`  execução 1: ${r1.rows.length.toLocaleString('pt-BR')} linhas em ${dt1} ms`);
console.log(`  execução 2: ${r2.rows.length.toLocaleString('pt-BR')} linhas em ${dt2} ms`);

// TODAS as colunas, não uma lista escrita à mão: a versão anterior deste arquivo
// comparava dez colunas nomeadas, e uma coluna nova nasceria fora da vigilância sem
// que ninguém notasse. O que se quer saber é se a consulta é estável, não se dez
// colunas escolhidas em 2026 continuam estáveis.
const colunas = r1.fields.map((f) => f.name).filter((c) => c !== chave);
if (!r1.fields.some((f) => f.name === chave)) {
  console.error(`\na chave '${chave}' não é coluna desta consulta. As colunas são:\n  ${r1.fields.map((f) => f.name).join(', ')}`);
  process.exit(2);
}

const texto = (v: unknown): string => (v === null || v === undefined ? '\u0000' : String(v));
const porChave = (linhas: readonly Record<string, unknown>[]): Map<string, Record<string, unknown>> =>
  new Map(linhas.map((l) => [texto(l[chave]), l]));

const m1 = porChave(r1.rows);
const m2 = porChave(r2.rows);

let soEm1 = 0;
for (const k of m1.keys()) if (!m2.has(k)) soEm1++;
let soEm2 = 0;
for (const k of m2.keys()) if (!m1.has(k)) soEm2++;

let divergentes = 0;
const porColuna = new Map<string, number>();
let comuns = 0;
for (const [k, l1] of m1) {
  const l2 = m2.get(k);
  if (!l2) continue;
  comuns++;
  let mudou = false;
  for (const c of colunas) {
    if (texto(l1[c]) !== texto(l2[c])) {
      porColuna.set(c, (porColuna.get(c) ?? 0) + 1);
      mudou = true;
    }
  }
  if (mudou) divergentes++;
}

console.log(`  chaves em comum: ${comuns.toLocaleString('pt-BR')}   só em 1: ${soEm1}   só em 2: ${soEm2}`);
console.log('');
if (divergentes === 0) {
  console.log(`  ✅ DETERMINÍSTICA: nenhuma das ${colunas.length} colunas mudou de valor entre as duas execuções.`);
  process.exit(0);
}
console.log(
  `  ❌ NÃO DETERMINÍSTICA: ${divergentes.toLocaleString('pt-BR')} de ${comuns.toLocaleString('pt-BR')} chave(s) ` +
    `(${((divergentes / comuns) * 100).toFixed(1)}%) mudaram de valor sem nada mudar no banco.`,
);
console.log('');
for (const [c, n] of [...porColuna.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`     ${c.padEnd(28)} ${String(n).padStart(8)} de ${comuns}  ${((n / comuns) * 100).toFixed(1).padStart(5)}%`);
}
console.log('');
console.log('  Causa quase certa: o ORDER BY do ROW_NUMBER() empata, e o PostgreSQL desempata sozinho.');
process.exit(1);
