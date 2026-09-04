#!/usr/bin/env node
// `npm run bench:carga` — onde o tempo de carregar o snapshot vai, degrau por degrau.
//
// **A pergunta que este programa responde.** `docs/DECISAO-DESEMPENHO.md` fecha com uma
// pendência explícita: *"Falta agora quebrar o que sobrou dos 25,6 s entre `JSON.parse` e
// conversão de tipo; é essa medida que decide se o passo 5 vale alguma coisa."* O passo 5
// é trocar o formato do arquivo. Trocar formato de arquivo é caro e irreversível, e até
// aqui ninguém sabia quanto do custo de carga é `parse` — quer dizer, ninguém sabia se o
// passo 5 compra 60% ou 6%. `npm run paginas` mede o total da carga; este mede as partes.
//
// **Como ele mede: escada cumulativa, não instrumentação.** Cada degrau faz tudo o que o
// anterior fazia e mais uma coisa. O custo de uma etapa é a diferença entre dois degraus.
// A alternativa — cravar `performance.now()` dentro de `le()` — custaria tempo no caminho
// de produção para medir o tempo do caminho de produção, e 1,46 milhão de chamadas de
// relógio não são de graça.
//
//   e1 io      ler os bytes do disco e decodificar utf-8
//   e2 linhas  + partir em linhas (readline)
//   e3 parse   + JSON.parse de cada linha, descartando o resultado
//   e4 monta   + montar o objeto da linha (decodifica: data, coluna mista)
//   e5 retem   = `le()` de verdade — igual ao e4, mas guardando as linhas
//   e6 tipos   + `aplicaTiposDeclarados` sobre as linhas retidas
//   e7 adota   + `dataset.adotaTabela`
//
// **O degrau 5 é o código de produção, e é isso que segura a escada honesta.** e1..e4 são
// uma réplica do laço de `le()`; e5 chama `le()`. Como e5 ⊃ e4, `e5 < e4` só pode
// significar que a réplica divergiu — e o programa reclama quando isso acontece, em vez de
// publicar uma decomposição que não descreve mais o carregamento.
//
// **O que ele não mede, e é preciso dizer.** Não há disco frio aqui: os arquivos ficam no
// cache de arquivos do Windows depois da primeira leitura, e esvaziá-lo não é coisa que um
// benchmark deva fazer na máquina de alguém. Todo número abaixo é *arquivo em cache do
// SO*, que é também o caso comum da API depois do `npm run aquece`. O `--paginas` mede a
// 1ª e a 2ª carga do mesmo processo justamente para o efeito aparecer em vez de ser
// alegado.
//
// REGRA DE SAÍDA, a mesma de `npm run paginas`: nunca imprime valor de linha. Só nome de
// arquivo, de tabela, de coluna, contagem e tempo. `field-agenda` tem endereço de cliente,
// e a saída daqui precisa ser segura para colar em ticket.
//
// Uso:
//   npm run bench:carga                          # a escada, nos arquivos até 100 MB
//   npm run bench:carga -- --arquivo=contratos   # só estes (aceita lista)
//   npm run bench:carga -- --pesado              # inclui field-agenda (1 GB, ~8 GB de heap)
//   npm run bench:carga -- --repete=5            # melhor de N por degrau (padrão 3)
//   npm run bench:carga -- --paginas             # carga ponta a ponta, por página
//   npm run bench:carga -- --paginas --pagina=diario-instalacao
//   npm run bench:carga -- --json                # a mesma medição, para guardar

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { getHeapStatistics } from 'node:v8';
import { Dataset } from '../../../packages/measure-engine/src/dataset.ts';
import { SemanticModel, normalizeName } from '../../../packages/semantic-model/src/model.ts';
import { loadDashboards, type DashboardSpec } from '../../../packages/widget-engine/src/spec.ts';
import { aplicaTiposDeclarados, carrega } from '../../../packages/snapshot/src/carrega.ts';
import {
  bytesDescomprimidos,
  decodifica,
  ehArquivoDeSnapshot,
  fluxoDeLeitura,
  le,
  leCabecalho,
  semSufixo,
  type CabecalhoDeSnapshot,
  type Escalar,
} from '../../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery, DIRETORIO_PADRAO, leManifesto } from '../../../packages/snapshot/src/manifesto.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = path.join(ROOT, DIRETORIO_PADRAO);

