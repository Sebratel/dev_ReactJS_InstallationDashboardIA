// Quanto a API gasta de RAM com N usuários TRABALHANDO no dash ao mesmo tempo.
//
//   npm run probe:carga-usuarios [-- --usuarios=200] [-- --voltas=2] [-- --pagina=visao-geral]
//
// **Por que uma sonda a mais, tendo `probe:memoria-api`.** Aquela responde "qual é o
// MENOR teto com que a API ainda abre as 10 páginas" — bisseção de teto, uma página por
// vez, processo frio. É a régua do CONTRATO. Esta responde outra coisa: "com o contrato
// de produção fixo, até onde o RSS sobe quando 200 pessoas usam o dash juntas". É a
// régua do PICO, e é ela que diz se o `mem_limit` aguenta — a pergunta que um alerta de
// memória faz.
//
// **Usar não é abrir.** Uma sonda que só pede `/api/dashboards/<id>` mede a carga do
// dataset e para aí. Quem trabalha no dash abre segmentação, marca valor, pagina tabela,
// pesquisa e ordena — e cada uma dessas coisas tem caminho próprio na API, com cache
// próprio: a lista de distintos do seletor (`cacheValoresDistintos`), a resposta
// (`CacheDeResposta`) e o resultado inteiro do visual paginável (`CacheDeVisual`). O
// pico mora na combinação, não na abertura. Por isso cada usuário aqui faz uma VOLTA DE
// TRABALHO:
//
//   1. abre a página
//   2. abre uma segmentação  (GET …/valores?tabela=&coluna=)
//   3. marca um valor e refiltra a página   (?filtro=…)
//   4. pagina a maior tabela, já filtrada   (?visual=…&de=200)
//   5. pesquisa dentro dela                 (?visual=…&busca=…)
//   6. ordena por uma coluna                (?visual=…&ordem=…)
//
// e na volta seguinte vai para outra página, como quem navega o menu.
//
// **O que ela imita de produção, e o que não imita.** Sobe a API com os números do
// `Dockerfile` e do `docker-compose.prod.yml` (pai 768, 2 workers × 512, cache de visual
// 128 MB), com o aquecimento ligado, como lá. NÃO imita: o Redis (fica de fora de
// propósito — sem ele o cache de resposta inteiro mora no processo, que é o PIOR caso de
// RAM e o que interessa medir), o `refresh` por baixo, e o processo filho da busca ao
// vivo. Ou seja: o número daqui é o PISO do pico. Em produção soma ainda o filho (até
// 1 GB, um por vez) quando `AO_VIVO_PAGINAS` não está vazia.
//
// REGRA DE SAÍDA: **nunca imprime valor de linha.** A sonda LÊ valores de segmentação
// (precisa deles para marcar um filtro de verdade, que é o que a tela faz), mas eles
// nunca saem no relatório — só id de página, id de visual, contagem, tempo e memória.

import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDashboards } from '../../../packages/widget-engine/src/spec.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..', '..', '..');
const SPECS = path.join(RAIZ, 'backend', 'specs');

const num = (prefixo: string, padrao: number): number => {
  const a = process.argv.find((x) => x.startsWith(prefixo));
  if (!a) return padrao;
  const n = Number.parseInt(a.slice(prefixo.length), 10);
  return Number.isFinite(n) && n > 0 ? n : padrao;
};

const USUARIOS = num('--usuarios=', 200);
const VOLTAS = num('--voltas=', 2);
const PORTA = num('--porta=', 3411);
const RETER_MS = num('--reter-ms=', 8_000);
// O contrato de produção. Mudar aqui é mudar o que está sendo medido — por isso são
// argumentos, e por isso o relatório imprime os três no cabeçalho.
const PAI_MB = num('--pai=', 768);
const WORKERS = num('--workers=', 2);
const HEAP_MB = num('--heap=', 512);
const CACHE_VISUAL_MB = num('--cache-visual=', 128);

/** As páginas do MENU — o que um usuário abre. Fixa de propósito: se uma página entrar
 *  no menu, alguém tem de pôr aqui à mão, e a revisão é o ponto. */
const PAGINAS_MENU = [
  'visao-geral',
  'relatorio-do-mes',
  'relatorio-do-ano',
  'diario-instalacao',
  'agendamento-field',
  'protocolos-detalhados',
  'premiacao-instalacao',
  'telefonia-ouvidoria',
  'manutencao-inicial',
  'instalacao-reincidente',
];
const pedidas = process.argv.filter((a) => a.startsWith('--pagina=')).map((a) => a.slice('--pagina='.length));
const PAGINAS = pedidas.length ? pedidas : PAGINAS_MENU;

