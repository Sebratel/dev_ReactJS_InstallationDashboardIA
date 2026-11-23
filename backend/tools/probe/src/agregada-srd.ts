// A agregação de uma página cabe no SRD? Mede, no banco, o que uma pré-agregada custaria
// e quanto ela comprimiria.
//
//   npm run probe:agregada-srd [-- --pagina=visao-geral] [-- --query=protocolos-geral]
//
// **Por que existe.** "Empurra a agregação para o SGBD" soa óbvio e pode ser inútil: se o
// GRÃO da agregada tiver de preservar uma dimensão de alta cardinalidade — um slicer de
// CLIENTE, de Nº PROTOCOLO — o `GROUP BY` devolve o mesmo número de linhas da tabela
// original, e o trabalho inteiro é perdido. Medido em 23/11/2026 na `visao-geral`: grão
// completo 109.409 linhas contra 109.407 da tabela; tirando os dois slicers de busca,
// 2.509 (ACHADOS #273). Esta sonda faz essa conta ANTES de alguém escrever o SQL.
//
// **O que ela imprime:** contagens, tempos e nomes de coluna. **Nunca valor de linha** —
// todo `SELECT` daqui é embrulhado num `COUNT(*)`, então nenhum dado de cliente trafega.
//
// Somente leitura: `assertReadOnly` barra o que não for consulta, e a réplica é checada
// com `pg_is_in_recovery()`.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import pg from 'pg';
import yaml from 'yaml';
import { applyDotEnv, loadConfig } from '../../../packages/query-engine/src/config.ts';
import { assertReadOnly } from '../../../packages/query-engine/src/connectors-sql.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
applyDotEnv(ROOT);
const cfg = loadConfig();

let pagina = 'visao-geral';
let queryId = 'protocolos-geral';
let entidade = 'PROTOCOLOS GERAL';
let colunaData = 'DATA CRIADO';
for (const raw of process.argv.slice(2)) {
  if (raw.startsWith('--pagina=')) pagina = raw.slice('--pagina='.length);
  else if (raw.startsWith('--query=')) queryId = raw.slice('--query='.length);
  else if (raw.startsWith('--entidade=')) entidade = raw.slice('--entidade='.length);
  else if (raw.startsWith('--data=')) colunaData = raw.slice('--data='.length);
  else {
    console.error(`argumento desconhecido: ${raw}`);
    console.error('use: --pagina=<id> --query=<id> --entidade=<TABELA> --data=<COLUNA>');
    process.exit(2);
  }
}

/** Visuais que mostram LINHA. O grão deles é a linha, então não há o que agregar. */
const DE_DETALHE = new Set(['tableEx', 'pivotTable']);

type Campo = { entity?: string; kind?: string; property?: string };
type Visual = { type?: string; fields?: Campo[] };

/** Toda dimensão (coluna, não medida) que um visual NÃO de detalhe usa da entidade. */
function dimensoesDaPagina(no: unknown, achadas: Map<string, Set<string>>): void {
  if (Array.isArray(no)) {
    for (const item of no) dimensoesDaPagina(item, achadas);
    return;
  }
  if (!no || typeof no !== 'object') return;
  const v = no as Visual & Record<string, unknown>;
  if (Array.isArray(v.fields) && typeof v.type === 'string' && !DE_DETALHE.has(v.type)) {
    for (const f of v.fields) {
      if (f.entity === entidade && f.kind === 'column' && f.property) {
        const tipos = achadas.get(f.property) ?? new Set<string>();
        tipos.add(v.type);
        achadas.set(f.property, tipos);
      }
    }
  }
  for (const valor of Object.values(v)) dimensoesDaPagina(valor, achadas);
}

const dirPaginas = path.join(ROOT, 'backend/specs/dashboards');
const nomeArq = fs.readdirSync(dirPaginas).find((f) => f.endsWith(`${pagina}.spec.yaml`));
if (!nomeArq) {
  console.error(`não achei a spec da página '${pagina}' em backend/specs/dashboards/`);
  process.exit(2);
}
const spec: unknown = yaml.parse(fs.readFileSync(path.join(dirPaginas, nomeArq), 'utf8'));
const achadas = new Map<string, Set<string>>();
dimensoesDaPagina(spec, achadas);

