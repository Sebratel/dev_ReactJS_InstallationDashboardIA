#!/usr/bin/env node
// `npm run run:mlayer` — roda a camada M contra as fontes REAIS.
//
// É o ponto onde as três peças se encontram: o Query Registry diz qual query
// existe, o Query Engine busca as linhas (com cache, timeout e read-only), e o
// Transform Engine executa os passos de Power Query. Até aqui o runner de M só
// tinha rodado com linhas sintéticas; isto é a primeira execução com dado de
// verdade, e é o começo da paridade da Fase 2b.9.
//
// UMA QUERY POR PROCESSO. O avaliador de M mantém **todos** os passos vivos ao
// mesmo tempo — em M qualquer passo pode citar qualquer outro, então o escopo não
// pode liberar nenhum antes do fim — e cada passo é uma tabela inteira. Rodar 21
// queries num processo estourou o heap em 4 GB (medido). Com um processo por
// query, a memória volta ao sistema entre uma e outra e uma query grande derruba
// só a si mesma, em vez de matar o relatório inteiro.
//
// REGRA DE SAÍDA: nunca imprime valor de linha. Só id, contagem, nome de coluna e
// tempo. `QUADRO FUNCIONAL` tem CPF e RG, e `field-agenda` tem endereço de
// cliente — a saída daqui precisa ser segura para colar em ticket.
//
// Uso:
//   npm run run:mlayer -- --only=capacidade-equipe
//   npm run run:mlayer -- --all
//   npm run run:mlayer -- --all --memoria=8192      # heap por query, em MB
//   npm run run:mlayer -- --only=protocolos-geral --colunas
//   npm run run:mlayer -- --only=protocolos-produtividade --passos  # linhas por passo
//   npm run run:mlayer -- --only=contratos --em-processo   # sem subprocesso (depurar)
//   npm run run:mlayer -- --only=protocolos-geral --timeout=1800    # segundos por query

import { spawn } from 'node:child_process';
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
import { buscadorWeb } from '../../../packages/query-engine/src/connectors-web.ts';
import { QueryEngine } from '../../../packages/query-engine/src/engine.ts';
import {
  accessToken,
  readServiceAccount,
  SCOPE_SHEETS_READONLY,
} from '../../../packages/query-engine/src/google-auth.ts';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import { leJuncoes, reconciliadorDe } from '../../../packages/semantic-model/src/juncoes.ts';
import type { Connector, ResolvedQuery } from '../../../packages/query-engine/src/types.ts';
import { fonteDoEngine } from '../../../packages/transform-engine/src/fonte.ts';
import { runQueries, usaFonteExterna } from '../../../packages/transform-engine/src/runner.ts';
import { isTable } from '../../../packages/transform-engine/src/value.ts';
import { isTable } from '../../../packages/transform-engine/src/value.ts';
import { rowCountComparable, scanM } from '../../../tools/validate/src/mlayer.ts';
import { argvDoFilho, ErroDeArgumento, parseArgs, type Args } from './args.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);

/** Prefixo da linha de resultado do filho. Só ela é dado; o resto é log. */
const MARCA = '##MRUN##';

/**
 * Nenhuma query fica fora hoje.
 *
 * `clima-tempo` ficava: define função dentro de `let` e lê `Web.Contents`, que não
 * tinha connector. As duas coisas passaram a existir (achado #42), então a lista
 * está vazia — e continua aqui porque a próxima query que a fonte não alcançar vai
 * querer o mesmo mecanismo, com o motivo escrito ao lado.
 */
const FORA_DO_ESCOPO = new Set<string>();