// ── o que cada página oferece para "trabalhar" ──────────────────────────────

interface Alvos {
  /** Segmentações da página: (tabela, coluna) que a rota `/valores` aceita. */
  slicers: { tabela: string; coluna: string }[];
  /** Visuais pagináveis — onde paginar, pesquisar e ordenar fazem sentido. */
  tabelas: { id: string; colunas: string[] }[];
}

/** Lê as specs para saber o que clicar em cada página. Derivado, e não uma lista fixa:
 *  uma segmentação que mude de coluna tem de mudar a carga junto, ou a sonda mediria
 *  um caminho que a tela não percorre mais. */
function alvosPorPagina(): Map<string, Alvos> {
  const mapa = new Map<string, Alvos>();
  for (const d of loadDashboards(SPECS)) {
    const slicers: { tabela: string; coluna: string }[] = [];
    const tabelas: { id: string; colunas: string[] }[] = [];
    for (const v of d.visuals ?? []) {
      const campos = (v.fields ?? []) as { kind?: string; entity?: string; property?: string; name?: string }[];
      if (v.type === 'slicer' || v.type === 'advancedSlicerVisual') {
        const c = campos.find((x) => x.kind === 'column' && x.entity && x.property);
        if (c) slicers.push({ tabela: c.entity!, coluna: c.property! });
      }
      if (v.type === 'tableEx' || v.type === 'pivotTable') {
        const colunas = campos.filter((x) => x.name).map((x) => x.name!);
        if (v.id) tabelas.push({ id: v.id, colunas });
      }
    }
    mapa.set(d.id, { slicers, tabelas });
  }
  return mapa;
}

// ── medição ─────────────────────────────────────────────────────────────────

/** A forma de `GET /api/saude` que interessa aqui. Os números por DONO moram em
 *  `memoria.processo` e `memoria.workers[]` (ver `memoria-da-saude.ts`); `rssMB` e
 *  `heapUsedMB` ficam repetidos no topo, que é o que as sondas antigas leem. */
interface MedidaIsolate {
  heapUsedMB?: number;
  heapLimiteMB?: number;
  externalMB?: number;
  arrayBuffersMB?: number;
}
interface MedidaWorker extends MedidaIsolate {
  threadId?: number;
  datasets?: number;
  visuais?: { itens: number; mb: number };
  /** Algumas versões aninham a medida; a sonda aceita as duas formas. */
  medida?: MedidaWorker;
}
interface Saude {
  memoria?: {
    rssMB?: number;
    heapUsedMB?: number;
    processo?: MedidaIsolate & { rssMB?: number };
    workers?: MedidaWorker[];
    recriacaoDeWorkers?: unknown;
    caches?: {
      respostas?: number | null;
      respostasTeto?: unknown;
      valoresDistintos?: number;
      paginasCarregadas?: number;
      visuais?: { itens: number; mb: number };
    };
  };
  aquecimento?: { ativo?: boolean; pronto?: boolean };
}

function estaEncerrado(p: ChildProcess): boolean {
  return p.exitCode !== null || p.signalCode !== null;
}