const arqQuery = path.join(ROOT, 'backend/specs/_catalog/queries', `${queryId}.spec.yaml`);
if (!fs.existsSync(arqQuery)) {
  console.error(`não achei ${path.relative(ROOT, arqQuery)}`);
  process.exit(2);
}
const specQuery = yaml.parse(fs.readFileSync(arqQuery, 'utf8')) as { sql?: string; datasource?: string };
if (!specQuery.sql) {
  console.error(`${queryId} não tem \`sql:\` — esta sonda mede SQL.`);
  process.exit(2);
}
if (specQuery.datasource !== 'dbVoalle') {
  console.error(`${queryId} é '${specQuery.datasource}', e esta sonda fala PostgreSQL.`);
  process.exit(2);
}
const SQL = specQuery.sql.trim().replace(/;\s*$/, '');
assertReadOnly(SQL);

const client = new pg.Client({
  host: cfg.voalle.host,
  port: cfg.voalle.port,
  database: cfg.voalle.database,
  user: cfg.voalle.user,
  password: cfg.voalle.password,
  ssl: cfg.voalle.ssl,
  statement_timeout: 300_000,
  query_timeout: 0,
  application_name: 'probe-agregada-srd',
});

const aspas = (c: string): string => `"${c.replace(/"/g, '""')}"`;
const n = (x: number): string => x.toLocaleString('pt-BR');
const ganho = (total: number, linhas: number): string =>
  linhas > 0 && total / linhas >= 2 ? `${(total / linhas).toFixed(0)}x menor` : 'SEM GANHO';

/** Conta as linhas de um grão. O `COUNT(*)` por fora garante que nada de linha volte. */
async function contaGrao(expr: string): Promise<number> {
  const sql = `with base as (\n${SQL}\n) select count(*) as n from (select ${expr} from base group by ${expr}) as _grao`;
  const r = await client.query(sql);
  return Number((r.rows[0] as { n: string }).n);
}

async function graoImpresso(rotulo: string, expr: string, total: number): Promise<number> {
  const t0 = Date.now();
  const linhas = await contaGrao(expr);
  const seg = String(Math.round((Date.now() - t0) / 1000)).padStart(3);
  console.log(`  ${rotulo.padEnd(42)} ${n(linhas).padStart(9)} linhas  ${seg}s  ${ganho(total, linhas)}`);
  return linhas;
}

