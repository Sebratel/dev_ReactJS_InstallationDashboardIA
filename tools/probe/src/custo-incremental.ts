#!/usr/bin/env node
// `npm run probe:custo-incremental` — mede se estreitar a janela de data
// realmente barateia a consulta.
//
// **A pergunta que isto responde, antes de escrever a carga incremental.** Uma
// carga incremental só compensa se `WHERE data >= :desde` custar proporcionalmente
// menos que a varredura inteira. Isso é uma hipótese, não um fato: se o preço da
// consulta estiver nos `JOIN` e não no volume de linhas devolvidas — ou se não
// houver índice na coluna de data —, o plano varre as mesmas tabelas e o recorte
// economiza só a rede. Nesse caso a mesclagem em disco seria complexidade paga
// por nada, e é melhor descobrir aqui do que depois de trezentas linhas de código.
//
// Mede o que decide: **tempo** e **linhas** para cada corte. O ganho é
// `tempo_do_corte / tempo_da_base`; abaixo de ~0,5 o incremental paga, perto de
// 1,0 não paga.
//
// REGRA DE SAÍDA: contagem, tempo e nome de coluna. Nunca valor de linha — estas
// consultas trazem CLIENTE e TELEFONE.
//
// Com `--costura`, mede o SQL que a carga incremental de verdade vai rodar — o
// da política em `specs/_catalog/incremental.yaml`, costurado e com `:desde`
// como parâmetro. É a diferença entre medir uma aproximação e medir a consulta.
//
// Uso:
//   npm run probe:custo-incremental
//   npm run probe:custo-incremental -- --query=field-agenda
//   npm run probe:custo-incremental -- --costura --desde=2026-08-18
//   npm run probe:custo-incremental -- --costura --so-costura   # não roda a base

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { applyDotEnv, loadConfig } from '../../../packages/query-engine/src/config.ts';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import { costura, lePoliticas } from '../../../packages/snapshot/src/incremental.ts';
import { traduzParametros } from '../../../packages/query-engine/src/connectors-sql.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);
const cfg = loadConfig();

function arg(nome: string, padrao: string): string {
  const bruto = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return bruto === undefined ? padrao : bruto.slice(nome.length + 3);
}

const queryId = arg('query', 'protocolos-produtividade');
const cortes = arg('desde', '2026-08-01,2026-08-18').split(',').map((s) => s.trim()).filter(Boolean);
const segundos = Number.parseInt(arg('timeout', '1800'), 10);
/** Mede o SQL costurado da política, e não a troca crua do literal de data. */
const comCostura = process.argv.includes('--costura');
/** Pula a base — ela custa minutos, e quem já a mediu não precisa de novo. */
const soCostura = process.argv.includes('--so-costura');

const registry = QueryRegistry.fromSpecsDir(path.join(ROOT, 'specs'));
const spec = registry.queries.get(queryId);
if (!spec) {
  console.error(`query não registrada: ${queryId}`);
  process.exit(2);
}
if (!spec.sql) {
  console.error(`${queryId} não tem campo 'sql:' — nada a medir aqui.`);
  process.exit(2);
}
if (spec.datasource !== 'dbVoalle') {
  console.error(`${queryId} é '${spec.datasource}'; esta sonda só fala com o dbVoalle.`);
  process.exit(2);
}

/**
 * Os cortes de data que as specs usam hoje, em texto literal.
 *
 * São dois formatos porque as duas queries pesadas foram recortadas de jeitos
 * diferentes: `protocolos-produtividade` fixou o começo do ano e `field-agenda`
 * usa janela deslizante. Trocar os dois pelo mesmo literal é o que permite medir
 * as duas com a mesma sonda.
 */
const RECORTES: RegExp[] = [
  /'2026-01-01'/g,
  /\(CURRENT_DATE - INTERVAL '3 months'\)/g,
];

function comCorte(sql: string, data: string): { texto: string; trocas: number } {
  let trocas = 0;
  let texto = sql;
  for (const re of RECORTES) {
    texto = texto.replace(re, () => {
      trocas += 1;
      return `'${data}'`;
    });
  }
  return { texto, trocas };
}

const pool = new pg.Pool({
  host: cfg.voalle.host,
  port: cfg.voalle.port,
  database: cfg.voalle.database,
  user: cfg.voalle.user,
  password: cfg.voalle.password,
  ssl: cfg.voalle.ssl,
  max: 1,
  statement_timeout: segundos * 1000,
});

const cliente = await pool.connect();
await cliente.query(`SET search_path TO ${cfg.voalle.schema}, public`);
await cliente.query('SET default_transaction_read_only = on');

const base = spec.sql.replace(/;\s*$/, '');
console.log(`query: ${queryId}  (${base.split('\n').length} linhas de SQL)`);
console.log(`banco: ${cfg.voalle.database} schema=${cfg.voalle.schema} (somente leitura)`);
console.log(`teto de tempo: ${segundos}s por corte\n`);

interface Medida {
  rotulo: string;
  ms: number;
  linhas: number;
  trocas: number;
  erro?: string;
}