/**
 * Acima disto o arquivo só entra com `--pesado`.
 *
 * Não é medo de demorar: `field-agenda` tem 448 MB descomprimidos e sete degraus dele
 * são sete leituras. Os degraus que retêm as linhas pedem ~8 GB de heap, e nesta
 * máquina (16 GB) rodar isso sem pedir é decidir pelo usuário que a máquina dele pode
 * parar.
 *
 * **O teto é medido DESCOMPRIMIDO** (`bytesDescomprimidos`), e isso é o conserto de um
 * defeito que a compressão criou: `field-agenda` passou a ocupar 14,6 MB em disco, e um
 * teto sobre o tamanho do arquivo o deixaria entrar — o guarda continuaria lá, sem
 * guardar nada. Medido em 04/09/2026: com o teto em bytes de disco, as três páginas que
 * tocam `field-agenda` deixaram de ser barradas e a 2ª carga delas passou a rodar.
 */
const TETO_PADRAO = 100 * 1024 * 1024;

// ----------------------------------------------------------------- argumentos

const args = process.argv.slice(2);
const json = args.includes('--json');
const pesado = args.includes('--pesado');
const modoPaginas = args.includes('--paginas');
const lista = (prefixo: string): string[] =>
  args
    .filter((a) => a.startsWith(prefixo))
    .flatMap((a) => a.slice(prefixo.length).split(',').map((s) => s.trim()))
    .filter(Boolean);
const arquivosPedidos = lista('--arquivo=');
const paginasPedidas = lista('--pagina=');
const repete = Number(args.find((a) => a.startsWith('--repete='))?.slice('--repete='.length) ?? 3);

for (const a of args) {
  const ok = ['--json', '--pesado', '--paginas'].includes(a) ||
    ['--arquivo=', '--pagina=', '--repete='].some((p) => a.startsWith(p));
  if (!ok) {
    console.error(`argumento desconhecido: ${a}`);
    process.exit(2);
  }
}
if (!Number.isInteger(repete) || repete < 1) {
  console.error(`--repete= tem de ser inteiro >= 1, veio '${repete}'`);
  process.exit(2);
}
if (!fs.existsSync(DIR)) {
  console.error(`snapshot não existe em ${DIR}. Rode: npm run snapshot`);
  process.exit(2);
}

// ------------------------------------------------------------------- medição

/**
 * Melhor de N, não a média.
 *
 * A média mede o benchmark competindo com o resto da máquina; o mínimo mede o trabalho
 * quando ninguém atrapalhou, que é a única das duas grandezas que não muda de valor
 * porque alguém abriu o navegador no meio. As `n` execuções ficam registradas para o
 * espalhamento aparecer — se o mínimo e o máximo diferirem muito, a medição não presta e
 * quem lê precisa poder ver isso.
 */
async function melhorDe<T>(n: number, f: () => Promise<T>): Promise<{ ms: number; pior: number; valor: T }> {
  let ms = Infinity;
  let pior = 0;
  let valor!: T;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    valor = await f();
    const d = performance.now() - t0;
    if (d < ms) ms = d;
    if (d > pior) pior = d;
  }
  return { ms, pior, valor };
}

/** As chaves normalizadas do cabeçalho, como `le()` as calcula. */
function chaves(cab: CabecalhoDeSnapshot): string[] {
  return cab.colunas.map((c) => normalizeName(c.nome));
}

// -------------------------------------------------------------- os degraus

