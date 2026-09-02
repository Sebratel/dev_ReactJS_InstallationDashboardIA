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
//   npm run snapshot -- --query=x --refazer --sem-calculadas  # não congela o DAX no fim
//   npm run snapshot -- --todas --incremental                 # só o que mudou desde a última

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
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
import { normalizeName, SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { loadDashboards } from '../../../packages/widget-engine/src/spec.ts';
import { planeja } from '../../../packages/snapshot/src/plano.ts';
import { escreve, le, leCabecalho, type Escalar } from '../../../packages/snapshot/src/formato.ts';
import {
  comoDia,
  costura,
  decideIncremental,
  lePoliticas,
  marcaDe,
  mescla,
  type PoliticaIncremental,
} from '../../../packages/snapshot/src/incremental.ts';
import {
  DIRETORIO_PADRAO,
  arquivoDaQuery,
  escreveManifesto,
  leManifesto,
  type EntradaDeManifesto,
} from '../../../packages/snapshot/src/manifesto.ts';
import { materializaColunas } from '../../../packages/snapshot/src/colunas-calculadas.ts';
import { resumoDoErro } from '../../../packages/snapshot/src/erro.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);

/** Prefixo da linha de resultado do filho. Só ela é dado; o resto é log. */
const MARCA = '##SNAP##';

/**
 * Um só instante para a execução inteira — ver o comentário em `materializa()`
 * sobre por que duas colunas com `NOW()` em arquivos diferentes seriam uma
 * divergência inexplicável.
 */
const AGORA = new Date();

/** As políticas de carga incremental declaradas em `specs/_catalog/incremental.yaml`. */
const politicas = lePoliticas(path.join(ROOT, 'specs'));

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
  /** Não encadeia o congelamento das calculadas no fim. Ver o rodapé deste arquivo. */
  semCalculadas: boolean;
  /**
   * Busca só o que mudou, em quem tem política em `specs/_catalog/incremental.yaml`.
   *
   * Implica refazer **todas** as pedidas: quem tem política paga o delta, quem não
   * tem é buscada inteira. A alternativa — pular as que já estão em disco — deixaria
   * o refresh incompleto justamente na volta que ele deveria ser barato o bastante
   * para rodar sempre.
   */
  incremental: boolean;
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
    semCalculadas: false,
    incremental: false,
  };
  const lista = (raw: string, pref: string): string[] =>
    raw.slice(pref.length).split(',').map((s) => s.trim()).filter(Boolean);

  for (const raw of argv) {
    if (raw === '--todas') a.todas = true;
    else if (raw === '--plano') a.plano = true;
    else if (raw === '--refazer') a.refazer = true;
    else if (raw === '--sem-calculadas') a.semCalculadas = true;
    else if (raw === '--incremental') a.incremental = true;
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
const cfg = loadConfig();

const culture = (
  yaml.parse(fs.readFileSync(path.join(ROOT, 'specs', '_catalog', 'model.yaml'), 'utf8')) as {
    culture?: string | null;
  }
).culture ?? null;

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
  /** Avisos que não impedem o resultado, mas quem lê precisa ver — ex.: junção morta. */
  notas?: string[];
}