async function mede(
  rotulo: string,
  sql: string,
  trocas: number,
  valores: unknown[] = [],
): Promise<Medida> {
  const t0 = Date.now();
  try {
    // `rowMode: 'array'` pelo mesmo motivo do connector: coluna duplicada não some.
    // E não olhamos valor nenhum — só o comprimento.
    const r = await cliente.query(
      valores.length > 0
        ? { text: sql, values: valores, rowMode: 'array' as const }
        : { text: sql, rowMode: 'array' as const },
    );
    return { rotulo, ms: Date.now() - t0, linhas: r.rows.length, trocas };
  } catch (err) {
    return {
      rotulo,
      ms: Date.now() - t0,
      linhas: 0,
      trocas,
      erro: err instanceof Error ? err.message : String(err),
    };
  }
}

const medidas: Medida[] = [];

if (!soCostura) {
  process.stderr.write(`  base (a spec como está)… `);
  medidas.push(await mede('base (spec)', base, 0));
  process.stderr.write(`${medidas.at(-1)!.ms} ms\n`);
}

if (comCostura) {
  const politica = lePoliticas(path.join(ROOT, 'specs')).get(queryId);
  if (!politica) {
    console.error(`\n${queryId} não tem política em specs/_catalog/incremental.yaml.`);
    process.exit(2);
  }
  // O mesmo caminho da carga: costura e depois traduz `:desde` para `$1`. Medir
  // outra coisa aqui seria medir uma aproximação do que vai rodar.
  const costurado = costura(base, politica);
  console.log(
    `costura: ${politica.costura.length} âncora(s), ` +
      `SQL passa de ${base.split('\n').length} para ${costurado.split('\n').length} linhas\n`,
  );
  for (const data of cortes) {
    const { text, values } = traduzParametros(
      costurado,
      { [politica.parametro]: data },
      (n) => `$${n}`,
    );
    process.stderr.write(`  costurado, desde ${data} (${values.length} uso(s) de :${politica.parametro})… `);
    medidas.push(await mede(`costurado ${data}`, text, values.length, values));
    process.stderr.write(`${medidas.at(-1)!.ms} ms\n`);
  }
} else {
  for (const data of cortes) {
    const { texto, trocas } = comCorte(base, data);
    if (trocas === 0) {
      console.error(
        `\n  ATENÇÃO: nenhum recorte de data reconhecido no SQL de ${queryId}. ` +
          `Os padrões conhecidos estão em RECORTES, neste arquivo.`,
      );
      break;
    }
    process.stderr.write(`  desde ${data} (${trocas} recorte(s))… `);
    medidas.push(await mede(`desde ${data}`, texto, trocas));
    process.stderr.write(`${medidas.at(-1)!.ms} ms\n`);
  }
}

await cliente.release();
await pool.end();

// ------------------------------------------------------------------ relatório
const n = (v: number): string => v.toLocaleString('pt-BR');
if (medidas.length === 0) {
  console.log('\nnada medido.');
  process.exit(0);
}
/**
 * A base é a referência das porcentagens. Com `--so-costura` ela não foi medida,
 * e aí a primeira do lote vira referência — as colunas passam a comparar os
 * cortes entre si, que é a única leitura honesta sem a base ao lado.
 */
const referencia = medidas[0]!;

console.log(
  '\n' + 'corte'.padEnd(24) + 'linhas'.padStart(12) + 'tempo'.padStart(12) + 'do total'.padStart(11),
);
console.log('-'.repeat(59));
for (const m of medidas) {
  if (m.erro) {
    console.log(`${m.rotulo.padEnd(24)}${'FALHOU'.padStart(12)}${(m.ms + ' ms').padStart(12)}`);
    continue;
  }
  const fracao = referencia.ms > 0 ? m.ms / referencia.ms : 1;
  console.log(
    m.rotulo.padEnd(24) +
      n(m.linhas).padStart(12) +
      `${(m.ms / 1000).toFixed(1)} s`.padStart(12) +
      `${(fracao * 100).toFixed(0)}%`.padStart(11),
  );
}

const falhas = medidas.filter((m) => m.erro);
if (falhas.length) {
  console.log('\n── Falhas ──');
  for (const m of falhas) console.log(`  ${m.rotulo}: ${m.erro}`);
}

const menor = medidas.filter((m) => !m.erro).at(-1);
if (menor && menor !== referencia && referencia.ms > 0) {
  const fracao = menor.ms / referencia.ms;
  console.log(
    `\nO corte mais estreito custa ${(fracao * 100).toFixed(0)}% do tempo da base ` +
      `e traz ${(referencia.linhas > 0 ? (menor.linhas / referencia.linhas) * 100 : 0).toFixed(0)}% das linhas.`,
  );
  console.log(
    fracao < 0.5
      ? '  → o recorte de data barateia de verdade: carga incremental paga.'
      : '  → o preço não está no volume de linhas, e sim no plano. ' +
        'Carga incremental economizaria pouco e custaria a mesclagem em disco.',
  );
}