/**
 * e1 — só os bytes, pela MESMA abertura que `le()` usa (`fluxoDeLeitura`): utf-8
 * direto no arquivo cru, `gunzip` no comprimido. Somando o que chega.
 *
 * A abertura tem de ser a mesma, e não parecida. Enquanto esta função abria o arquivo
 * à mão, um snapshot comprimido caía aqui como bytes de gzip lidos como texto — os
 * sete degraus erravam com `JSON.parse` reclamando de `\uFFFD`, e o `e5 < e4` que
 * denuncia réplica divergente não pegava, porque nenhum degrau chegava a medir.
 */
async function e1io(arquivo: string): Promise<number> {
  let n = 0;
  for await (const pedaco of fluxoDeLeitura(arquivo)) {
    n += typeof pedaco === 'string' ? pedaco.length : (pedaco as Buffer).length;
  }
  return n;
}

/** e2 — + partir em linhas. Mesmo `readline` e mesmo `crlfDelay` de `le()`. */
async function e2linhas(arquivo: string): Promise<number> {
  const rl = readline.createInterface({
    input: fluxoDeLeitura(arquivo),
    crlfDelay: Infinity,
  });
  let n = 0;
  for await (const texto of rl) if (texto !== '') n++;
  return n;
}

/** e3 — + `JSON.parse`, descartando. O `void` existe para o V8 não apagar o trabalho. */
async function e3parse(arquivo: string): Promise<number> {
  const rl = readline.createInterface({
    input: fluxoDeLeitura(arquivo),
    crlfDelay: Infinity,
  });
  let n = 0;
  for await (const texto of rl) {
    if (texto === '') continue;
    const v = JSON.parse(texto) as unknown;
    if (v === undefined) throw new Error('inalcançável');
    n++;
  }
  return n;
}

/** e4 — + montar o objeto da linha, descartando-o. É o laço de `le()` sem o `push`. */
async function e4monta(arquivo: string): Promise<number> {
  const rl = readline.createInterface({
    input: fluxoDeLeitura(arquivo),
    crlfDelay: Infinity,
  });
  let cab: CabecalhoDeSnapshot | null = null;
  let ks: string[] = [];
  let n = 0;
  for await (const texto of rl) {
    if (texto === '') continue;
    if (cab === null) {
      cab = JSON.parse(texto) as CabecalhoDeSnapshot;
      ks = chaves(cab);
      continue;
    }
    n++;
    const valores = JSON.parse(texto) as unknown[];
    const linha: Record<string, Escalar> = {};
    for (let i = 0; i < ks.length; i++) {
      linha[ks[i]!] = decodifica(valores[i], cab.colunas[i]!.tipo, `${arquivo}:${n}`);
    }
    if (linha === undefined) throw new Error('inalcançável');
  }
  return n;
}

interface Degrau {
  nome: string;
  /** Cumulativo: o tempo do degrau inteiro, não o da etapa. */
  ms: number;
  pior: number;
}

interface MedidaDeArquivo {
  arquivo: string;
  tabela: string | null;
  bytes: number;
  linhas: number;
  colunas: number;
  degraus: Degrau[];
  /** Colunas que `aplicaTiposDeclarados` converteu no e6. */
  convertidas: number;
  /** Heap retido pelas linhas do e5, em bytes. */
  heap: number;
  repeticoes: number;
  nota: string | null;
}