async function saude(porta: number): Promise<Saude | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${porta}/api/saude`, { signal: AbortSignal.timeout(3_000) });
    return r.ok ? ((await r.json()) as Saude) : null;
  } catch {
    return null;
  }
}

/** Uma linha do que cada dono gasta — é o que separa "o processo usa 2 GB" de "a worker
 *  2 segura 700 MB de arrayBuffers", que são consertos diferentes. */
function detalheDaMemoria(s: Saude): string {
  const m = s.memoria;
  if (!m) return '(sem bloco memoria)';
  const p = m.processo ?? {};
  const n = (x: number | undefined): string => (x === undefined ? '?' : String(x));
  const partes = [
    `pai heap ${n(p.heapUsedMB ?? m.heapUsedMB)}/${n(p.heapLimiteMB)} ext ${n(p.externalMB)} ab ${n(p.arrayBuffersMB)}`,
  ];
  for (const bruto of m.workers ?? []) {
    // Aceita a medida no próprio objeto ou aninhada em `.medida`.
    const w = { ...bruto, ...(bruto.medida ?? {}) };
    partes.push(
      `w${n(w.threadId)} heap ${n(w.heapUsedMB)}/${n(w.heapLimiteMB)} ext ${n(w.externalMB)} ` +
        `ab ${n(w.arrayBuffersMB)} ds ${n(w.datasets)} vis ${w.visuais?.itens ?? 0}/${w.visuais?.mb ?? 0}MB`,
    );
  }
  const c = m.caches;
  if (c) {
    partes.push(
      `caches resp ${c.respostas ?? '?'} val ${c.valoresDistintos ?? '?'} ` +
        `pag ${c.paginasCarregadas ?? '?'} vis ${c.visuais?.itens ?? 0}/${c.visuais?.mb ?? 0}MB`,
    );
  }
  return partes.join('\n                       ');
}

async function esperaSaude(porta: number, proc: ChildProcess, tetoMs = 180_000): Promise<boolean> {
  const limite = Date.now() + tetoMs;
  while (Date.now() < limite) {
    if (estaEncerrado(proc)) return false;
    if (await saude(porta)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

interface Passo {
  etapa: string;
  ok: boolean;
  ms: number;
  erro?: string;
}

/**
 * O IP que este usuário "tem" para o limitador de taxa.
 *
 * **Sem isto a sonda mede o limitador, não a memória.** `LIMITE_API_POR_MINUTO` é 300
 * por IP (`servidor.ts`), e 200 usuários saindo todos de 127.0.0.1 estouram a cota nos
 * primeiros segundos: a primeira versão desta sonda devolveu 1800 de 2100 passos em
 * HTTP 429 e um RSS que não queria dizer nada. Em produção cada pessoa tem seu IP, e a
 * API o enxerga porque o compose põe `CONFIA_PROXY: '1'` e o nginx manda `X-Real-IP`
 * (`ipDoPedido`, `limitador-taxa.ts`). A sonda sobe a API do mesmo jeito e faz o papel
 * do nginx — é o que torna a carga comparável ao que acontece lá.
 */
function ipDoUsuario(i: number): string {
  return `10.${Math.floor(i / 65536) % 256}.${Math.floor(i / 256) % 256}.${i % 256}`;
}

/** Uma volta de trabalho de um usuário numa página. */
async function umaVolta(porta: number, pagina: string, alvos: Alvos, semente: number): Promise<Passo[]> {
  const feitos: Passo[] = [];
  const base = `http://127.0.0.1:${porta}/api/dashboards/${pagina}`;
  const cabecalhos = { 'X-Real-IP': ipDoUsuario(semente) };

  const vai = async (etapa: string, url: string): Promise<unknown | null> => {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { headers: cabecalhos, signal: AbortSignal.timeout(180_000) });
      const ms = Date.now() - t0;
      if (!r.ok) {
        feitos.push({ etapa, ok: false, ms, erro: `HTTP ${r.status}` });
        return null;
      }
      const corpo = (await r.json()) as { visuais?: unknown[]; valores?: unknown[] };
      // Só a FORMA entra no veredito; nenhum valor de linha sai daqui.
      const ok = Array.isArray(corpo.visuais) ? corpo.visuais.length > 0 : Array.isArray(corpo.valores);
      feitos.push({ etapa, ok, ms, ...(ok ? {} : { erro: 'resposta sem conteúdo' }) });
      return corpo;
    } catch (e) {
      feitos.push({ etapa, ok: false, ms: Date.now() - t0, erro: (e as Error).message.slice(0, 60) });
      return null;
    }
  };

  // 1. abre a página
  await vai('abre', base);

  // 2. abre uma segmentação
  const slicer = alvos.slicers.length ? alvos.slicers[semente % alvos.slicers.length]! : null;
  let filtro = '';
  if (slicer) {
    const q = `tabela=${encodeURIComponent(slicer.tabela)}&coluna=${encodeURIComponent(slicer.coluna)}`;
    const corpo = (await vai('abre filtro', `${base}/valores?${q}`)) as { valores?: unknown[] } | null;
    // 3. marca um valor e refiltra. O valor é LIDO e usado, nunca impresso.
    const lista = Array.isArray(corpo?.valores) ? corpo!.valores! : [];
    const escolhido = lista.length ? lista[semente % lista.length] : undefined;
    const valor = (escolhido as { valor?: unknown })?.valor ?? escolhido;
    if (valor !== undefined && valor !== null) {
      filtro = `&filtro=${encodeURIComponent(
        JSON.stringify({ tabela: slicer.tabela, coluna: slicer.coluna, valores: [valor] }),
      )}`;
      await vai('aplica filtro', `${base}?${filtro.slice(1)}`);
    }
  }

  // 4-6. trabalha na maior tabela da página: pagina, pesquisa, ordena.
  const tabela = alvos.tabelas.length ? alvos.tabelas[semente % alvos.tabelas.length]! : null;
  if (tabela) {
    const v = `visual=${encodeURIComponent(tabela.id)}`;
    await vai('pagina', `${base}?${v}&de=200&linhas=200${filtro}`);
    // Um termo curto e estável: o que importa é o caminho do filtro de texto sobre o
    // resultado inteiro, não casar com uma linha específica.
    await vai('pesquisa', `${base}?${v}&busca=a&linhas=200${filtro}`);
    // `?ordem=` espera o ÍNDICE da coluna, não o nome: `/^(\d{1,3}):(asc|desc)$/`
    // (`servidor.ts`). Mandar o nome devolve 400 — foi o que a primeira versão desta
    // sonda fez, e as 4 falhas apareceram como se a rota estivesse quebrada.
    if (tabela.colunas.length) {
      const iCol = semente % tabela.colunas.length;
      await vai('ordena', `${base}?${v}&ordem=${iCol}:desc&linhas=200${filtro}`);
    }
  }

  return feitos;
}

