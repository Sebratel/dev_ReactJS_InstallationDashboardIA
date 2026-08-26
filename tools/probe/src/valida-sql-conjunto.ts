#!/usr/bin/env node
// `npm run probe:sql-conjunto` — roda o SQL do conjunto do Data Hub contra o
// dbVoalle e confere que ele bate com a query que pretende substituir.
//
// **Por que existe.** O SQL de `docs/sql/datahub-protocolos-produtividade.sql`
// reproduz, em uma consulta, 59 passos de camada M. Entregar isso sem rodar seria
// entregar uma hipótese: erro de sintaxe é o menor dos riscos — o risco real é
// contagem diferente por causa de um join que multiplica linha ou de um filtro na
// ordem errada, e isso não aparece lendo.
//
// REGRA DE SAÍDA: contagem, nome de coluna e tempo. Nunca valor de linha —
// `CLIENTE` e `TELEFONE` são dado de cliente.
//
// Uso:
//   npm run probe:sql-conjunto              # conta, mede e lista colunas
//   npm run probe:sql-conjunto -- --amostra # + cardinalidade por coluna

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { applyDotEnv, loadConfig } from '../../../packages/query-engine/src/config.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);
const cfg = loadConfig();

const ARQUIVO = path.join(ROOT, 'docs', 'sql', 'datahub-protocolos-produtividade.sql');
const sql = fs.readFileSync(ARQUIVO, 'utf8').replace(/;\s*$/, '');
const comAmostra = process.argv.includes('--amostra');

const pool = new pg.Pool({
  host: cfg.voalle.host,
  port: cfg.voalle.port,
  database: cfg.voalle.database,
  user: cfg.voalle.user,
  password: cfg.voalle.password,
  ssl: cfg.voalle.ssl,
  max: 1,
  statement_timeout: 600_000,
});

const cliente = await pool.connect();
// A mesma trava das outras ferramentas: a sessão não escreve nem por acidente.
await cliente.query(`SET search_path TO ${cfg.voalle.schema}, public`);
await cliente.query('SET default_transaction_read_only = on');

console.log(`SQL: ${path.relative(ROOT, ARQUIVO)}  (${sql.split('\n').length} linhas)`);
console.log(`banco: ${cfg.voalle.database} schema=${cfg.voalle.schema} (somente leitura)\n`);

try {
  const t0 = process.hrtime.bigint();
  const r = await cliente.query(`SELECT * FROM (${sql}) AS q`);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  console.log(`── rodou: ${r.rowCount.toLocaleString('pt-BR')} linhas, ${r.fields.length} colunas, ${(ms / 1000).toFixed(1)} s ──\n`);

  console.log('colunas devolvidas:');
  console.log('  ' + r.fields.map((f) => f.name).join(' | '));

  // As 48 físicas que o modelo declara, menos GESTOR (que fica na camada M).
  const esperadas = [
    'SOLICITACAO','N°PROTOCOLO','DATA AGENDA','DATA CRIADO','DATA ENCERRADO','STATUS',
    'CIDADE','BAIRRO','RUA','NUMERO PATRIMÔNIO','TELEFONE','CLIENTE','EQUIPE','LATITUDE',
    'LONGITUDE','RESPONSÁVEL','TIPO DE PROTOCOLO','PONTO DE ACESSO','POP','VLAN','SLOT',
    'PORTA','CTO','STATUS CONTRATO','ESTAGIO CONTRATO','NUMERO CONTRATO','ITEM','CONTEXTO',
    'PROBLEMA','OLT','EQUIPAMENTO','USUÁRIO','CRIADO POR','STATUS FINANCEIRO','HORA CRIADO',
    'SIGLA CIDADE','INDICE 2','HORA AGENDA','DATA ALOCAÇÃO','TÉCNICO INSTALAÇÃO','POSIÇÃO',
    'HR. ALOCAÇÃO','TÉCNICO TROCA','DATA DA TROCA','INSTALADOR','DATA FINAL',
    'TECNICOS AUXILIARES.AUXILIAR',
  ];
  const veio = new Set(r.fields.map((f) => f.name));
  const faltam = esperadas.filter((c) => !veio.has(c));
  const sobram = [...veio].filter((c) => !esperadas.includes(c));

  console.log(`\n── cobertura: ${esperadas.length - faltam.length}/${esperadas.length} ──`);
  console.log(`  faltando: ${faltam.join(', ') || '(nenhuma)'}`);
  console.log(`  sobrando: ${sobram.join(', ') || '(nenhuma)'}`);

  if (comAmostra) {
    // Cardinalidade: coluna com 1 valor distinto é o sintoma exato do que
    // aconteceu em `protocolos-geral` com o connector antigo.
    console.log('\n── cardinalidade (coluna com 1 valor é o alarme) ──');
    for (const f of r.fields) {
      const vals = new Set<string>();
      let nulos = 0;
      for (const linha of r.rows) {
        const v = (linha as Record<string, unknown>)[f.name];
        if (v === null || v === undefined) { nulos++; continue; }
        if (vals.size <= 60) vals.add(String(v));
      }
      const marca = vals.size === 1 ? '  ← CONSTANTE' : nulos === r.rowCount ? '  ← TUDO NULO' : '';
      console.log(`  ${f.name} | distintos ${vals.size > 60 ? '>60' : vals.size} | nulos ${nulos}${marca}`);
    }
  }

  console.log(`\nReferência: a camada M produz 69.062 linhas finais (ACHADOS #76).`);
} catch (err) {
  console.error(`\nFALHOU: ${err instanceof Error ? err.message : String(err)}`);
  if (err && typeof err === 'object' && 'position' in err) {
    const pos = Number((err as { position: string }).position);
    if (Number.isFinite(pos)) {
      console.error(`  posição ${pos}: …${sql.slice(Math.max(0, pos - 120), pos + 120)}…`);
    }
  }
  process.exitCode = 1;
} finally {
  cliente.release();
  await pool.end();
}