async function medeArquivo(
  arquivo: string,
  model: SemanticModel,
  n: number,
): Promise<MedidaDeArquivo> {
  const cab = leCabecalho(arquivo);
  const bytes = fs.statSync(arquivo).size;
  // O cabeçalho lista as tabelas do modelo que carregam deste arquivo. Hoje é sempre
  // uma; se um dia forem duas, os degraus 6 e 7 medem a primeira e a nota diz qual.
  const nomeTabela = cab.tabelas[0] ?? null;
  const tabela = nomeTabela ? model.table(nomeTabela) : undefined;

  const io = await melhorDe(n, () => e1io(arquivo));
  const linhas = await melhorDe(n, () => e2linhas(arquivo));
  const parse = await melhorDe(n, () => e3parse(arquivo));
  const monta = await melhorDe(n, () => e4monta(arquivo));
  const retem = await melhorDe(n, () => le(arquivo));

  const degraus: Degrau[] = [
    { nome: 'io', ms: io.ms, pior: io.pior },
    { nome: 'linhas', ms: linhas.ms, pior: linhas.pior },
    { nome: 'parse', ms: parse.ms, pior: parse.pior },
    { nome: 'monta', ms: monta.ms, pior: monta.pior },
    { nome: 'retem', ms: retem.ms, pior: retem.pior },
  ];

  // O e6 e o e7 consomem as linhas do último `le()`, e cada repetição as gastaria: a
  // conversão de tipo é destrutiva (escreve na linha), então rodá-la duas vezes mediria
  // a segunda vez convertendo o que já estava convertido. Uma medição só, e dita.
  const antes = process.memoryUsage().heapUsed;
  let convertidas = 0;
  if (tabela) {
    const t0 = performance.now();
    // `suprimir` vazio: a supressão do `preservaEspecieDeJuncao` depende das duas pontas
    // do relacionamento estarem carregadas, o que aqui não acontece — só há uma tabela.
    // Então este degrau é o **teto** da conversão, e não o que a página faz quando ela
    // preserva uma junção. A diferença é o custo de N colunas a menos, nunca a mais.
    convertidas = aplicaTiposDeclarados(tabela, retem.valor.cabecalho, retem.valor.linhas).length;
    degraus.push({ nome: 'tipos', ms: retem.ms + (performance.now() - t0), pior: 0 });

    const t1 = performance.now();
    new Dataset().adotaTabela(tabela.name, retem.valor.linhas as never);
    degraus.push({
      nome: 'adota',
      ms: degraus[degraus.length - 1]!.ms + (performance.now() - t1),
      pior: 0,
    });
  }
  const heap = Math.max(0, process.memoryUsage().heapUsed - antes);

  const notas: string[] = [];
  // A folga não é frouxidão: em arquivo de milissegundo o relógio tem granularidade da
  // ordem da medição, e um `e4 > e5` de 0,2 ms é ruído, não divergência. O guarda existe
  // para pegar réplica que ficou para trás de `le()` — coisa que aparece em porcentagem
  // do tempo, não em fração de milissegundo.
  if (monta.ms > retem.ms * 1.02 && monta.ms - retem.ms > 1) {
    notas.push(
      `e4 (${monta.ms.toFixed(0)} ms) ficou acima do e5 (${retem.ms.toFixed(0)} ms), e e5 faz ` +
        `tudo o que e4 faz mais guardar as linhas: a réplica de e1..e4 divergiu de le() ` +
        `— a decomposição abaixo não descreve mais o carregamento`,
    );
  }
  if (cab.tabelas.length > 1) {
    notas.push(`o arquivo alimenta ${cab.tabelas.length} tabelas; e6/e7 medem '${nomeTabela}'`);
  }
  if (!tabela && nomeTabela) {
    notas.push(`'${nomeTabela}' não existe no modelo — sem e6/e7`);
  }
  if (cab.linhas === 0) notas.push('arquivo sem linhas: os degraus medem só o cabeçalho');

  return {
    arquivo: path.basename(arquivo),
    tabela: nomeTabela,
    bytes,
    linhas: cab.linhas,
    colunas: cab.colunas.length,
    degraus,
    convertidas,
    heap,
    repeticoes: n,
    nota: notas.length ? notas.join('; ') : null,
  };
}

// -------------------------------------------------------- carga por página

interface MedidaDePagina {
  pagina: string;
  primeira: number;
  segunda: number;
  semProjecao: number | null;
  linhas: number;
  tabelas: number;
  omitidas: number;
  congeladas: number;
  recalculadas: number;
  erro: string | null;
  pulou: string | null;
}

/** As queries que a página alcança e que passam do teto — o que o `--pesado` libera. */
function pesadasDaPagina(bytesPorQuery: Map<string, number>, queries: readonly string[]): string[] {
  return queries.filter((q) => (bytesPorQuery.get(q) ?? 0) > TETO_PADRAO);
}

