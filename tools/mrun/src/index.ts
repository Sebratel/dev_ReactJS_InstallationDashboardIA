#!/usr/bin/env node
// `npm run run:mlayer` — roda a camada M contra as fontes REAIS.
//
// É o ponto onde as três peças se encontram: o Query Registry diz qual query
// existe, o Query Engine busca as linhas (com cache, timeout e read-only), e o
// Transform Engine executa os passos de Power Query. Até aqui o runner de M só
// tinha rodado com linhas sintéticas; isto é a primeira execução com dado de
// verdade, e é o começo da paridade da Fase 2b.9.
//
// REGRA DE SAÍDA: nunca imprime valor de linha. Só id, contagem, nome de coluna e
// tempo. `QUADRO FUNCIONAL` tem CPF e RG, e `field-agenda` tem endereço de
// cliente — a saída daqui precisa ser segura para colar em ticket.
//
// Uso:
//   npm run run:mlayer -- --only=capacidade-equipe
//   npm run run:mlayer -- --all
//   npm run run:mlayer -- --all --force-grandes
//   npm run run:mlayer -- --only=protocolos-geral --colunas

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { MemoryCache } from '../../../packages/query-engine/src/cache-memory.ts';
import {
  applyDotEnv,
  loadConfig,
  missingFor,
} from '../../../packages/query-engine/src/config.ts';
import {
  createMariaConnector,
  createMariaPool,
  createVoalleConnector,
  createVoallePool,
} from '../../../packages/query-engine/src/connectors-sql.ts';
import {
  GoogleSheetsConnector,
  tokenComCache,
} from '../../../packages/query-engine/src/connectors-gsheets.ts';
import { QueryEngine } from '../../../packages/query-engine/src/engine.ts';
import {
  accessToken,
  readServiceAccount,
  SCOPE_SHEETS_READONLY,
} from '../../../packages/query-engine/src/google-auth.ts';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import type { Connector } from '../../../packages/query-engine/src/types.ts';
import { fonteDoEngine } from '../../../packages/transform-engine/src/fonte.ts';
import { runQueries, usaFonteExterna } from '../../../packages/transform-engine/src/runner.ts';
import { rowCountComparable, scanM } from '../../../tools/validate/src/mlayer.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);

/**
 * Acima disto a query não roda sem `--force-grandes`.
 *
 * Não é limite de banco: é limite de memória **deste** processo. O avaliador de M
 * mantém a tabela inteira em memória a cada passo, como o Power Query faz, e
 * `field-agenda` tem 1,4 milhão de linhas × 19 colunas. Recusar dizendo o número
 * é melhor que morrer com "heap out of memory" no meio da carga.
 */
const LIMITE_DE_LINHAS = 200_000;

