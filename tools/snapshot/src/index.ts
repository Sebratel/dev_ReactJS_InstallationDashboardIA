#!/usr/bin/env node
// `npm run snapshot` — materializa a camada M em disco.
//
// **A costura que faltava.** `toDatasetRows` — a ponte entre a camada M e o
// `Dataset` do avaliador — existia desde a fase 2b.8 e só era chamada em teste.
// Sem ela num caminho de produção, as engines calculavam sobre dado sintético e
// nada na plataforma tocava número real.
//
// **Por que disco, e não memória no arranque da API.** O `mrun` já mediu: o
// avaliador de M mantém *todos* os passos vivos ao mesmo tempo — em M qualquer
// passo pode citar qualquer outro — e rodar as queries num processo só estourou o
// heap em 4 GB. A saída de lá é UMA QUERY POR PROCESSO, e ela vale aqui igual: com
// o processo morrendo entre uma query e outra, a memória volta ao sistema e uma
// query grande derruba só a si mesma. Uma API que rodasse a camada M no arranque
// seria exatamente o processo que já se sabe que não cabe.
//
// O que sobra em disco é a tabela **final** — não os 60 passos que a produziram.
//
// **O arquivo é dado de cliente.** `field-agenda` tem endereço, `QUADRO FUNCIONAL`
// tem CPF e RG. O diretório de saída está no `.gitignore`, e a saída deste
// programa nunca imprime valor de linha: só id, contagem, nome de coluna e tempo —
// a mesma regra do `mrun`, para poder colar em ticket.
//
// Uso:
//   npm run snapshot -- --pagina=diario-instalacao
//   npm run snapshot -- --todas --memoria=8192
//   npm run snapshot -- --pagina=visao-geral --plano     # só diz o que faria
//   npm run snapshot -- --query=protocolos-geral --refazer

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { MemoryCache } from '../../../packages/query-engine/src/cache-memory.ts';
import { applyDotEnv, loadConfig, missingFor } from '../../../packages/query-engine/src/config.ts';
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
import { buscadorWeb } from '../../../packages/query-engine/src/connectors-web.ts';
import { materializaColunas } from '../../../packages/snapshot/src/colunas-calculadas.ts';
import { resumoDoErro } from '../../../packages/snapshot/src/erro.ts';
import { QueryEngine } from '../../../packages/query-engine/src/engine.ts';
import {
  accessToken,
  readServiceAccount,
  SCOPE_SHEETS_READONLY,
} from '../../../packages/query-engine/src/google-auth.ts';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import type { Connector, ResolvedQuery } from '../../../packages/query-engine/src/types.ts';
import { fonteDoEngine } from '../../../packages/transform-engine/src/fonte.ts';
import { queryDependencies, runQueries } from '../../../packages/transform-engine/src/runner.ts';
import { toDatasetRows } from '../../../packages/transform-engine/src/value.ts';
import { SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { leJuncoes, reconciliadorDe } from '../../../packages/semantic-model/src/juncoes.ts';
import { loadDashboards } from '../../../packages/widget-engine/src/spec.ts';
import { planeja } from '../../../packages/snapshot/src/plano.ts';
import { escreve, leCabecalho } from '../../../packages/snapshot/src/formato.ts';
import {
  DIRETORIO_PADRAO,
  arquivoDaQuery,
  escreveManifesto,
  leManifesto,
  type EntradaDeManifesto,
} from '../../../packages/snapshot/src/manifesto.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);

/** Prefixo da linha de resultado do filho. Só ela é dado; o resto é log. */
const MARCA = '##SNAP##';

/**
 * Nenhuma query fica fora hoje. `clima-tempo` ficava, por causa do `Web.Contents`
 * sem connector; passou a ter (achado #42). A lista continua porque é aqui que a
 * próxima exclusão vai querer o motivo escrito ao lado.
 */
const FORA_DO_ESCOPO = new Set<string>();

// ------------------------------------------------------------------ argumentos
interface Args {
  paginas: string[];
  queries: string[];
  todas: boolean;
  plano: boolean;
  refazer: boolean;
  saida: string;
  memoria: number | null;
  segundos: number;
  uma: string | null;
}

/**
 * Teto de `statement_timeout` desta ferramenta, em segundos.
 *
 * **Materialização não é pedido de tela.** O `.env` traz 30 s, que é o teto certo
 * para um widget: passou disso, o usuário está esperando e alguma coisa está
 * errada. `protocolos-geral` e `protocolos-auxiliares` batem nesse teto — medido
 * em 07/08/2026, as duas foram canceladas pelo servidor —, e elas não estão
 * erradas: são varreduras grandes que rodam uma vez por refresh.
 *
 * Sobrescrever calado o valor do `.env` seria pior que o timeout. Por isso este
 * default é impresso na saída, com o número que substituiu, e `--timeout=` manda.
 */
const TIMEOUT_PADRAO_S = 600;

function parseArgs(argv: string[]): Args {
  const a: Args = {
    paginas: [],
    queries: [],
    todas: false,
    plano: false,
    refazer: false,
    saida: path.join(ROOT, DIRETORIO_PADRAO),
    memoria: null,
    segundos: TIMEOUT_PADRAO_S,
    uma: null,
  };
  const lista = (raw: string, pref: string): string[] =>
    raw.slice(pref.length).split(',').map((s) => s.trim()).filter(Boolean);

  for (const raw of argv) {
    if (raw === '--todas') a.todas = true;
    else if (raw === '--plano') a.plano = true;
    else if (raw === '--refazer') a.refazer = true;
    else if (raw.startsWith('--pagina=')) a.paginas.push(...lista(raw, '--pagina='));
    else if (raw.startsWith('--query=')) a.queries.push(...lista(raw, '--query='));
    else if (raw.startsWith('--saida=')) a.saida = path.resolve(ROOT, raw.slice('--saida='.length));
    else if (raw.startsWith('--uma=')) a.uma = raw.slice('--uma='.length);
    else if (raw.startsWith('--timeout=')) {
      const n = Number.parseInt(raw.slice('--timeout='.length), 10);
      if (!Number.isFinite(n) || n < 1) {
        console.error('--timeout espera segundos (mínimo 1)');
        process.exit(2);
      }
      a.segundos = n;
    } else if (raw.startsWith('--memoria=')) {
      const n = Number.parseInt(raw.slice('--memoria='.length), 10);
      if (!Number.isFinite(n) || n < 256) {
        console.error('--memoria espera MB (mínimo 256)');
        process.exit(2);
      }
      a.memoria = n;
    } else {
      console.error(`argumento desconhecido: ${raw}`);
      process.exit(2);
    }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));

// ------------------------------------------------------------------- catálogo
const registry = QueryRegistry.fromSpecsDir(path.join(ROOT, 'specs'));
const model = SemanticModel.fromSpecsDir(path.join(ROOT, 'specs'));

/**
 * O "agora" de toda a execução, tirado uma vez só.
 *
 * `'FIELD AGENDA'[Status SLA]` usa `NOW()`, e a coluna calculada é **congelada** no
 * arquivo. Um relógio por query poria instantes diferentes em tabelas do mesmo
 * snapshot, e a divergência apareceria depois como erro de paridade sem causa
 * visível.
 */
const AGORA = new Date();
const cfg = loadConfig();

const culture = (
  yaml.parse(fs.readFileSync(path.join(ROOT, 'specs', '_catalog', 'model.yaml'), 'utf8')) as {
    culture?: string | null;
  }
).culture ?? null;

/**
 * Quais mesclagens mortas podem comparar a chave como inteiro.
 *
 * Decisão humana, em `specs/_catalog/juncoes.yaml`. Vazio = nenhuma, e a nota da
 * materialização diz o número que justificaria cada uma.
 */
const reconcilia = reconciliadorDe(leJuncoes(path.join(ROOT, 'specs')));

const todasAsQueries = registry.list().filter((q) => q.m_expression && !FORA_DO_ESCOPO.has(q.id));

/** As tabelas do modelo que carregam do arquivo desta query. */
function tabelasDaQuery(id: string): string[] {
  return [...model.tables.values()].filter((t) => t.queryRef === id).map((t) => t.name);
}

// ------------------------------------------------------------------ connectors
async function montaConnectors(
  precisa: ReadonlySet<string>,
): Promise<{ connectors: Map<string, Connector>; fechar: (() => Promise<void>)[] }> {
  const connectors = new Map<string, Connector>();
  const fechar: (() => Promise<void>)[] = [];

  // O teto de tempo é desta execução, não do `.env`: ver TIMEOUT_PADRAO_S.
  const statementTimeoutMs = args.segundos * 1000;

  if (precisa.has('dbVoalle')) {
    const falta = missingFor('voalle');
    if (falta.length) throw new Error(`dbVoalle: falta no .env ${falta.join(', ')}`);
    const pool = await createVoallePool({ ...cfg.voalle, statementTimeoutMs });
    connectors.set('dbVoalle', createVoalleConnector(pool));
    fechar.push(() => pool.end());
  }
  if (precisa.has('dbMaria')) {
    const falta = missingFor('maria');
    if (falta.length) throw new Error(`dbMaria: falta no .env ${falta.join(', ')}`);
    const pool = await createMariaPool({ ...cfg.maria, statementTimeoutMs });
    connectors.set('dbMaria', createMariaConnector(pool));
    fechar.push(() => pool.end());
  }
  if (precisa.has('gsheets')) {
    const sa = readServiceAccount(cfg.gsheets.credentialsPath);
    connectors.set(
      'gsheets',
      new GoogleSheetsConnector({
        token: tokenComCache(() => accessToken(sa, [SCOPE_SHEETS_READONLY])),
        contaDeServico: sa.client_email,
      }),
    );
  }
  return { connectors, fechar };
}

/**
 * Datasources que a query e suas dependências de M usam.
 *
 * O fechamento importa nos dois sentidos: `protocolos-produtividade` é `dbVoalle`
 * na spec e mescla com `QUADRO FUNCIONAL`, que é planilha; e materializar
 * `contratos` não deve abrir pool no MariaDB nem ler credencial do Google.
 */
function fontesDe(id: string): Set<string> {
  const porNome = new Map(todasAsQueries.map((q) => [q.name, q]));
  const nomes = new Set(porNome.keys());
  const fontes = new Set<string>();
  const vistas = new Set<string>();
  const anda = (q: ResolvedQuery): void => {
    if (vistas.has(q.id)) return;
    vistas.add(q.id);
    if (q.datasource) fontes.add(q.datasource);
    for (const dep of queryDependencies(q.m_expression!, nomes).dependencias) {
      const d = porNome.get(dep);
      if (d) anda(d);
    }
  };
  const inicial = todasAsQueries.find((q) => q.id === id);
  if (inicial) anda(inicial);
  return fontes;
}

// ------------------------------------------------------------------ modo filho
interface Resultado {
  query: string;
  ok: boolean;
  linhas: number | null;
  colunas: number | null;
  bytes: number | null;
  ms: number;
  erro?: string;
  /**
   * O que a camada M fez e precisa ser dito — hoje, mesclagem que não casou nada.
   *
   * Viaja no resultado e **não** no stderr porque o pai só lê o stderr do filho
   * quando ele falha, e uma junção morta é justamente o caso em que tudo dá ok.
   */
  notas?: string[];
}

async function materializa(q: ResolvedQuery, saida: string): Promise<Resultado> {
  const inicio = Date.now();
  const { connectors, fechar } = await montaConnectors(fontesDe(q.id));
  const engine = new QueryEngine({ registry, connectors, cache: new MemoryCache() });
  const fonte = fonteDoEngine(engine);
  // Allowlist só do que ESTA query declara em `endpoints` (gerado do PBIP).
  const web = q.endpoints?.length ? buscadorWeb({ permitidos: q.endpoints }) : undefined;

  try {
    const feitas = await runQueries({
      specs: todasAsQueries,
      apenas: [q.id],
      culture,
      fonte,
      web,
      reconcilia,
    });
    // As notas da camada M saem ANTES de qualquer outra linha desta query. Elas
    // dizem o que a mesclagem fez, e uma mesclagem que não casou nada é a diferença
    // entre 87.805 linhas de dado e 87.805 nulos que a tela lê como BLANK (#64).
    const notas = feitas.get(q.id)!.notas.map((n) => `${n.fn} ${n.assunto}: ${n.mensagem}`);
    const { columns, rows } = toDatasetRows(feitas.get(q.id)!.tabela, q.id);

    // **Solta a camada M antes de materializar.** `toDatasetRows` já copiou tudo o
    // que interessa para `rows`, e o que fica em `feitas` é a mesma tabela na
    // representação do avaliador de M — uma linha é um `Map`, bem mais gordo que o
    // objeto simples. Manter as duas vivas foi o que estourou o heap em `field-agenda`
    // (ACHADOS #48): 1,46 milhão de linhas em dobro, e a materialização ainda por
    // vir. Nada abaixo daqui lê `feitas`.
    feitas.clear();

    // Colunas calculadas em DAX entram no arquivo, como o Power BI faz no refresh
    // (ACHADOS #47). Só as que dependem da própria tabela — o resto continua
    // nascendo no carregamento. `AGORA` é o mesmo para toda a execução: `Status SLA`
    // usa `NOW()`, e duas colunas com instantes diferentes no mesmo arquivo seriam
    // uma divergência que ninguém conseguiria explicar depois.
    const daxSha = new Map<string, string>();
    for (const nome of tabelasDaQuery(q.id)) {
      const t = model.table(nome);
      if (!t) continue;
      const m = materializaColunas(t, model, rows, AGORA);
      for (const c of m.colunas) if (!columns.includes(c)) columns.push(c);
      for (const [k, v] of m.daxSha) daxSha.set(k, v);
      if (m.colunas.length) {
        console.error(`    ${m.colunas.length} coluna(s) calculada(s) em ${m.ms} ms`);
      }
    }

    const arquivo = arquivoDaQuery(saida, q.id);
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    // Grava num temporário e renomeia: um processo morto no meio da escrita deixa
    // um arquivo com cabeçalho dizendo N linhas e menos que N gravadas. A leitura
    // pega isso pela contagem, mas é melhor o arquivo ruim nunca tomar o nome bom.
    const temp = `${arquivo}.parcial`;
    const cab = await escreve(
      temp,
      { query: q.id, tabelas: tabelasDaQuery(q.id), geradoEm: new Date().toISOString() },
      columns,
      rows,
      daxSha,
    );
    fs.renameSync(temp, arquivo);

    return {
      query: q.id,
      ok: true,
      linhas: cab.linhas,
      colunas: cab.colunas.length,
      bytes: fs.statSync(arquivo).size,
      ms: Date.now() - inicio,
      notas,
    };
  } catch (err) {
    return {
      query: q.id,
      ok: false,
      linhas: null,
      colunas: null,
      bytes: null,
      ms: Date.now() - inicio,
      erro: err instanceof Error ? err.message : String(err),
    };
  } finally {
    for (const f of fechar) await f().catch(() => {});
  }
}

if (args.uma) {
  const q = todasAsQueries.find((x) => x.id === args.uma);
  if (!q) {
    console.error(`id não existe ou está fora do escopo: ${args.uma}`);
    process.exit(2);
  }
  console.log(MARCA + JSON.stringify(await materializa(q, args.saida)));
  process.exit(0);
}

// ------------------------------------------------------------------- modo pai
const dashboards = loadDashboards(path.join(ROOT, 'specs'));

if (!args.todas && args.paginas.length === 0 && args.queries.length === 0) {
  console.error(
    'Escolha o que materializar: --pagina=id, --query=id ou --todas.\n' +
      'Não há default de propósito: --todas puxa a base das fontes reais.\n' +
      `Páginas: ${dashboards.map((d) => d.id).join(', ')}`,
  );
  process.exit(2);
}

const pedidas = args.todas
  ? dashboards
  : dashboards.filter((d) => args.paginas.includes(d.id));
const paginasInvalidas = args.paginas.filter((p) => !dashboards.some((d) => d.id === p));
if (paginasInvalidas.length) {
  console.error(`páginas que não existem: ${paginasInvalidas.join(', ')}`);
  process.exit(2);
}

const plano = pedidas.length > 0 ? planeja(pedidas, model) : null;
const alvo = [...new Set([...(plano?.queries ?? []), ...args.queries])].sort();

const foraDoEscopo = alvo.filter((id) => FORA_DO_ESCOPO.has(id));
const desconhecidas = alvo.filter(
  (id) => !FORA_DO_ESCOPO.has(id) && !todasAsQueries.some((q) => q.id === id),
);
const materializaveis = alvo.filter((id) => todasAsQueries.some((q) => q.id === id));

console.log(`\nsnapshot em ${path.relative(ROOT, args.saida) || '.'}`);
if (plano) {
  console.log(
    `${plano.dashboards.length} página(s): ${plano.tabelas.length} tabelas, ` +
      `${plano.queries.length} de query e ${plano.calculadas.length} calculada(s) no carregamento` +
      (plano.medidas.length ? `, ${plano.medidas.length} medidas` : ''),
  );
  for (const t of plano.tabelas) {
    console.log(`  ${t.nome.padEnd(28)}${(t.query ?? '(calculada)').padEnd(26)}${t.porque}`);
  }
}
if (foraDoEscopo.length) {
  console.log(
    `\n  fora do escopo da camada M, não materializa: ${foraDoEscopo.join(', ')} ` +
      `(define função dentro de 'let' e lê Web.Contents)`,
  );
}
if (desconhecidas.length) {
  console.error(`\nids que o Query Registry não tem: ${desconhecidas.join(', ')}`);
  process.exit(2);
}

if (args.plano) {
  console.log(`\n--plano: nada foi buscado. Materializaria ${materializaveis.length} query(s).`);
  process.exit(0);
}

/** O que já está em disco e continua válido — não se busca de novo sem `--refazer`. */
const jaTem = new Map<string, EntradaDeManifesto>();
for (const id of materializaveis) {
  const arquivo = arquivoDaQuery(args.saida, id);
  if (args.refazer || !fs.existsSync(arquivo)) continue;
  try {
    const cab = leCabecalho(arquivo);
    jaTem.set(id, {
      query: id,
      tabelas: cab.tabelas,
      linhas: cab.linhas,
      colunas: cab.colunas.length,
      bytes: fs.statSync(arquivo).size,
      geradoEm: cab.geradoEm,
    });
  } catch {
    // Cabeçalho ilegível é arquivo de versão antiga ou truncado: refaz.
  }
}

const aBuscar = materializaveis.filter((id) => !jaTem.has(id));
console.log(
  `\n${aBuscar.length} query(s) a buscar` +
    (jaTem.size ? `, ${jaTem.size} já em disco (use --refazer para rebuscar)` : '') +
    `${args.memoria ? `, heap de ${args.memoria} MB por processo` : ''}`,
);
if (aBuscar.length) {
  const doEnv = Math.round(cfg.voalle.statementTimeoutMs / 1000);
  console.log(
    `  statement_timeout de ${args.segundos}s nesta execução` +
      (doEnv !== args.segundos
        ? ` (o .env traz ${doEnv}s — teto de pedido de tela, não de materialização; --timeout= manda)`
        : ''),
  );
}
console.log('');

/**
 * O stderr inteiro num arquivo ao lado do snapshot, e o caminho dele na mensagem.
 *
 * 400 caracteres de resumo servem para ler no terminal; não servem para achar em que
 * linha de que arquivo o erro nasceu. O diretório já está no `.gitignore` e já contém
 * dado de cliente, então é o lugar certo — e o nome termina em `.erro.log` para não
 * ser confundido com tabela por `leManifesto`.
 */
function guardaErro(id: string, erro: string): string {
  if (!erro.trim()) return '';
  try {
    const alvo = path.join(args.saida, `${id}.erro.log`);
    fs.writeFileSync(alvo, erro, 'utf8');
    return ` — stderr completo em ${alvo}`;
  } catch {
    return '';
  }
}

async function rodaEmSubprocesso(id: string): Promise<Resultado> {
  const inicio = Date.now();
  const argv = [
    ...(args.memoria ? [`--max-old-space-size=${args.memoria}`] : []),
    fileURLToPath(import.meta.url),
    `--uma=${id}`,
    `--saida=${args.saida}`,
    `--timeout=${args.segundos}`,
  ];
  return new Promise((resolve) => {
    const filho = spawn(process.execPath, argv, { cwd: ROOT });
    let saida = '';
    let erro = '';
    filho.stdout.on('data', (d: Buffer) => (saida += d.toString()));
    filho.stderr.on('data', (d: Buffer) => (erro += d.toString()));
    filho.on('close', (code, signal) => {
      const linha = saida.split(/\r?\n/).find((l) => l.startsWith(MARCA));
      if (linha) {
        resolve(JSON.parse(linha.slice(MARCA.length)) as Resultado);
        return;
      }
      const semMemoria = /heap out of memory|Ineffective mark-compacts/.test(erro);
      resolve({
        query: id,
        ok: false,
        linhas: null,
        colunas: null,
        bytes: null,
        ms: Date.now() - inicio,
        erro: semMemoria
          ? `estourou o heap${args.memoria ? ` (${args.memoria} MB)` : ''}. ` +
            'O avaliador de M guarda todos os passos vivos: tente --memoria=8192.'
          : `processo terminou sem resultado (código ${code}, sinal ${signal}): ` +
            resumoDoErro(erro) + guardaErro(id, erro),
      });
    });
  });
}

const resultados: Resultado[] = [];
for (const id of aBuscar) {
  process.stderr.write(`  ${id}… `);
  const r = await rodaEmSubprocesso(id);
  process.stderr.write(`${r.ok ? 'ok' : 'FALHOU'} (${r.ms} ms)\n`);
  // Logo abaixo da linha da query, e não num resumo no fim: quem materializa uma
  // mesclagem morta precisa ver a nota ao lado do nome dela, não a três telas de
  // distância. Junção que não casa nada é a diferença entre dado e BLANK (#64).
  for (const n of r.notas ?? []) process.stderr.write(`      ${n}\n`);
  resultados.push(r);
}

// ------------------------------------------------------------------ manifesto
const entradas: EntradaDeManifesto[] = [...jaTem.values()];
for (const r of resultados) {
  if (!r.ok) continue;
  const cab = leCabecalho(arquivoDaQuery(args.saida, r.query));
  entradas.push({
    query: r.query,
    tabelas: cab.tabelas,
    linhas: cab.linhas,
    colunas: cab.colunas.length,
    bytes: r.bytes!,
    geradoEm: cab.geradoEm,
  });
}

// O manifesto acumula: materializar `visao-geral` depois de `diario-instalacao`
// não pode apagar do índice o que a primeira deixou em disco.
const anterior = leManifesto(args.saida);
const porQuery = new Map(anterior?.tabelas.map((e) => [e.query, e]) ?? []);
for (const e of entradas) porQuery.set(e.query, e);
const manifesto = escreveManifesto(args.saida, [...porQuery.values()].sort((a, b) => a.query.localeCompare(b.query)));

// ------------------------------------------------------------------ relatório
const n = (v: number | null): string => (v === null ? '-' : v.toLocaleString('pt-BR'));
const mb = (b: number): string => `${(b / 1024 / 1024).toFixed(1)} MB`;

if (resultados.length) {
  console.log(
    '\n' + 'query'.padEnd(28) + 'linhas'.padStart(12) + 'cols'.padStart(6) +
      'tamanho'.padStart(11) + 'ms'.padStart(9),
  );
  console.log('-'.repeat(66));
  for (const r of resultados) {
    console.log(
      `${r.ok ? ' ' : '✖'}${r.query.padEnd(27)}${n(r.linhas).padStart(12)}` +
        `${n(r.colunas).padStart(6)}${(r.bytes === null ? '-' : mb(r.bytes)).padStart(11)}` +
        `${String(r.ms).padStart(9)}`,
    );
  }
}

const falhas = resultados.filter((r) => !r.ok);
if (falhas.length) {
  console.log('\n── Falhas ──');
  for (const r of falhas) console.log(`  ${r.query}: ${r.erro}`);
}

console.log(
  `\nsnapshot: ${manifesto.tabelas.length} query(s), ` +
    `${n(manifesto.tabelas.reduce((a, e) => a + e.linhas, 0))} linhas, ` +
    `${mb(manifesto.tabelas.reduce((a, e) => a + e.bytes, 0))} em disco.`,
);
if (plano?.calculadas.length) {
  console.log(
    `  ${plano.calculadas.length} tabela(s) nascem de DAX no carregamento, não em disco: ` +
      plano.calculadas.join(', '),
  );
}
console.log('  Contém dado de cliente. O diretório está no .gitignore.');

process.exit(falhas.length ? 1 : 0);
