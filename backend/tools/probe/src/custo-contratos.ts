// Onde ficam os ~58 s de `contratos`? No plano do servidor, na ordenação, ou no
// transporte das linhas?
//
// POR QUE ESTA SONDA EXISTE. Em 02/09/2026 a busca de `contratos` foi medida ao
// vivo em 2,9 s e esse número entrou no comentário do grupo `quente` em
// `backend/specs/_catalog/refresh.yaml`. Em 17/09 o mesmo grupo, com as MESMAS sete
// queries e a spec de `contratos` inalterada desde o primeiro commit, levou 81 s e
// 105 s em duas passadas — e `contratos` sozinha respondeu por 58 s. Vinte vezes,
// sem uma linha de SQL ter mudado.
//
// "A query ficou lenta" não é diagnóstico: é o sintoma. Um resultado de 87.907
// linhas x 23 colunas pode custar caro em três lugares diferentes, e o conserto de
// cada um é outro. Esta sonda os separa medindo quatro formas do MESMO SQL:
//
//   1. count  ....... `select count(*) from (<sql sem order by>) x`
//                     O servidor executa o join inteiro e devolve UM número.
//                     Isola o custo do PLANO: zero transporte, zero ordenação.
//   2. sem ordem .... o SQL inteiro, sem o `order by p.name asc`.
//                     A diferença para (1) é o TRANSPORTE das linhas.
//   3. completo ..... o SQL como a spec o declara.
//                     A diferença para (2) é a ORDENAÇÃO.
//   4. count de novo  repete (1) no fim. Se o número dobrar entre a primeira e a
//                     última medição, o servidor está sob carga variável e
//                     NENHUMA das três conclusões acima vale hoje — é ambiente,
//                     não query.
//
// E `--banda` responde a pergunta que as quatro juntas levantam: se o custo é
// transporte, QUANTO o link entrega? Ela mede com payload sintético
// (`generate_series` + `repeat`), sem tocar em tabela de negócio, em três
// tamanhos e mais uma passada de muitas linhas curtas — é essa última que separa
// "o link é lento" de "o driver cobra caro por linha".
//
// REGRA DE SAÍDA (a mesma de toda ferramenta de diagnóstico desta casa): id,
// contagem, nome de coluna e tempo. **Nunca valor de linha.** Este resultado
// carrega CLIENTE, TELEFONE, CPF/CNPJ, E-MAIL e endereço de cliente real.
//
// SOMENTE LEITURA: `assertReadOnly` recusa qualquer coisa que não seja `select`,
// e a sonda nunca escreve no banco.
//
// Uso:
//   npm run probe:custo-contratos
//   npm run probe:custo-contratos -- --query=protocolos-geral --repete=3

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import pg from 'pg';
import yaml from 'yaml';
import { applyDotEnv, loadConfig } from '../../../packages/query-engine/src/config.ts';
import { assertReadOnly } from '../../../packages/query-engine/src/connectors-sql.ts';
import { semOrdemDeTopo } from './ordem-de-topo.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
applyDotEnv(ROOT);
const cfg = loadConfig();

