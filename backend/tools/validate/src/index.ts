#!/usr/bin/env node
// `npm run validate:queries` — executa as queries reais do registry contra as
// fontes e grava/compara os goldens em backend/specs/golden/.
//
// É o passo que falta entre "conecta" (doctor) e "as medidas batem com o Power
// BI" (Fase 2): prova que cada query roda, quantas linhas devolve e com quais
// colunas. Sem isso a Fase 2 construiria as 78 medidas sobre dados não
// verificados.
//
// NUNCA imprime nem grava valor de linha (nome de cliente, endereço, CPF).
// Ver o cabeçalho de profile.ts.
//
// Uso:
//   npm run validate:queries                 # captura/atualiza os goldens
//   npm run validate:queries -- --check      # compara e falha se o schema mudou
//   npm run validate:queries -- --only=contratos,field-agenda
//   npm run validate:queries -- --sample-rows=20000
//   npm run validate:queries -- --include-values

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyDotEnv,
  loadConfig,
  missingFor,
} from '../../../packages/query-engine/src/config.ts';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import type { SqlRunner } from '../../../packages/query-engine/src/connectors.ts';
import { diffGolden, type Golden } from './profile.ts';
import { EXECUTABLE_DATASOURCES, groupSkipped, planValidation } from './plan.ts';
import { runQuery } from './run.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
applyDotEnv(ROOT);

const GOLDEN_DIR = path.join(ROOT, 'backend', 'specs', 'golden');

// ------------------------------------------------------------------ argumentos
interface Args {
  check: boolean;
  only: string[];
  sampleRows: number;
  includeValues: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { check: false, only: [], sampleRows: 5000, includeValues: false };
  for (const raw of argv) {
    if (raw === '--check') args.check = true;
    else if (raw === '--include-values') args.includeValues = true;
    else if (raw.startsWith('--only=')) {
      args.only = raw.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (raw.startsWith('--sample-rows=')) {
      const n = Number.parseInt(raw.slice('--sample-rows='.length), 10);
      if (Number.isFinite(n) && n > 0) args.sampleRows = n;
    } else {
      console.error(`argumento desconhecido: ${raw}`);
      process.exit(2);
    }
  }
  return args;
}

// ------------------------------------------------------------------ goldens
function goldenPath(queryId: string): string {
  return path.join(GOLDEN_DIR, `${queryId}.golden.json`);
}

function readGolden(queryId: string): Golden | null {
  const file = goldenPath(queryId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Golden;
}

function writeGolden(golden: Golden): void {
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });
  fs.writeFileSync(goldenPath(golden.queryId), `${JSON.stringify(golden, null, 2)}\n`, 'utf8');
}

// ------------------------------------------------------------------ conexões
interface Source {
  run: SqlRunner;
  close: () => Promise<void>;
}

async function openVoalle(): Promise<Source> {
  const { createVoallePool, postgresRunner } = await import(
    '../../../packages/query-engine/src/connectors-sql.ts'
  );
  const pool = await createVoallePool(loadConfig().voalle);
  return { run: postgresRunner(pool), close: () => pool.end() };
}

async function openMaria(): Promise<Source> {
  const { createMariaPool, mariaRunner } = await import(
    '../../../packages/query-engine/src/connectors-sql.ts'
  );
  const pool = await createMariaPool(loadConfig().maria);
  return { run: mariaRunner(pool), close: () => pool.end() };
}

