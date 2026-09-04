#!/usr/bin/env node
// `npm run probe:determinismo-pg` — confere se PROTOCOLOS GERAL devolve o MESMO
// resultado em duas execuções do mesmo SQL, dentro do MESMO snapshot de
// transação (REPEATABLE READ READ ONLY, para dado novo não se confundir com
// instabilidade do SQL).
//
// Existe porque o SQL de produção tinha um ROW_NUMBER() sem desempate — ver
// docs/ACHADOS.md, achado aberto "PROTOCOLOS GERAL é NÃO DETERMINÍSTICA em 10
// colunas". 14.090 de 98.110 solicitações (14,4%) mudavam de valor entre duas
// execuções idênticas. Erick decidiu o desempate em 04/09/2026: preferir
// authentication_contracts.active = true.
//
// REGRA DE SAÍDA: nunca CLIENTE, TELEFONE, RUA — só contagens e nomes de
// coluna (mesma regra de custo-incremental.ts).
//
// Uso:
//   npm run probe:determinismo-pg

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import pg from 'pg';
import yaml from 'yaml';
import { applyDotEnv, loadConfig } from '../../../packages/query-engine/src/config.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);
const cfg = loadConfig();

const spec = yaml.parse(
  fs.readFileSync(path.join(ROOT, 'specs/_catalog/queries/protocolos-geral.spec.yaml'), 'utf8'),
) as { sql: string };

// As 10 colunas que o achado provou mudarem de valor, mais a chave.
const COLUNAS_COMPARADAS = [
  'N°PROTOCOLO',
  'USUÁRIO',
  'CTO',
  'PONTO DE ACESSO',
  'CODIGO',
  'OLT',
  'EQUIPAMENTO',
  'SLOT',
  'PORTA',
  'LATITUDE',
  'LONGITUDE',
  'STATUS FINANCEIRO',
];

function assinatura(linha: Record<string, unknown>): string {
  return COLUNAS_COMPARADAS.map((c) => String(linha[c] ?? '∅')).join('|');
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

console.log(`execução 1: ${r1.rows.length} linhas em ${dt1} ms`);
console.log(`execução 2: ${r2.rows.length} linhas em ${dt2} ms`);

const porProtocolo1 = new Map(r1.rows.map((l) => [l['N°PROTOCOLO'], assinatura(l)]));
const porProtocolo2 = new Map(r2.rows.map((l) => [l['N°PROTOCOLO'], assinatura(l)]));

let soEm1 = 0;
let soEm2 = 0;
let divergentes = 0;
const divergenciasPorColuna: Record<string, number> = {};
for (const c of COLUNAS_COMPARADAS) divergenciasPorColuna[c] = 0;

for (const [proto, assin1] of porProtocolo1) {
  if (!porProtocolo2.has(proto)) {
    soEm1++;
    continue;
  }
}
for (const proto of porProtocolo2.keys()) {
  if (!porProtocolo1.has(proto)) soEm2++;
}

const linha1PorProtocolo = new Map(r1.rows.map((l) => [l['N°PROTOCOLO'], l]));
const linha2PorProtocolo = new Map(r2.rows.map((l) => [l['N°PROTOCOLO'], l]));
for (const [proto, l1] of linha1PorProtocolo) {
  const l2 = linha2PorProtocolo.get(proto);
  if (!l2) continue;
  if (assinatura(l1) !== assinatura(l2)) {
    divergentes++;
    for (const c of COLUNAS_COMPARADAS) {
      if (String(l1[c] ?? '∅') !== String(l2[c] ?? '∅')) divergenciasPorColuna[c]!++;
    }
  }
}

console.log(`só em 1: ${soEm1}    só em 2: ${soEm2}`);
if (divergentes === 0) {
  console.log('DETERMINÍSTICO: 0 solicitações mudaram de valor entre as duas execuções.');
} else {
  console.log(`NÃO DETERMINÍSTICO: ${divergentes} solicitação(ões) mudaram de valor.`);
  console.table(divergenciasPorColuna);
}