let queryId = 'contratos';
let repete = 1;
let soBanda = false;
for (const raw of process.argv.slice(2)) {
  if (raw.startsWith('--query=')) queryId = raw.slice('--query='.length);
  else if (raw.startsWith('--repete=')) repete = Number.parseInt(raw.slice('--repete='.length), 10);
  else if (raw === '--banda') soBanda = true;
  else {
    console.error(`argumento desconhecido: ${raw}`);
    console.error('use: --query=<id>  --repete=<n>  --banda');
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
  console.error(`${queryId} é '${spec.datasource}', e esta sonda fala PostgreSQL.`);
  process.exit(2);
}

const sql = spec.sql.replace(/;\s*$/, '');
assertReadOnly(sql);

const { sql: sqlSemOrdem, achou: temOrdem } = semOrdemDeTopo(sql);
const sqlCount = `select count(*) as n from (\n${sqlSemOrdem}\n) as _contagem`;

const client = new pg.Client({
  host: cfg.voalle.host,
  port: cfg.voalle.port,
  database: cfg.voalle.database,
  user: cfg.voalle.user,
  password: cfg.voalle.password,
  ssl: cfg.voalle.ssl,
  statement_timeout: 0,
  query_timeout: 0,
});

/** Roda e devolve (ms, linhas, colunas). Não devolve — nem toca — valor de linha. */
async function mede(rotulo: string, texto: string): Promise<{ ms: number; linhas: number }> {
  const t0 = Date.now();
  const r = await client.query({ text: texto, rowMode: 'array' });
  const ms = Date.now() - t0;
  const linhas = r.rowCount ?? r.rows.length;
  console.log(`  ${rotulo.padEnd(14)} ${ms.toLocaleString('pt-BR').padStart(9)} ms   ${linhas.toLocaleString('pt-BR').padStart(9)} linha(s)`);
  return { ms, linhas };
}

/**
 * Banda até o dbVoalle, com payload sintético — nenhuma tabela de negócio é lida.
 *
 * Três tamanhos porque a primeira passada paga o aperto de mão e engana para
 * baixo; e uma passada de 100 mil linhas curtas porque é ela que responde se o
 * custo é por BYTE ou por LINHA. Se as linhas curtas voarem e os megabytes se
 * arrastarem, o gargalo é o link — e nenhuma reescrita de SQL o conserta.
 */
async function banda(): Promise<void> {
  console.log(`\nBanda até o dbVoalle — ${new Date().toISOString()}`);
  console.log('  (payload sintético: generate_series + repeat; nenhuma tabela de negócio)');

  // Latência primeiro, porque ela separa "o banco está do outro lado da sala" de
  // "o banco está do outro lado de um link". Um `select 1` não transporta nada:
  // o que ele mede é só a ida e a volta.
  const idas: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t = Date.now();
    await client.query('select 1');
    idas.push(Date.now() - t);
  }
  idas.sort((a, b) => a - b);
  console.log(`  ida e volta (select 1): mediana ${idas[10]} ms, melhor ${idas[0]} ms, pior ${idas[19]} ms`);

  // A pergunta que decide o conserto: o gargalo é o FIO ou o DRIVER?
  //
  // Mesma quantidade de bytes, em UMA linha de uma coluna, por `string_agg`. O
  // servidor trabalha mais; o driver, quase nada — nenhum objeto por linha,
  // nenhuma conversão por campo. Se esta passada voar e a de 10.000 linhas se
  // arrastar, o custo é do driver montando linha, e é dentro de casa que se
  // conserta. Se as duas se arrastarem igual, é o fio — e nenhuma reescrita de
  // SQL, de driver ou de spec muda isso.
  for (const mb of [10]) {
    const t0 = Date.now();
    const r = await client.query({
      text: `select length(string_agg(repeat('x', 1000), '')) as n from generate_series(1, ${mb * 1000})`,
      rowMode: 'array',
    });
    const ms = Date.now() - t0;
    const bytes = Number((r.rows[0] as unknown[])[0]);
    console.log(
      `  ${mb} MB numa linha só (string_agg) em ${ms.toLocaleString('pt-BR').padStart(8)} ms` +
        `  =>  ${(bytes / 1e6 / (ms / 1000)).toFixed(2)} MB/s no servidor, ~0 MB no fio`,
    );
  }
  // E de volta ao fio: os mesmos 10 MB, uma linha, mas ENTREGUES ao cliente.
  {
    const t0 = Date.now();
    const r = await client.query({
      text: `select string_agg(repeat('x', 1000), '') as b from generate_series(1, 10000)`,
      rowMode: 'array',
    });
    const ms = Date.now() - t0;
    const bytes = String((r.rows[0] as unknown[])[0]).length;
    console.log(
      `  ${(bytes / 1e6).toFixed(0)} MB numa linha só, ENTREGUES em ${ms.toLocaleString('pt-BR').padStart(8)} ms` +
        `  =>  ${(bytes / 1e6 / (ms / 1000)).toFixed(2)} MB/s`,
    );
  }

  for (const mb of [1, 10, 50]) {
    const t0 = Date.now();
    await client.query({
      text: `select repeat('x', 1000) as bloco from generate_series(1, ${mb * 1000})`,
      rowMode: 'array',
    });
    const ms = Date.now() - t0;
    console.log(
      `  ${String(mb).padStart(3)} MB em ${ms.toLocaleString('pt-BR').padStart(8)} ms  =>  ` +
        `${(mb / (ms / 1000)).toFixed(2)} MB/s`,
    );
  }
  const t0 = Date.now();
  await client.query({
    text: `select i, repeat('x', 10) as b from generate_series(1, 100000) i`,
    rowMode: 'array',
  });
  console.log(`  100.000 linhas curtas (~1 MB) em ${(Date.now() - t0).toLocaleString('pt-BR')} ms`);
  console.log('');
}

await client.connect();

if (soBanda) {
  await banda();
  await client.end();
  process.exit(0);
}

console.log(`\nCusto de '${queryId}' em dbVoalle — ${new Date().toISOString()}`);
console.log(`  ${temOrdem ? 'a spec declara um `order by` de topo' : 'a spec NÃO tem `order by` de topo — (2) e (3) vão coincidir'}`);
console.log('');

for (let i = 1; i <= repete; i++) {
  console.log(`passada ${i}/${repete}`);
  const c1 = await mede('count', sqlCount);
  const semOrdem = await mede('sem ordem', sqlSemOrdem);
  const completo = await mede('completo', sql);
  const c2 = await mede('count de novo', sqlCount);

  const deriva = Math.abs(c2.ms - c1.ms) / Math.max(c1.ms, 1);
  console.log('');
  console.log(`  plano do servidor ......... ${c1.ms.toLocaleString('pt-BR')} ms`);
  console.log(`  transporte das linhas ..... ${Math.max(0, semOrdem.ms - c1.ms).toLocaleString('pt-BR')} ms`);
  console.log(`  ordenação ................. ${Math.max(0, completo.ms - semOrdem.ms).toLocaleString('pt-BR')} ms`);
  if (deriva > 0.5) {
    console.log('');
    console.log(`  ⚠ o count variou ${(deriva * 100).toFixed(0)}% entre a primeira e a última medição.`);
    console.log('    O servidor está sob carga variável: a repartição acima NÃO vale hoje.');
  }
  console.log('');
}

await client.end();