async function medePagina(
  dash: DashboardSpec,
  model: SemanticModel,
  bytesPorQuery: Map<string, number>,
  agora: Date,
): Promise<MedidaDePagina> {
  const base: MedidaDePagina = {
    pagina: dash.id,
    primeira: 0,
    segunda: 0,
    semProjecao: null,
    linhas: 0,
    tabelas: 0,
    omitidas: 0,
    congeladas: 0,
    recalculadas: 0,
    erro: null,
    pulou: null,
  };
  try {
    const t0 = performance.now();
    const c = await carrega({ dir: DIR, model, dashboards: [dash], now: agora });
    const primeira = performance.now() - t0;

    // A escala do que esta página carrega só se conhece **depois** de carregá-la — o
    // plano sai do fechamento, não do spec. Então o teto do `--pesado` é conferido aqui,
    // e o que ele barra é a repetição e o `projetar: false`, não a primeira carga.
    const pesadas = pesadasDaPagina(bytesPorQuery, c.plano.queries);
    const barra = !pesado && pesadas.length > 0;

    let segunda = 0;
    let semProjecao: number | null = null;
    if (!barra) {
      const t1 = performance.now();
      await carrega({ dir: DIR, model, dashboards: [dash], now: agora });
      segunda = performance.now() - t1;

      const t2 = performance.now();
      await carrega({ dir: DIR, model, dashboards: [dash], now: agora, projetar: false });
      semProjecao = performance.now() - t2;
    }

    return {
      ...base,
      primeira,
      segunda,
      semProjecao,
      linhas: [...c.linhasPorTabela.values()].reduce((a, n) => a + n, 0),
      tabelas: c.linhasPorTabela.size,
      omitidas: c.omitidas.length,
      congeladas: c.congeladas.length,
      recalculadas: c.recalculadas.length,
      pulou: barra ? `2ª carga e sem-projeção puladas: ${pesadas.join(', ')} passa(m) do teto (--pesado)` : null,
    };
  } catch (err) {
    return { ...base, erro: err instanceof Error ? err.message.split('. ')[0] + '.' : String(err) };
  }
}

// --------------------------------------------------------------------- saída

const mb = (b: number): number => b / (1024 * 1024);
const num = (v: number, casas = 0): string => v.toLocaleString('pt-BR', {
  minimumFractionDigits: casas,
  maximumFractionDigits: casas,
});

/**
 * Tempo com casas o bastante para não virar `0`.
 *
 * Arredondar tudo para milissegundo inteiro faz a etapa de 0,4 ms aparecer como zero, e
 * zero numa tabela de custo se lê como "não custa" em vez de "custa menos que a régua".
 */
const ms = (v: number): string =>
  v >= 100 ? num(v) : v >= 10 ? num(v, 1) : num(v, 2);

/** O ambiente da medição. Sem ele, o número não é comparável com o de amanhã. */
function ambiente(): Record<string, string | number> {
  const cpus = os.cpus();
  return {
    node: process.version,
    cpu: cpus[0]?.model ?? '?',
    nucleos: cpus.length,
    ramTotalGB: Number(mb(os.totalmem() / 1024).toFixed(1)),
    ramLivreGB: Number(mb(os.freemem() / 1024).toFixed(1)),
    // O teto de heap do processo — é ele que decide se `field-agenda` cabe, e
    // `--max-old-space-size` só é legível por aqui.
    heapTetoMB: Math.round(mb(getHeapStatistics().heap_size_limit)),
    snapshot: DIR,
  };
}

// -------------------------------------------------------------------- correr

const model = SemanticModel.fromSpecsDir(path.join(ROOT, 'specs'));
const manifesto = leManifesto(DIR);
// Do DISCO e descomprimido, não do `bytes` do manifesto: aquele campo é a pegada em
// disco (é o que o operador quer ver), e o teto precisa da grandeza que prediz heap.
const bytesPorQuery = new Map(
  (manifesto?.tabelas ?? []).map((t) => {
    const arq = arquivoDaQuery(DIR, t.query);
    return [t.query, fs.existsSync(arq) ? bytesDescomprimidos(arq) : t.bytes] as const;
  }),
);