function percentil(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.floor((p / 100) * o.length))]!;
}

async function main(): Promise<void> {
  const alvos = alvosPorPagina();

  console.log(`\nCarga de ${USUARIOS} usuários TRABALHANDO ao mesmo tempo — pico de RAM da API`);
  console.log(`  contrato: pai ${PAI_MB} MB + ${WORKERS}w × ${HEAP_MB} MB, cache de visual ${CACHE_VISUAL_MB} MB`);
  console.log(`  ${VOLTAS} volta(s) × ${USUARIOS} usuários sobre ${PAGINAS.length} página(s) do menu`);
  console.log(`  cada volta: abre · abre filtro · aplica filtro · pagina · pesquisa · ordena`);
  console.log(`  sem Redis (pior caso de RAM); o filho da busca ao vivo NÃO entra — em produção soma até 1 GB\n`);

  const proc = spawn(
    process.execPath,
    [`--max-old-space-size=${PAI_MB}`, '--expose-gc', 'backend/api/src/index.ts', '--sem-poller', '--sem-login'],
    {
      cwd: RAIZ,
      env: {
        ...process.env,
        PORT: String(PORTA),
        API_WORKERS: String(WORKERS),
        API_WORKER_HEAP_MB: String(HEAP_MB),
        CACHE_VISUAL_MB: String(CACHE_VISUAL_MB),
        // Sem isto todo pedido levaria 401 antes de tocar a piscina, e a sonda mediria o
        // portão, não o cálculo. NÃO toca o .env. Mesma justificativa de `memoria-api.ts`.
        GOOGLE_CLIENT_ID: '',
        SEM_LOGIN: '1',
        // Como em produção (compose): a API confia no proxy e lê `X-Real-IP`. É o que
        // faz o limitador de taxa contar POR USUÁRIO e não por processo da sonda.
        CONFIA_PROXY: '1',
        // Sem Redis de propósito: o cache de resposta inteiro mora no processo, que é o
        // pior caso de RAM — o que esta sonda existe para achar.
        REDIS_URL: '',
        // O ao vivo pede o SRD, que daqui pode nem responder; e o filho dele é medido à
        // parte. Vazio = a API serve tudo pelo snapshot.
        AO_VIVO_PAGINAS: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let stderr = '';
  proc.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString();
  });
  proc.stdout?.resume();

  let pico = { rssMB: 0, emT: 0, detalhe: '' };
  const serie: number[] = [];
  const t0Geral = Date.now();
  const amostra = setInterval(() => {
    if (estaEncerrado(proc)) return;
    void saude(PORTA).then((s) => {
      const rss = s?.memoria?.rssMB ?? 0;
      if (rss === 0) return;
      serie.push(rss);
      if (rss > pico.rssMB) pico = { rssMB: rss, emT: Date.now() - t0Geral, detalhe: detalheDaMemoria(s!) };
    });
  }, 500);

  if (!(await esperaSaude(PORTA, proc))) {
    clearInterval(amostra);
    console.log(`A API não subiu. Fim do stderr:\n${stderr.slice(-2000)}`);
    proc.kill();
    process.exitCode = 1;
    return;
  }

  const sSubiu = await saude(PORTA);
  console.log(
    `  API no ar. RSS ao subir: ${sSubiu?.memoria?.rssMB ?? '?'} MB` +
      `  (aquecimento ${sSubiu?.aquecimento?.pronto ? 'pronto' : 'em curso'})\n`,
  );

  const todos: Passo[] = [];
  for (let volta = 1; volta <= VOLTAS; volta++) {
    const t0 = Date.now();
    const lote = Array.from({ length: USUARIOS }, (_, i) => {
      const pagina = PAGINAS[(i + volta) % PAGINAS.length]!;
      return umaVolta(PORTA, pagina, alvos.get(pagina) ?? { slicers: [], tabelas: [] }, i);
    });
    const res = (await Promise.all(lote)).flat();
    todos.push(...res);
    const ok = res.filter((r) => r.ok).length;
    const ms = res.map((r) => r.ms);
    const sNow = await saude(PORTA);
    console.log(
      `  volta ${volta}: ${ok}/${res.length} passos OK em ${((Date.now() - t0) / 1000).toFixed(1)}s` +
        `  p50 ${percentil(ms, 50)}ms  p95 ${percentil(ms, 95)}ms` +
        `  RSS agora ${sNow?.memoria?.rssMB ?? '?'} MB`,
    );
    if (estaEncerrado(proc)) {
      console.log(`  *** O PROCESSO MORREU na volta ${volta} ***`);
      break;
    }
  }

  // Segura um pouco: o pico costuma vir DEPOIS da última resposta, com o lixo ainda não
  // coletado e os caches recém-cheios.
  if (RETER_MS > 0 && !estaEncerrado(proc)) await new Promise((r) => setTimeout(r, RETER_MS));
  clearInterval(amostra);

  const falhas = todos.filter((r) => !r.ok);
  const ms = todos.map((r) => r.ms);
  console.log(`\n=== RESULTADO ===`);
  console.log(`  passos             ${todos.length - falhas.length}/${todos.length} OK`);
  console.log(
    `  latência           p50 ${percentil(ms, 50)} ms   p95 ${percentil(ms, 95)} ms   pior ${Math.max(0, ...ms)} ms`,
  );
  console.log(`  RSS pico           ${pico.rssMB} MB   (aos ${(pico.emT / 1000).toFixed(1)}s)`);
  console.log(`  RSS mediano        ${percentil(serie, 50)} MB`);
  console.log(`  no instante do pico: ${pico.detalhe}`);
  console.log(`\n  contra mem_limit 3072 MB: ${((pico.rssMB / 3072) * 100).toFixed(0)}% — e falta somar o filho do ao vivo`);

  console.log(`\n  por etapa (p95):`);
  for (const etapa of ['abre', 'abre filtro', 'aplica filtro', 'pagina', 'pesquisa', 'ordena']) {
    const sos = todos.filter((t) => t.etapa === etapa);
    if (!sos.length) continue;
    const okN = sos.filter((s) => s.ok).length;
    console.log(
      `    ${etapa.padEnd(14)} ${String(okN).padStart(4)}/${String(sos.length).padEnd(4)} OK   ` +
        `p50 ${String(percentil(sos.map((s) => s.ms), 50)).padStart(6)} ms   p95 ${String(percentil(sos.map((s) => s.ms), 95)).padStart(6)} ms`,
    );
  }

  if (falhas.length) {
    const porErro = new Map<string, number>();
    for (const f of falhas) porErro.set(`${f.etapa}: ${f.erro ?? '?'}`, (porErro.get(`${f.etapa}: ${f.erro ?? '?'}`) ?? 0) + 1);
    console.log(`\n  falhas por motivo:`);
    for (const [e, n] of [...porErro].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`    ${String(n).padStart(4)}× ${e}`);
    }
  }

  const recusas = [...stderr.matchAll(/\[cache-visual[^\]]*\] (\S+) não coube: ([\d.]+) MB/g)];
  if (recusas.length) {
    const porChave = new Map<string, string>();
    for (const m of recusas) porChave.set(m[1]!, m[2]!);
    console.log(`\n  recusas do cache de visual (não cabem no teto, recalculam a cada clique):`);
    for (const [chave, mbs] of porChave) console.log(`    ${mbs} MB  ${chave}`);
  }
  if (/OUT_OF_MEMORY|Allocation failed|heap out of memory/i.test(stderr)) {
    console.log(`\n  *** ESTOURO DE HEAP no stderr ***`);
  }

  if (!estaEncerrado(proc)) {
    proc.kill();
    await once(proc, 'exit').catch(() => undefined);
  }
}

await main();