async function materializa(q: ResolvedQuery, saida: string): Promise<Resultado> {
  const inicio = Date.now();
  // Populado pela carga incremental quando ela rodar (ver ACHADOS sobre a costura);
  // hoje `materializa` sempre busca inteiro, então isto fica vazio na prática.
  const avisos: string[] = [];
  const { connectors, fechar } = await montaConnectors(fontesDe(q.id));
  const engine = new QueryEngine({ registry, connectors, cache: new MemoryCache() });
  const fonte = fonteDoEngine(engine);
  // Allowlist só do que ESTA query declara em `endpoints` (gerado do PBIP).
  const web = q.endpoints?.length ? buscadorWeb({ permitidos: q.endpoints }) : undefined;

  try {
    const feitas = await runQueries({ specs: todasAsQueries, apenas: [q.id], culture, fonte, web });
    const { columns, rows } = toDatasetRows(feitas.get(q.id)!.tabela, q.id);

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
    );
    fs.renameSync(temp, arquivo);

    return {
      query: q.id,
      ok: true,
      linhas: cab.linhas,
      colunas: cab.colunas.length,
      bytes: fs.statSync(arquivo).size,
      ms: Date.now() - inicio,
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
      // A janela escolhida vai junto: um erro de carga incremental sem saber com
      // que `:desde` ela rodou é um erro que não dá para reproduzir.
      ...(avisos.length ? { notas: avisos } : {}),
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

/**
 * A entrada de manifesto de um arquivo que já está em disco.
 *
 * Copia do cabeçalho, que é quem manda: `linhas`, `marca` e `modo` são
 * propriedades do arquivo, e o manifesto é só o índice delas.
 */
function entradaDoArquivo(id: string, arquivo: string): EntradaDeManifesto {
  const cab = leCabecalho(arquivo);
  return {
    query: id,
    tabelas: cab.tabelas,
    linhas: cab.linhas,
    colunas: cab.colunas.length,
    bytes: fs.statSync(arquivo).size,
    geradoEm: cab.geradoEm,
    ...(cab.marca ? { marca: cab.marca } : {}),
    ...(cab.modo ? { modo: cab.modo } : {}),
    ...(cab.completoEm ? { completoEm: cab.completoEm } : {}),
  };
}

/**
 * O que já está em disco e continua válido — não se busca de novo sem `--refazer`.
 *
 * `--incremental` esvazia esta lista de propósito: ele existe para **refrescar** o
 * conjunto inteiro barato, e pular o que já está em disco daria um refresh que não
 * refresca. Quem tem política paga só o delta; quem não tem é buscada inteira.
 */
const jaTem = new Map<string, EntradaDeManifesto>();
for (const id of materializaveis) {
  const arquivo = arquivoDaQuery(args.saida, id);
  if (args.refazer || args.incremental || !fs.existsSync(arquivo)) continue;
  try {
    jaTem.set(id, entradaDoArquivo(id, arquivo));
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
if (args.incremental) {
  const comPolitica = aBuscar.filter((id) => politicas.has(id));
  console.log(
    `  --incremental: ${comPolitica.length} com política` +
      (comPolitica.length ? ` (${comPolitica.join(', ')})` : '') +
      `, ${aBuscar.length - comPolitica.length} buscada(s) inteira(s).`,
  );
  if (comPolitica.length === 0) {
    console.log(
      `  Nenhuma das pedidas é incremental — isto vai custar o mesmo que --refazer. ` +
        `As políticas vivem em specs/_catalog/incremental.yaml.`,
    );
  }
}
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
    // Quem decide se a carga é incremental é o filho, olhando o cabeçalho do
    // arquivo — mas a intenção é do pai, e só chega lá por aqui.
    ...(args.incremental ? ['--incremental'] : []),
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
  entradas.push(entradaDoArquivo(r.query, arquivoDaQuery(args.saida, r.query)));
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
      'tamanho'.padStart(11) + 'ms'.padStart(9) + '  modo',
  );
  console.log('-'.repeat(80));
  for (const r of resultados) {
    console.log(
      `${r.ok ? ' ' : '✖'}${r.query.padEnd(27)}${n(r.linhas).padStart(12)}` +
        `${n(r.colunas).padStart(6)}${(r.bytes === null ? '-' : mb(r.bytes)).padStart(11)}` +
        `${String(r.ms).padStart(9)}  ${r.modo ?? '-'}`,
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

// A idade da última carga COMPLETA, por query incremental.
//
// Sai sempre que houver política, e não só quando `--incremental` roda: é a
// pergunta que ninguém faz sozinho e que decide se o conjunto ainda é confiável.
// A incremental não enxerga linha que sumiu da fonte sem deixar data, e o único
// remédio é a completa — então o relógio dela tem de ficar à vista.
const incrementais = manifesto.tabelas.filter((e) => politicas.has(e.query));
if (incrementais.length) {
  console.log('\n── Carga incremental ──');
  for (const e of incrementais) {
    const p = politicas.get(e.query)!;
    const completoEm = e.completoEm ?? e.geradoEm;
    const dias = (Date.now() - new Date(completoEm).getTime()) / 86_400_000;
    const marca = e.marca ? comoDia(new Date(e.marca)) : '(sem marca)';
    const alerta = dias > p.idadeMaximaDias ? '  ← PASSOU DO TETO' : '';
    console.log(
      `  ${e.query.padEnd(28)}${(e.modo ?? 'completo').padEnd(13)}` +
        `marca até ${marca}   última completa há ${dias.toFixed(1)} d ` +
        `(teto ${p.idadeMaximaDias})${alerta}`,
    );
  }
  const vencidas = incrementais.filter((e) => {
    const p = politicas.get(e.query)!;
    return (Date.now() - new Date(e.completoEm ?? e.geradoEm).getTime()) / 86_400_000 > p.idadeMaximaDias;
  });
  if (vencidas.length) {
    console.log(
      `\n  Rode uma carga completa: npm run snapshot -- --query=${vencidas.map((e) => e.query).join(',')} --refazer`,
    );
  }
}

console.log('\n  Contém dado de cliente. O diretório está no .gitignore.');

// ------------------------------------------------- a segunda metade do refresh
//
// **Buscar das fontes é metade do trabalho; a outra metade é congelar o DAX.** As
// tabelas calculadas nascem das que acabaram de ser materializadas, então uma query
// nova as deixa velhas no mesmo instante — e o carregamento tem uma trava contra
// exatamente isso (`packages/snapshot/src/confere.ts`), que responde **HTTP 409** e
// derruba a página inteira.
//
// Era um passo separado que só a memória de quem rodava ligava ao primeiro. Em
// 24/08/2026 as queries foram refeitas às 21:42 e as calculadas ficaram nas 18:41:
// cinco das catorze páginas pararam de abrir, e a mensagem que sobrou para o usuário
// foi "nada está carregando". O comando existia e estava certo; o que faltava era
// alguém lembrar de rodá-lo.
//
// Encadear é a correção. `--sem-calculadas` sai fora para quem está depurando uma
// query só e não quer pagar o congelamento a cada tentativa.
if (!args.semCalculadas && resultados.some((r) => r.ok)) {
  console.log('\n── Congelando as tabelas calculadas (a outra metade do refresh) ──');
  const calc = spawnSync(
    process.execPath,
    [
      ...(args.memoria ? [`--max-old-space-size=${args.memoria}`] : []),
      path.join(ROOT, 'tools', 'snapshot', 'src', 'calculadas.ts'),
      '--todas',
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );
  if (calc.status !== 0) {
    console.error(
      '\nAs queries foram materializadas, mas o congelamento das calculadas FALHOU.\n' +
        'O snapshot está inconsistente e as páginas vão responder 409 até isto rodar:\n' +
        '  npm run snapshot:calculadas -- --todas',
    );
    process.exit(1);
  }
}

process.exit(falhas.length ? 1 : 0);