if (modoPaginas) {
  const todas = loadDashboards(path.join(ROOT, 'specs')) as DashboardSpec[];
  const invalidas = paginasPedidas.filter((p) => !todas.some((d) => d.id === p));
  if (invalidas.length) {
    console.error(`páginas que não existem: ${invalidas.join(', ')}`);
    process.exit(2);
  }
  const alvo = paginasPedidas.length ? todas.filter((d) => paginasPedidas.includes(d.id)) : todas;
  // O mesmo relógio para todas: 25 das 121 expressões chamam `TODAY()`, e uma varredura
  // que atravessasse a meia-noite mediria duas bases diferentes. É a regra do
  // `npm run paginas`, e ela vale igual aqui.
  const agora = new Date();

  const medidas: MedidaDePagina[] = [];
  for (const dash of alvo) {
    process.stderr.write(`  ${dash.id}… `);
    const m = await medePagina(dash, model, bytesPorQuery, agora);
    medidas.push(m);
    process.stderr.write(m.erro ? 'não carregou\n' : `${num(m.primeira)} ms\n`);
  }

  if (json) {
    console.log(JSON.stringify({ modo: 'paginas', ambiente: ambiente(), medidas }, null, 2));
  } else {
    console.log(`\n${'página'.padEnd(24)}${'tabelas'.padStart(8)}${'linhas'.padStart(12)}` +
      `${'1ª carga'.padStart(11)}${'2ª carga'.padStart(11)}${'s/ projeção'.padStart(13)}${'omitidas'.padStart(10)}`);
    console.log('-'.repeat(89));
    for (const m of medidas) {
      if (m.erro) {
        console.log(`✖${m.pagina.padEnd(23)}${'—'.padStart(8)}${'—'.padStart(12)}${'—'.padStart(11)}${'—'.padStart(11)}${'—'.padStart(13)}${'—'.padStart(10)}`);
        continue;
      }
      console.log(
        ` ${m.pagina.padEnd(23)}${num(m.tabelas).padStart(8)}${num(m.linhas).padStart(12)}` +
          `${(num(m.primeira) + ' ms').padStart(11)}` +
          `${(m.segunda ? num(m.segunda) + ' ms' : '—').padStart(11)}` +
          `${(m.semProjecao === null ? '—' : num(m.semProjecao) + ' ms').padStart(13)}` +
          `${num(m.omitidas).padStart(10)}`,
      );
    }

    const ok = medidas.filter((m) => !m.erro);
    const comAmbas = ok.filter((m) => m.semProjecao !== null && m.segunda);
    if (comAmbas.length) {
      const ganho = comAmbas.reduce((a, m) => a + (m.semProjecao! - m.segunda), 0);
      const total = comAmbas.reduce((a, m) => a + m.semProjecao!, 0);
      console.log(
        `\n  A projeção de colunas poupa ${num(ganho)} ms de ${num(total)} ms ` +
          `(${num((ganho / total) * 100, 1)}%) nas ${comAmbas.length} páginas em que as duas cargas rodaram.`,
      );
    }
    const recalc = ok.filter((m) => m.recalculadas > 0);
    if (recalc.length) {
      console.log(`  ${recalc.length} página(s) recalcularam tabela congelada — o tempo delas inclui DAX, não só carga.`);
    }
    for (const m of medidas.filter((x) => x.pulou)) console.log(`  ${m.pagina}: ${m.pulou}`);
    for (const m of medidas.filter((x) => x.erro)) console.log(`  ${m.pagina}: ${m.erro}`);
    console.log('\n  Arquivo em cache do SO nas três colunas. Não há disco frio nesta medição.\n');
  }
  process.exit(medidas.some((m) => m.erro) ? 1 : 0);
}