// ------------------------------------------------------------------ main
async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log('Analytics Platform — validação de queries contra dados reais');
  console.log('(nenhuma credencial e nenhum valor de linha aparece nesta saída)\n');

  const registry = QueryRegistry.fromSpecsDir(path.join(ROOT, 'backend', 'specs'));
  const problems = registry.validate();
  if (problems.length) {
    console.log('Registry inválido — corrija antes de validar contra o banco:');
    for (const p of problems) console.log(`  - ${p}`);
    process.exit(1);
  }

  const configured = EXECUTABLE_DATASOURCES.filter((ds) =>
    ds === 'dbVoalle' ? missingFor('voalle').length === 0 : missingFor('maria').length === 0,
  );

  const plan = planValidation(registry.list(), { configured, only: args.only });

  console.log(`Queries no registry: ${registry.queries.size}`);
  console.log(`Executáveis agora:   ${plan.runnable.length}`);
  for (const [reason, items] of groupSkipped(plan.skipped)) {
    console.log(`  pulando ${String(items.length).padStart(2)} — ${reason}: ${items.map((i) => i.query.id).join(', ')}`);
  }

  if (plan.runnable.length === 0) {
    console.log('\nNada a executar. Preencha o .env (veja .env.example) e rode `npm run doctor`.');
    process.exit(missingFor('voalle').length ? 1 : 0);
  }

  const sources = new Map<string, Source>();
  const needed = new Set(plan.runnable.map((i) => i.datasource));
  try {
    if (needed.has('dbVoalle')) sources.set('dbVoalle', await openVoalle());
    if (needed.has('dbMaria')) sources.set('dbMaria', await openMaria());

    console.log('\n── Execução ───────────────────────────────────────────────────');
    let failures = 0;
    let schemaDrift = 0;
    let dataDrift = 0;
    let captured = 0;

    for (const { query, datasource } of plan.runnable) {
      const source = sources.get(datasource)!;
      const outcome = await runQuery(query, source.run, {
        sampleRows: args.sampleRows,
        includeValues: args.includeValues,
        now: () => new Date().toISOString(),
      });

      const label = query.id.padEnd(26);
      if (!outcome.ok || !outcome.golden) {
        failures++;
        console.log(`[FALHA] ${label} ${outcome.error}`);
        continue;
      }

      const g = outcome.golden;
      // "~" marca que os agregados de coluna vieram de amostra, não do total
      const amostra = g.columnsFromSample ? ` [perfil de ~${g.profiledRows}]` : '';
      const shape = `${g.rowCount ?? '?'} linhas, ${g.columns.length} colunas${amostra}`;
      const timing = `${outcome.durationMs}ms`;
      // o motivo real, não um chute: normalmente é statement_timeout no count(*)
      const note =
        g.strategy === 'direct'
          ? ` (fallback p/ execução direta — ${(outcome.fallbackFrom ?? 'motivo desconhecido').split('\n')[0].slice(0, 90)})`
          : '';

      const previous = readGolden(query.id);
      if (args.check) {
        if (!previous) {
          failures++;
          console.log(`[FALHA] ${label} sem golden gravado — rode sem --check primeiro`);
          continue;
        }
        const diffs = diffGolden(previous, g);
        const schemaDiffs = diffs.filter((d) => d.severity === 'schema');
        const dataDiffs = diffs.filter((d) => d.severity === 'data');
        if (schemaDiffs.length) {
          schemaDrift++;
          console.log(`[SCHEMA] ${label} ${shape}`);
          for (const d of schemaDiffs) console.log(`         ↳ ${d.message}`);
        } else if (dataDiffs.length) {
          dataDrift++;
          console.log(`[ dados] ${label} ${shape} — ${dataDiffs.map((d) => d.message).join('; ')}`);
        } else {
          console.log(`[  OK  ] ${label} ${shape} ${timing} — idêntico ao golden`);
        }
      } else {
        writeGolden(g);
        captured++;
        const change = previous
          ? diffGolden(previous, g).filter((d) => d.severity === 'schema').length
            ? ' ⚠ schema mudou'
            : ''
          : ' (novo)';
        console.log(`[  OK  ] ${label} ${shape} ${timing}${note}${change}`);
      }
    }

    console.log('\n──────────────────────────────────────────────────────────────');
    if (args.check) {
      console.log(`${plan.runnable.length} queries verificadas — ${schemaDrift} com mudança de schema, ${dataDrift} só com dados novos, ${failures} falhas.`);
      if (schemaDrift) {
        console.log('\nMudança de schema é regressão: quebra qualquer medida construída');
        console.log('sobre essas colunas. Investigue antes de seguir.');
      }
      process.exit(failures + schemaDrift === 0 ? 0 : 1);
    } else {
      console.log(`${captured} goldens gravados em backend/specs/golden/, ${failures} falhas.`);
      if (failures === 0) {
        console.log('\nConfira os rowCount acima contra os números do Power BI. Batendo,');
        console.log('commite os goldens — eles passam a ser a linha de base da Fase 2.');
      }
      process.exit(failures === 0 ? 0 : 1);
    }
  } finally {
    for (const source of sources.values()) await source.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error('validate falhou:', err);
  process.exit(1);
});