// ------------------------------------------------------------------ argumentos
interface Args {
  only: string[];
  all: boolean;
  forcaGrandes: boolean;
  colunas: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { only: [], all: false, forcaGrandes: false, colunas: false };
  for (const raw of argv) {
    if (raw === '--all') args.all = true;
    else if (raw === '--force-grandes') args.forcaGrandes = true;
    else if (raw === '--colunas') args.colunas = true;
    else if (raw.startsWith('--only=')) {
      args.only = raw.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      console.error(`argumento desconhecido: ${raw}`);
      process.exit(2);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.all && args.only.length === 0) {
  console.error(
    'Escolha o que rodar: --only=id1,id2 ou --all.\n' +
      'Não há default de propósito: --all puxa a base inteira das fontes reais.',
  );
  process.exit(2);
}

// ------------------------------------------------------------------ registry
const registry = QueryRegistry.fromSpecsDir(path.join(ROOT, 'specs'));
const cfg = loadConfig();

/** Culture do modelo. Sem ela, todo passo texto→data erra alto — e deve errar. */
const culture = (
  yaml.parse(
    fs.readFileSync(path.join(ROOT, 'specs', '_catalog', 'model.yaml'), 'utf8'),
  ) as { culture?: string | null }
).culture ?? null;

/**
 * `clima-tempo` fica fora: define função dentro de `let` e lê `Web.Contents`, que
 * não tem connector. É a mesma exclusão do teste de corpus (ACHADOS #16).
 */
const FORA_DO_ESCOPO = new Set(['clima-tempo']);

const todas = registry.list().filter((q) => q.m_expression && !FORA_DO_ESCOPO.has(q.id));
const pedidas = args.all ? todas : todas.filter((q) => args.only.includes(q.id));

const idsInvalidos = args.only.filter((id) => !todas.some((q) => q.id === id));
if (idsInvalidos.length) {
  console.error(`ids que não existem (ou estão fora do escopo): ${idsInvalidos.join(', ')}`);
  process.exit(2);
}

// --------------------------------------------- linhas conhecidas pelo golden
/** rowCount do SQL, gravado pelo `npm run validate:queries`. */
function linhasDoGolden(id: string): number | null {
  const p = path.join(ROOT, 'specs', 'golden', `${id}.golden.json`);
  if (!fs.existsSync(p)) return null;
  return (JSON.parse(fs.readFileSync(p, 'utf8')) as { rowCount?: number }).rowCount ?? null;
}

const grandes = pedidas.filter((q) => (linhasDoGolden(q.id) ?? 0) > LIMITE_DE_LINHAS);
if (grandes.length && !args.forcaGrandes) {
  console.error('Estas queries passam do limite deste processo:\n');
  for (const q of grandes) {
    console.error(`  ${q.id}: ${linhasDoGolden(q.id)!.toLocaleString('pt-BR')} linhas no SQL`);
  }
  console.error(
    `\nO avaliador de M guarda a tabela inteira em memória por passo (limite: ` +
      `${LIMITE_DE_LINHAS.toLocaleString('pt-BR')}).\n` +
      'Para tentar de todo modo: --force-grandes (considere ' +
      'NODE_OPTIONS=--max-old-space-size=8192).',
  );
  process.exit(2);
}

// ---------------------------------------------------------------- connectors
const connectors = new Map<string, Connector>();
const fechar: (() => Promise<void>)[] = [];
const precisa = new Set(pedidas.map((q) => q.datasource).filter((d): d is string => Boolean(d)));

/** Monta só o que as queries pedidas usam: sem gsheets não precisa de credencial Google. */
async function montaConnectors(): Promise<string[]> {
  const problemas: string[] = [];

  if (precisa.has('dbVoalle')) {
    const falta = missingFor('voalle');
    if (falta.length) problemas.push(`dbVoalle: falta no .env ${falta.join(', ')}`);
    else {
      const pool = await createVoallePool(cfg.voalle);
      connectors.set('dbVoalle', createVoalleConnector(pool));
      fechar.push(() => pool.end());
    }
  }
  if (precisa.has('dbMaria')) {
    const falta = missingFor('maria');
    if (falta.length) problemas.push(`dbMaria: falta no .env ${falta.join(', ')}`);
    else {
      const pool = await createMariaPool(cfg.maria);
      connectors.set('dbMaria', createMariaConnector(pool));
      fechar.push(() => pool.end());
    }
  }
  if (precisa.has('gsheets')) {
    try {
      const sa = readServiceAccount(cfg.gsheets.credentialsPath);
      connectors.set(
        'gsheets',
        new GoogleSheetsConnector({
          token: tokenComCache(() => accessToken(sa, [SCOPE_SHEETS_READONLY])),
          contaDeServico: sa.client_email,
        }),
      );
    } catch (err) {
      problemas.push(`gsheets: ${err instanceof Error ? err.message : err}`);
    }
  }
  return problemas;
}

const problemas = await montaConnectors();
for (const p of problemas) console.log(`  aviso: ${p}`);

const engine = new QueryEngine({
  registry,
  connectors,
  // Cache em memória: um processo, uma passada. Redis aqui só adicionaria uma
  // dependência para um cache que morre no fim do comando.
  cache: new MemoryCache(),
});

// ------------------------------------------------------------------ execução
console.log(
  `\nRodando ${pedidas.length} query(s) com culture=${culture ?? '(nenhuma)'}; ` +
    `fontes: ${[...precisa].sort().join(', ')}\n`,
);

const buscas = new Map<string, number>();
const fonte = fonteDoEngine(engine, {
  onBusca: (e) => {
    if (e.linhas !== undefined) buscas.set(e.id, e.linhas);
  },
});

interface Resultado {
  id: string;
  ok: boolean;
  linhasDaFonte: number | null;
  linhasFinais: number | null;
  colunas: string[];
  passos: number;
  ms: number;
  erro?: string;
  /** Divergência de contagem que o M **não** explica. */
  alerta?: string;
}

const resultados: Resultado[] = [];

for (const q of pedidas) {
  const inicio = Date.now();
  try {
    // Uma query por vez, com o fechamento das dependências dela. Rodar tudo de uma
    // vez seria mais rápido, e um erro no meio derrubaria o relatório inteiro.
    const feitas = await runQueries({
      specs: todas,
      apenas: [q.id],
      culture,
      fonte,
    });
    const r = feitas.get(q.id)!;
    const daFonte = usaFonteExterna(q.m_expression!) ? (buscas.get(q.id) ?? null) : null;

    // Paridade barata: quando nenhum passo M mexe em linha, a contagem final tem
    // que ser exatamente a da fonte. Divergência aí é bug do engine, não do M.
    let alerta: string | undefined;
    try {
      const scan = scanM(q.m_expression!);
      if (rowCountComparable(scan) && daFonte !== null && daFonte !== r.tabela.rowCount) {
        alerta = `nenhum passo M mexe em linha, mas ${daFonte} da fonte viraram ${r.tabela.rowCount}`;
      }
    } catch {
      // Query que o scanner estático não lê (função dentro de `let`). Não é falha
      // desta execução — e o `--all` não deve parar por causa disso.
    }

    resultados.push({
      id: q.id,
      ok: true,
      linhasDaFonte: daFonte,
      linhasFinais: r.tabela.rowCount,
      colunas: [...r.tabela.columns],
      passos: r.passos.size,
      ms: Date.now() - inicio,
      alerta,
    });
  } catch (err) {
    resultados.push({
      id: q.id,
      ok: false,
      linhasDaFonte: buscas.get(q.id) ?? null,
      linhasFinais: null,
      colunas: [],
      passos: 0,
      ms: Date.now() - inicio,
      erro: err instanceof Error ? err.message : String(err),
    });
  }
}

for (const f of fechar) await f().catch(() => {});

// ------------------------------------------------------------------ relatório
const n = (v: number | null): string => (v === null ? '-' : v.toLocaleString('pt-BR'));

console.log('id'.padEnd(28) + 'fonte'.padStart(12) + 'final'.padStart(12) +
  'cols'.padStart(6) + 'passos'.padStart(8) + 'ms'.padStart(9));
console.log('-'.repeat(75));
for (const r of resultados) {
  const marca = r.ok ? ' ' : '✖';
  console.log(
    `${marca}${r.id.padEnd(27)}${n(r.linhasDaFonte).padStart(12)}` +
      `${n(r.linhasFinais).padStart(12)}${String(r.colunas.length).padStart(6)}` +
      `${String(r.passos).padStart(8)}${String(r.ms).padStart(9)}`,
  );
}

const falhas = resultados.filter((r) => !r.ok);
const alertas = resultados.filter((r) => r.alerta);

if (args.colunas) {
  for (const r of resultados.filter((x) => x.ok)) {
    console.log(`\n${r.id} (${r.colunas.length} colunas):\n  ${r.colunas.join(', ')}`);
  }
}

if (alertas.length) {
  console.log('\n── Contagem que o M não explica ──');
  for (const r of alertas) console.log(`  ${r.id}: ${r.alerta}`);
}

if (falhas.length) {
  console.log('\n── Falhas ──');
  for (const r of falhas) console.log(`  ${r.id}: ${r.erro}`);
}

console.log(
  `\n${resultados.length - falhas.length}/${resultados.length} rodaram inteiras` +
    `${alertas.length ? `, ${alertas.length} com contagem suspeita` : ''}.`,
);
process.exit(falhas.length || alertas.length ? 1 : 0);