// ------------------------------------------------------- modo escada (padrão)

const todosArquivos = fs
  .readdirSync(DIR)
  .filter(ehArquivoDeSnapshot)
  .sort();
const invalidos = arquivosPedidos.filter(
  (p) => !todosArquivos.some((f) => f === p || semSufixo(f) === semSufixo(p)),
);
if (invalidos.length) {
  console.error(`arquivos que não existem no snapshot: ${invalidos.join(', ')}`);
  process.exit(2);
}

const escolhidos = (
  arquivosPedidos.length
    ? todosArquivos.filter((f) => arquivosPedidos.some((p) => f === p || semSufixo(f) === semSufixo(p)))
    : todosArquivos
).map((f) => ({
  f,
  bytes: fs.statSync(path.join(DIR, f)).size,
  // O teto compara ESTE, não `bytes`: ver `TETO_PADRAO`.
  crus: bytesDescomprimidos(path.join(DIR, f)),
}));

// Pedir o arquivo pelo nome é pedir para medi-lo: o teto só filtra a varredura.
const pulados = arquivosPedidos.length
  ? []
  : escolhidos.filter((x) => !pesado && x.crus > TETO_PADRAO);
const alvo = escolhidos.filter((x) => !pulados.includes(x)).sort((a, b) => b.crus - a.crus);

const medidas: MedidaDeArquivo[] = [];
for (const { f, bytes, crus } of alvo) {
  // Um arquivo de 1 GB × 5 degraus × `repete` leituras vira dezenas de minutos. Acima do
  // teto a repetição cai para 1, e a coluna `n` da saída diz que caiu.
  const n = crus > TETO_PADRAO ? 1 : repete;
  process.stderr.write(`  ${f} (${num(mb(crus), 1)} MB crus, n=${n})… `);
  try {
    const m = await medeArquivo(path.join(DIR, f), model, n);
    medidas.push(m);
    process.stderr.write(`${num(m.degraus[m.degraus.length - 1]!.ms)} ms\n`);
  } catch (err) {
    process.stderr.write(`ERRO: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}\n`);
  }
  // As linhas do arquivo anterior não têm mais dono, e o próximo arquivo pode ser grande.
  if (globalThis.gc) globalThis.gc();
}