async function main(): Promise<void> {
  await client.connect();
  const rec = await client.query('select pg_is_in_recovery() as replica');
  const replica = (rec.rows[0] as { replica: boolean }).replica;

  // As colunas que o SQL realmente devolve. O resto nasce depois, no M ou no DAX — e
  // pré-agregar no banco exige portar essas antes.
  const vazio = await client.query(`with base as (\n${SQL}\n) select * from base limit 0`);
  const noSql = new Set(vazio.fields.map((f) => f.name));

  const dims = [...achadas.keys()].sort((a, b) => a.localeCompare(b));
  const emSql = dims.filter((d) => noSql.has(d));
  const calculadas = dims.filter((d) => !noSql.has(d));

  console.log(`\n=== A AGREGADA DE '${pagina}' CABE NO SRD? ===`);
  console.log(`  query ${queryId} · entidade ${entidade} · réplica somente leitura: ${replica ? 'sim' : 'NÃO'}`);
  console.log(`  ${noSql.size} colunas vêm do SQL\n`);

  console.log('  DIMENSÕES que a página usa (fora os visuais de detalhe):');
  for (const d of emSql) {
    console.log(`    [sql ] ${d.padEnd(24)} ${[...(achadas.get(d) ?? [])].sort((a, b) => a.localeCompare(b)).join(', ')}`);
  }
  for (const d of calculadas) {
    console.log(`    [calc] ${d.padEnd(24)} ${[...(achadas.get(d) ?? [])].sort((a, b) => a.localeCompare(b)).join(', ')}  <- não existe no SQL`);
  }
  if (calculadas.length > 0) {
    console.log(`\n  ${calculadas.length} dimensão(ões) nasce(m) depois do SQL. Pré-agregar no banco exige portá-las`);
    console.log('  (ou provar que o join que as produz também é dbVoalle).');
  }
  if (emSql.length === 0) {
    console.log('\n  Nenhuma dimensão desta página vem do SQL: não há o que medir aqui.\n');
    return;
  }

  const totalR = await client.query(`with base as (\n${SQL}\n) select count(*) as n from base`);
  const total = Number((totalR.rows[0] as { n: string }).n);
  console.log(`\n  hoje a tabela tem ${n(total)} linhas. O grão do GROUP BY devolveria:\n`);

  await graoImpresso('grão COMPLETO (todos os filtros)', emSql.map(aspas).join(', '), total);

  // **Por que a cardinalidade individual, e não "tirar uma de cada vez".** Tirar uma só
  // não acha nada quando DUAS dimensões são de alta cardinalidade: a que fica segura o
  // grão sozinha, e todas as combinações parecem igualmente ruins (medido na
  // `visao-geral`, 23/11/2026 — oito "SEM GANHO" em fila, escondendo que o problema eram
  // `CLIENTE` e `N°PROTOCOLO` juntos). Contar os DISTINTOS de cada uma aponta o dedo.
  const distintos: Array<{ col: string; n: number }> = [];
  for (const col of emSql) {
    const r = await client.query(`with base as (\n${SQL}\n) select count(distinct ${aspas(col)}) as n from base`);
    distintos.push({ col, n: Number((r.rows[0] as { n: string }).n) });
  }
  distintos.sort((a, b) => b.n - a.n);

  // Alta cardinalidade = tantos valores distintos que pôr a coluna no grão é o mesmo que
  // não agregar. O corte em 10% do total é empírico: um filtro de BUSCA (protocolo,
  // cliente) fica muito acima dele, e uma dimensão de análise (cidade, equipe), muito
  // abaixo — na `visao-geral` a maior analítica deu 0,3% e a menor de busca, 95%.
  const CORTE = 0.1;
  console.log('\n  VALORES DISTINTOS de cada dimensão (a que decide se agregar adianta):');
  for (const { col, n: d } of distintos) {
    const frac = total > 0 ? d / total : 0;
    const marca = frac >= CORTE ? '  <- BUSCA, não dimensão: no grão, anula a agregação' : '';
    console.log(`    ${col.padEnd(26)} ${n(d).padStart(9)} distintos  ${(frac * 100).toFixed(1).padStart(5)}% do total${marca}`);
  }

  // O eixo de tempo: as medidas agregam por data, então ela entra no grão.
  const bloqueiam = distintos.filter((d) => total > 0 && d.n / total >= CORTE).map((d) => d.col);
  const analiticas = emSql.filter((d) => !bloqueiam.includes(d));
  if (bloqueiam.length > 0) {
    console.log(`\n  Fora ${bloqueiam.join(' e ')}, sobram ${analiticas.length} dimensões analíticas:`);
    await graoImpresso('grão analítico (sem as de busca)', analiticas.map(aspas).join(', '), total);
  }
  if (noSql.has(colunaData) && analiticas.length > 0) {
    const L = analiticas.map(aspas).join(', ');
    console.log(`\n  COM O EIXO DE TEMPO (${colunaData}), sobre ${analiticas.length} dimensões analíticas:`);
    await graoImpresso('sem data', L, total);
    await graoImpresso('+ mês', `${L}, date_trunc('month', ${aspas(colunaData)}::timestamp)`, total);
    await graoImpresso('+ dia', `${L}, ${aspas(colunaData)}::date`, total);
  }
  console.log('\n  Grão diário costuma anular o ganho; mensal costuma mantê-lo. A escolha é de');
  console.log('  produto, não de engenharia — ver docs/RECORTE-AGREGADA-SRD.md.\n');
}

try {
  await main();
} finally {
  await client.end().catch(() => {});
}