// ------------------------------------------------------------------ argumentos
interface Args {
  only: string[];
  all: boolean;
  colunas: boolean;
  passos: boolean;
  memoria: number | null;
  emProcesso: boolean;
  /** Modo filho: roda exatamente esta query e imprime uma linha de JSON. */
  one: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    only: [],
    all: false,
    colunas: false,
    passos: false,
    memoria: null,
    emProcesso: false,
    one: null,
  };
  for (const raw of argv) {
    if (raw === '--all') args.all = true;
    else if (raw === '--colunas') args.colunas = true;
    else if (raw === '--passos') args.passos = true;
    else if (raw === '--passos') args.passos = true;
    else if (raw === '--em-processo') args.emProcesso = true;
    else if (raw.startsWith('--only=')) {
      args.only = raw.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (raw.startsWith('--one=')) args.one = raw.slice('--one='.length);
    else if (raw.startsWith('--memoria=')) {
      const n = Number.parseInt(raw.slice('--memoria='.length), 10);
      if (!Number.isFinite(n) || n < 256) {
        console.error('--memoria espera MB (mínimo 256)');
        process.exit(2);
      }
      args.memoria = n;
    } else {
      console.error(`argumento desconhecido: ${raw}`);
      process.exit(2);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

// ------------------------------------------------------------------ catálogo
const registry = QueryRegistry.fromSpecsDir(path.join(ROOT, 'specs'));
const cfg = loadConfig();

/** Culture do modelo. Sem ela, todo passo texto→data erra alto — e deve errar. */
const culture = (
  yaml.parse(
    fs.readFileSync(path.join(ROOT, 'specs', '_catalog', 'model.yaml'), 'utf8'),
  ) as { culture?: string | null }
).culture ?? null;

const todas = registry.list().filter((q) => q.m_expression && !FORA_DO_ESCOPO.has(q.id));

/**
 * Quais mesclagens mortas podem comparar a chave como inteiro — decisão humana em
 * `specs/_catalog/juncoes.yaml`.
 *
 * O `tools/snapshot` injeta isto desde o #64; aqui faltava, e o efeito era pior que
 * "faltou um recurso": as duas ferramentas rodam a MESMA camada M e davam diagnóstico
 * diferente. `run:mlayer` reportava como morta a junção de `N°PROTOCOLO` que o
 * `snapshot` reconcilia por decisão registrada — alarme falso justamente na
 * ferramenta que se usa para investigar. Achado #73.
 */
const reconcilia = reconciliadorDe(leJuncoes(path.join(ROOT, 'specs')));

/** rowCount do SQL, gravado pelo `npm run validate:queries`. */
function linhasDoGolden(id: string): number | null {
  const p = path.join(ROOT, 'specs', 'golden', `${id}.golden.json`);
  if (!fs.existsSync(p)) return null;
  return (JSON.parse(fs.readFileSync(p, 'utf8')) as { rowCount?: number }).rowCount ?? null;
}

interface Resultado {
  id: string;
  ok: boolean;
  linhasDaFonte: number | null;
  linhasFinais: number | null;
  colunas: string[];
  passos: number;
  ms: number;
  /** Tempo dentro do connector (banco/rede/HTTP), somando todas as buscas. */
  msExecute?: number;
  /** Tempo convertendo `Row[]` em valor de M, somando todas as buscas. */
  msConversao?: number;
  /** Linhas lidas de fonte, somando todas as buscas — o divisor de linhas/s. */
  linhasLidas?: number;
  erro?: string;
  /** Divergência de contagem que o M **não** explica. */
  alerta?: string;
  /**
   * O que a avaliação da camada M precisou dizer — hoje, junção que não casou nada.
   *
   * Vazio é o normal. Elas atravessam o subprocesso junto com o resto do resultado
   * porque a decisão de #64 é que quem executa a camada M **tem** de imprimi-las: uma
   * mescla morta devolvia 87.805 nulos calada.
   */
  notas?: string[];
  /**
   * Contagem de linha de **cada passo de tabela**, na ordem em que o M os declara.
   * Só é preenchida com `--passos`, porque a lista tem 60 itens nas queries grandes.
   *
   * Serve para responder *qual passo* mudou a contagem — que é a pergunta de toda
   * investigação de paridade. `protocolos-produtividade` sai de 33.746 linhas de
   * fonte e termina com 65.257: sem isto, saber se a diferença é o `Table.Combine`
   * ou a mesclagem que multiplica linha (ACHADOS #25) exige ler 60 passos de M e
   * adivinhar.
   */
  passosDetalhe?: { nome: string; linhas: number }[];
}

// ------------------------------------------------------------- conectar fontes
async function montaConnectors(
  precisa: ReadonlySet<string>,
): Promise<{ connectors: Map<string, Connector>; fechar: (() => Promise<void>)[]; avisos: string[] }> {
  const connectors = new Map<string, Connector>();
  const fechar: (() => Promise<void>)[] = [];
  const avisos: string[] = [];

  // O teto de tempo é desta execução, não do `.env`: ver TIMEOUT_PADRAO_S em `args.ts`.
  // Sem isto, `protocolos-produtividade` era cancelada pelo servidor aos 30 s — a query
  // mais cara do corpus, na ferramenta que existe para investigar a camada M.
  const statementTimeoutMs = args.segundos * 1000;

  if (precisa.has('dbVoalle')) {
    const falta = missingFor('voalle');
    if (falta.length) avisos.push(`dbVoalle: falta no .env ${falta.join(', ')}`);
    else {
      const pool = await createVoallePool({ ...cfg.voalle, statementTimeoutMs });
      connectors.set('dbVoalle', createVoalleConnector(pool));
      fechar.push(() => pool.end());
    }
  }
  if (precisa.has('dbMaria')) {
    const falta = missingFor('maria');
    if (falta.length) avisos.push(`dbMaria: falta no .env ${falta.join(', ')}`);
    else {
      const pool = await createMariaPool({ ...cfg.maria, statementTimeoutMs });
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
      avisos.push(`gsheets: ${err instanceof Error ? err.message : err}`);
    }
  }
  return { connectors, fechar, avisos };
}

/**
 * Datasources que a query e suas dependências usam.
 *
 * O fechamento importa: `PROTOCOLOS PRODUTIVIDADE` é `dbVoalle` na spec e mescla
 * com `QUADRO FUNCIONAL`, que é planilha. Mas o contrário também: rodar
 * `--only=consolidado-clientes` não deve abrir pool no MariaDB nem ler a
 * credencial do Google, e sem o fechamento a alternativa preguiçosa seria conectar
 * em tudo sempre.
 */
function fontesDe(id: string): Set<string> {
  const porNome = new Map(todas.map((q) => [q.name, q]));
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
  const inicial = todas.find((q) => q.id === id);
  if (inicial) anda(inicial);
  return fontes;
}

// ------------------------------------------------------------------ execução
async function rodaUma(q: ResolvedQuery): Promise<Resultado> {
  const inicio = Date.now();
  // Dependência de outra query também busca fonte, então o connector dela precisa
  // existir — daí o fechamento, e não só o datasource desta query.
  const { connectors, fechar, avisos } = await montaConnectors(fontesDe(q.id));
  for (const a of avisos) console.error(`  aviso: ${a}`);

  const engine = new QueryEngine({ registry, connectors, cache: new MemoryCache() });
  const buscas = new Map<string, number>();
  // Somado sobre TODAS as buscas da execução, não só a desta query: rodar
  // `protocolos-produtividade` puxa a fonte das queries que ela cita, e esse tempo é
  // tempo dela. Separar por query aqui daria a impressão de que ela é rápida.
  let msExecute = 0;
  let msConversao = 0;
  let linhasLidas = 0;
  // Allowlist só do que ESTA query declara. Passar os endpoints de todas as
  // queries daria a `clima-tempo` alcance que o PBIP não deu a ela.
  let buscasWeb = 0;
  const web = q.endpoints?.length
    ? buscadorWeb({
        permitidos: q.endpoints,
        onBusca: (e) => {
          buscasWeb++;
          msExecute += e.ms;
        },
      })
    : undefined;
  const fonte = fonteDoEngine(engine, {
    onBusca: (e) => {
      if (e.linhas !== undefined) {
        buscas.set(e.id, e.linhas);
        linhasLidas += e.linhas;
      }
      msExecute += e.msExecute ?? 0;
      msConversao += e.msConversao ?? 0;
    },
  });

  try {
    const feitas = await runQueries({
      specs: todas,
      apenas: [q.id],
      culture,
      fonte,
      web,
      reconcilia,
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
      // desta execução.
    }

    return {
      id: q.id,
      ok: true,
      linhasDaFonte: daFonte,
      linhasFinais: r.tabela.rowCount,
      colunas: [...r.tabela.columns],
      passos: r.passos.size,
      ms: Date.now() - inicio,
      msExecute,
      msConversao,
      linhasLidas,
      alerta,
      // O `tools/snapshot` imprime as notas desde o #64; este aqui as engolia. É a
      // ferramenta de INVESTIGAR a camada M — rodar `--only=protocolos-geral` para
      // entender uma junção morta e não ver a nota que a explica é o oposto do que
      // ela existe para fazer. Achado #73.
      notas: r.notas.map((n) => `${n.fn} ${n.assunto}: ${n.mensagem}`),
      // Só passo que **é** tabela entra: `let` também guarda escalar e lista, e
      // "linhas" não quer dizer nada para eles.
      passosDetalhe: args.passos
        ? [...r.passos].flatMap(([nome, v]) =>
            isTable(v) ? [{ nome, linhas: v.rowCount }] : [],
          )
        : undefined,
    };
  } catch (err) {
    return {
      id: q.id,
      ok: false,
      linhasDaFonte: buscas.get(q.id) ?? null,
      linhasFinais: null,
      colunas: [],
      passos: 0,
      ms: Date.now() - inicio,
      erro: err instanceof Error ? err.message : String(err),
    };
  } finally {
    for (const f of fechar) await f().catch(() => {});
  }
}

// ------------------------------------------------------------------ modo filho
if (args.one) {
  const q = todas.find((x) => x.id === args.one);
  if (!q) {
    console.error(`id não existe ou está fora do escopo: ${args.one}`);
    process.exit(2);
  }
  const r = await rodaUma(q);
  console.log(MARCA + JSON.stringify(r));
  process.exit(0);
}

// ------------------------------------------------------------------- modo pai
if (!args.all && args.only.length === 0) {
  console.error(
    'Escolha o que rodar: --only=id1,id2 ou --all.\n' +
      'Não há default de propósito: --all puxa a base inteira das fontes reais.',
  );
  process.exit(2);
}

const pedidas = args.all ? todas : todas.filter((q) => args.only.includes(q.id));
const idsInvalidos = args.only.filter((id) => !todas.some((q) => q.id === id));
if (idsInvalidos.length) {
  console.error(`ids que não existem (ou estão fora do escopo): ${idsInvalidos.join(', ')}`);
  process.exit(2);
}

console.log(
  `\nRodando ${pedidas.length} query(s) com culture=${culture ?? '(nenhuma)'}` +
    `${args.emProcesso ? ' no mesmo processo' : ', uma por processo'}` +
    `${args.memoria ? `, heap de ${args.memoria} MB` : ''}`,
);

// O teto de tempo é impresso sempre, e com o número que ele substituiu. Trocar o
// valor do `.env` calado seria pior que o timeout: quem lê a saída precisa poder
// dizer se a query demorou ou se a régua era outra.
{
  const doEnv = Math.round(cfg.voalle.statementTimeoutMs / 1000);
  console.log(
    `  statement_timeout de ${args.segundos}s nesta execução` +
      (doEnv !== args.segundos
        ? ` (o .env traz ${doEnv}s — teto de pedido de tela, não de materialização; --timeout= manda)`
        : ''),
  );
}
console.log('');

/** Roda uma query num subprocesso e devolve o resultado que ele imprimiu. */
async function rodaEmSubprocesso(q: ResolvedQuery): Promise<Resultado> {
  const inicio = Date.now();
  const argv = argvDoFilho(args, q.id, fileURLToPath(import.meta.url));
  return new Promise((resolve) => {
    const filho = spawn(process.execPath, argv, { cwd: ROOT });
    let saida = '';
    let erro = '';
    filho.stdout.on('data', (d: Buffer) => {
      saida += d.toString();
    });
    filho.stderr.on('data', (d: Buffer) => {
      erro += d.toString();
    });
    filho.on('close', (code, signal) => {
      const linha = saida.split(/\r?\n/).find((l) => l.startsWith(MARCA));
      if (linha) {
        resolve(JSON.parse(linha.slice(MARCA.length)) as Resultado);
        return;
      }
      // Sem linha de resultado: o processo morreu antes de terminar. O caso real é
      // heap estourado — dizer isso poupa a caçada ao stack trace de V8.
      const semMemoria = /heap out of memory|Ineffective mark-compacts/.test(erro);
      resolve({
        id: q.id,
        ok: false,
        linhasDaFonte: null,
        linhasFinais: null,
        colunas: [],
        passos: 0,
        ms: Date.now() - inicio,
        erro: semMemoria
          ? `estourou o heap do processo${args.memoria ? ` (${args.memoria} MB)` : ''}. ` +
            'O avaliador guarda todos os passos vivos: tente --memoria=8192.'
          : `processo terminou sem resultado (código ${code}, sinal ${signal}): ` +
            erro.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ').slice(0, 300),
      });
    });
  });
}

const resultados: Resultado[] = [];
for (const q of pedidas) {
  process.stderr.write(`  ${q.id}… `);
  const r = args.emProcesso ? await rodaUma(q) : await rodaEmSubprocesso(q);
  process.stderr.write(`${r.ok ? 'ok' : 'FALHOU'} (${r.ms} ms)\n`);
  resultados.push(r);
}

// ------------------------------------------------------------------ relatório
const n = (v: number | null): string => (v === null ? '-' : v.toLocaleString('pt-BR'));

console.log(
  '\n' + 'id'.padEnd(28) + 'fonte'.padStart(12) + 'final'.padStart(12) +
    'cols'.padStart(6) + 'passos'.padStart(8) + 'ms'.padStart(9),
);
console.log('-'.repeat(75));
for (const r of resultados) {
  console.log(
    `${r.ok ? ' ' : '✖'}${r.id.padEnd(27)}${n(r.linhasDaFonte).padStart(12)}` +
      `${n(r.linhasFinais).padStart(12)}${String(r.colunas.length).padStart(6)}` +
      `${String(r.passos).padStart(8)}${String(r.ms).padStart(9)}`,
  );
}

// Onde o tempo vai, que é a pergunta que decide o que otimizar. `M` sai por
// subtração (total − fonte − conversão): é o tempo de avaliar os passos, e é o
// único que não some ligando um cache na frente.
{
  const somaveis = resultados.filter((r) => r.ok && r.msExecute !== undefined);
  if (somaveis.length) {
    const sum = (f: (r: Resultado) => number): number => somaveis.reduce((a, r) => a + f(r), 0);
    const total = sum((r) => r.ms);
    const exec = sum((r) => r.msExecute ?? 0);
    const conv = sum((r) => r.msConversao ?? 0);
    const linhas = sum((r) => r.linhasLidas ?? 0);
    const pct = (x: number): string => (total ? `${Math.round((x / total) * 100)}%` : '—');
    console.log('\n── Onde o tempo vai ──');
    console.log(`  fonte (banco/rede):  ${n(exec).padStart(9)} ms  ${pct(exec).padStart(4)}`);
    console.log(`  conversão de linha:  ${n(conv).padStart(9)} ms  ${pct(conv).padStart(4)}`);
    console.log(
      `  avaliação de M:      ${n(total - exec - conv).padStart(9)} ms  ${pct(total - exec - conv).padStart(4)}`,
    );
    console.log(`  ${n(linhas)} linhas lidas de fonte`);
    // Os 3 mais lentos, porque otimizar a média não faz ninguém esperar menos.
    const piores = [...somaveis].sort((a, b) => b.ms - a.ms).slice(0, 3);
    for (const r of piores) {
      const m = r.ms - (r.msExecute ?? 0) - (r.msConversao ?? 0);
      console.log(
        `    ${r.id.padEnd(26)} ${n(r.ms).padStart(7)} ms = ${n(r.msExecute ?? 0)} fonte` +
          ` + ${n(r.msConversao ?? 0)} conversão + ${n(m)} M`,
      );
    }
  }
}

// Onde o tempo vai, que é a pergunta que decide o que otimizar. `M` sai por
// subtração (total − fonte − conversão): é o tempo de avaliar os passos, e é o
// único que não some ligando um cache na frente.
{
  const somaveis = resultados.filter((r) => r.ok && r.msExecute !== undefined);
  if (somaveis.length) {
    const sum = (f: (r: Resultado) => number): number => somaveis.reduce((a, r) => a + f(r), 0);
    const total = sum((r) => r.ms);
    const exec = sum((r) => r.msExecute ?? 0);
    const conv = sum((r) => r.msConversao ?? 0);
    const linhas = sum((r) => r.linhasLidas ?? 0);
    const pct = (x: number): string => (total ? `${Math.round((x / total) * 100)}%` : '—');
    console.log('\n── Onde o tempo vai ──');
    console.log(`  fonte (banco/rede):  ${n(exec).padStart(9)} ms  ${pct(exec).padStart(4)}`);
    console.log(`  conversão de linha:  ${n(conv).padStart(9)} ms  ${pct(conv).padStart(4)}`);
    console.log(
      `  avaliação de M:      ${n(total - exec - conv).padStart(9)} ms  ${pct(total - exec - conv).padStart(4)}`,
    );
    console.log(`  ${n(linhas)} linhas lidas de fonte`);
    // Os 3 mais lentos, porque otimizar a média não faz ninguém esperar menos.
    const piores = [...somaveis].sort((a, b) => b.ms - a.ms).slice(0, 3);
    for (const r of piores) {
      const m = r.ms - (r.msExecute ?? 0) - (r.msConversao ?? 0);
      console.log(
        `    ${r.id.padEnd(26)} ${n(r.ms).padStart(7)} ms = ${n(r.msExecute ?? 0)} fonte` +
          ` + ${n(r.msConversao ?? 0)} conversão + ${n(m)} M`,
      );
    }
  }
}

const falhas = resultados.filter((r) => !r.ok);
const alertas = resultados.filter((r) => r.alerta);

if (args.colunas) {
  for (const r of resultados.filter((x) => x.ok)) {
    console.log(`\n${r.id} (${r.colunas.length} colunas):\n  ${r.colunas.join(', ')}`);
  }
}

if (args.passos) {
  for (const r of resultados.filter((x) => x.passosDetalhe?.length)) {
    console.log(`\n── ${r.id}: linhas por passo ──`);
    let anterior: number | null = null;
    for (const p of r.passosDetalhe!) {
      // A seta só aparece quando o passo MUDA a contagem, que é o que se procura.
      // Sem isso a lista de 60 passos obriga a comparar número a número na tela.
      const delta =
        anterior === null || p.linhas === anterior
          ? ''
          : `  ← ${p.linhas > anterior ? '+' : ''}${n(p.linhas - anterior)}`;
      console.log(`  ${n(p.linhas).padStart(11)}  ${p.nome}${delta}`);
      anterior = p.linhas;
    }
  }
}

if (args.passos) {
  for (const r of resultados.filter((x) => x.passosDetalhe?.length)) {
    console.log(`\n── ${r.id}: linhas por passo ──`);
    let anterior: number | null = null;
    for (const p of r.passosDetalhe!) {
      // A seta só aparece quando o passo MUDA a contagem, que é o que se procura.
      // Sem isso a lista de 60 passos obriga a comparar número a número na tela.
      const delta =
        anterior === null || p.linhas === anterior
          ? ''
          : `  ← ${p.linhas > anterior ? '+' : ''}${n(p.linhas - anterior)}`;
      console.log(`  ${n(p.linhas).padStart(11)}  ${p.nome}${delta}`);
      anterior = p.linhas;
    }
  }
}

// Antes dos alertas e das falhas de propósito: uma junção morta costuma ser a CAUSA
// de uma contagem estranha, então ler a nota primeiro é ler na ordem em que ajuda.
const comNotas = resultados.filter((r) => r.notas?.length);
if (comNotas.length) {
  console.log('\n── O que a camada M precisou dizer ──');
  for (const r of comNotas) {
    for (const nota of r.notas!) console.log(`  ${r.id}: ${nota}`);
  }
}

if (alertas.length) {
  console.log('\n── Contagem que o M não explica ──');
  for (const r of alertas) console.log(`  ${r.id}: ${r.alerta}`);
}

if (falhas.length) {
  console.log('\n── Falhas ──');
  for (const r of falhas) {
    const dica = linhasDoGolden(r.id);
    console.log(`  ${r.id}${dica ? ` (${dica.toLocaleString('pt-BR')} linhas no SQL)` : ''}: ${r.erro}`);
  }
}

console.log(
  `\n${resultados.length - falhas.length}/${resultados.length} rodaram inteiras` +
    `${alertas.length ? `, ${alertas.length} com contagem suspeita` : ''}.`,
);
process.exit(falhas.length || alertas.length ? 1 : 0);