if (json) {
  console.log(JSON.stringify({ modo: 'escada', ambiente: ambiente(), teto: TETO_PADRAO, medidas }, null, 2));
} else {
  const a = ambiente();
  console.log(`\nnode ${a.node} · ${a.nucleos} núcleos · ${a.ramTotalGB} GB de RAM (${a.ramLivreGB} GB livres) · heap ${a.heapTetoMB} MB`);
  console.log(`${a.cpu}`);
  console.log(`snapshot: ${DIR}\n`);

  // A tabela mostra a **etapa**, não o degrau: a diferença entre dois degraus é o que
  // alguém pode ir otimizar. O cumulativo fica no `--json`, para conferência.
  console.log(
    'arquivo'.padEnd(30) + 'MB'.padStart(8) + 'linhas'.padStart(11) + 'n'.padStart(3) +
      'io'.padStart(9) + 'linhas'.padStart(9) + 'parse'.padStart(9) + 'monta'.padStart(9) +
      'retem'.padStart(9) + 'tipos'.padStart(9) + 'adota'.padStart(9) + 'total'.padStart(10),
  );
  console.log('-'.repeat(134));

  const etapasDe = (m: MedidaDeArquivo): Map<string, number> => {
    const fora = new Map<string, number>();
    let anterior = 0;
    for (const d of m.degraus) {
      fora.set(d.nome, Math.max(0, d.ms - anterior));
      anterior = d.ms;
    }
    return fora;
  };

  const soma = new Map<string, number>();
  let bytesTotal = 0;
  let linhasTotal = 0;
  for (const m of medidas) {
    const e = etapasDe(m);
    const total = m.degraus[m.degraus.length - 1]!.ms;
    bytesTotal += m.bytes;
    linhasTotal += m.linhas;
    for (const [k, v] of e) soma.set(k, (soma.get(k) ?? 0) + v);
    const cel = (k: string): string =>
      (e.has(k) ? ms(e.get(k)!) : '—').padStart(9);
    console.log(
      semSufixo(m.arquivo).slice(0, 29).padEnd(30) +
        num(mb(m.bytes), 1).padStart(8) + num(m.linhas).padStart(11) +
        String(m.repeticoes).padStart(3) +
        cel('io') + cel('linhas') + cel('parse') + cel('monta') + cel('retem') +
        cel('tipos') + cel('adota') + (ms(total) + ' ms').padStart(11),
    );
  }

  console.log('-'.repeat(134));
  const totalGeral = [...soma.values()].reduce((x, y) => x + y, 0);
  console.log(
    'TOTAL'.padEnd(30) + num(mb(bytesTotal), 1).padStart(8) + num(linhasTotal).padStart(11) +
      ''.padStart(3) +
      ['io', 'linhas', 'parse', 'monta', 'retem', 'tipos', 'adota']
        .map((k) => ms(soma.get(k) ?? 0).padStart(9)).join('') +
      (ms(totalGeral) + ' ms').padStart(11),
  );

  console.log('\n── Onde o tempo vai ──');
  const ordenadas = [...soma.entries()].sort((x, y) => y[1] - x[1]);
  const legenda: Record<string, string> = {
    io: 'ler os bytes do disco e decodificar utf-8',
    linhas: 'partir em linhas (readline)',
    parse: 'JSON.parse de cada linha',
    monta: 'montar o objeto da linha (decodifica)',
    retem: 'guardar as linhas no array (alocação e GC)',
    tipos: 'aplicaTiposDeclarados — a conversão do tipo declarado',
    adota: 'adotaTabela — conferir chave normalizada e adotar',
  };
  for (const [k, v] of ordenadas) {
    const pct = totalGeral ? (v / totalGeral) * 100 : 0;
    const barra = '█'.repeat(Math.max(0, Math.round(pct / 2)));
    console.log(`  ${k.padEnd(8)}${num(pct, 1).padStart(6)}%  ${barra.padEnd(50)} ${legenda[k]}`);
  }
  console.log(
    `\n  ${num(mb(bytesTotal), 1)} MB e ${num(linhasTotal)} linhas em ${num(totalGeral)} ms ` +
      `— ${num(mb(bytesTotal) / (totalGeral / 1000), 1)} MB/s, ` +
      `${num((totalGeral * 1e6) / Math.max(1, linhasTotal))} ns por linha.`,
  );

  const convertem = medidas.filter((m) => m.convertidas > 0);
  if (convertem.length) {
    console.log(
      `\n  ${convertem.length} arquivo(s) têm coluna que declara um tipo e chega noutro ` +
        `(${convertem.reduce((x, m) => x + m.convertidas, 0)} colunas no total) — é o que 'tipos' mede.`,
    );
  }

  const comNota = medidas.filter((m) => m.nota);
  if (comNota.length) {
    console.log('\n── Notas ──');
    for (const m of comNota) console.log(`  ${m.arquivo}: ${m.nota}`);
  }

  if (pulados.length) {
    console.log(
      `\n── Fora da medição (acima de ${num(mb(TETO_PADRAO))} MB DESCOMPRIMIDOS; ` +
        `use --pesado ou --arquivo=) ──`,
    );
    for (const p of [...pulados].sort((x, y) => y.crus - x.crus)) {
      console.log(
        `  ${semSufixo(p.f).padEnd(30)}${num(mb(p.crus), 1).padStart(9)} MB crus` +
          `${p.crus === p.bytes ? '' : ` (${num(mb(p.bytes), 1)} MB em disco)`}`,
      );
    }
  }

  console.log('\n  Arquivo em cache do SO. Melhor de n execuções por degrau, não a média.');
  console.log('  As colunas são etapas (degrau menos o anterior); o cumulativo está no --json.\n');
}

process.exit(0);
