// A fila com prioridade funciona? E quanto da fila antiga era só duplicação?
//
// AS DUAS PERGUNTAS SÃO DIFERENTES, e a F2 é a razão de a segunda existir. Antes
// do single-flight, seis pedidos iguais viravam seis cálculos: a fila estava
// cheia de trabalho que não precisava existir, e reordená-la teria sido otimizar
// a duplicação. Esta sonda mede as duas de uma vez —
// `pedidos_<classe>` contra `fila_entradas_<classe>` responde a segunda.
//
// COMO ELA COMPARA. Roda a MESMA carga duas vezes, em duas APIs recém-subidas
// (cache frio, contadores zerados):
//
//   1. `prioridade` — cada pedido declara a sua classe
//   2. `fifo` ....... todo pedido é `interactive`
//
// A rodada 2 não precisa de código desligado: com todos na mesma classe, a fila
// com prioridade É a fila FIFO de antes da F3. O antes/depois sai de um comando
// só, sem editar nada.
//
// A CARGA. Aquecimentos primeiro, e o clique só depois de a fila encher — senão
// não há o que furar. Uma das páginas do clique é uma que já está sendo aquecida,
// de propósito: é o caso em que o clique pega carona num voo de aquecimento e
// herda a posição de fila dele (`voo_herdou_prioridade_pior_interactive`), o
// buraco que a F2 e a F3 abrem juntas.
//
// REGRA DE SAÍDA (a mesma de `npm run paginas`): nunca imprime valor de linha.
// Só id de página, contagem e tempo.
//
// Uso:
//   npm run probe:prioridade-fila
//   npm run probe:prioridade-fila -- --porta=3401 --so=prioridade

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..', '..', '..');

function opcao(prefixo: string, padrao: string): string {
  const arg = process.argv.find((a) => a.startsWith(prefixo));
  return arg ? arg.slice(prefixo.length) : padrao;
}

const PORTA = Number.parseInt(opcao('--porta=', '3401'), 10);
const SO = opcao('--so=', '');

/** Páginas de aquecimento — as que o Aquecedor pediria na subida. */
const AQUECIDAS = [
  'visao-geral',
  'relatorio-do-mes',
  'relatorio-do-ano',
  'diario-instalacao',
  'agendamento-field',
  'protocolos-detalhados',
];
/** O que o usuário clica. `visao-geral` está em AQUECIDAS de propósito. */
const CLICADAS = ['premiacao-instalacao', 'telefonia-ouvidoria', 'visao-geral'];
/** O que o navegador buscaria por antecipação. */
const PREFETCHADAS = ['manutencao-inicial', 'instalacao-reincidente'];

interface Duracao {
  n: number;
  mediaMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}
interface Saude {
  contadores: Record<string, number>;
  duracoes: Record<string, Duracao>;
  piscina: { fila: number; ocupados: number; workers: number; porClasse: number[] };
}

async function saude(): Promise<Saude> {
  const r = await fetch(`http://127.0.0.1:${PORTA}/api/saude`);
  return (await r.json()).realtime as Saude;
}

/** Sobe uma API limpa e espera ela responder. */
async function sobeApi(): Promise<ChildProcess> {
  const filho = spawn(
    process.execPath,
    ['--max-old-space-size=3072', path.join(RAIZ, 'backend', 'api', 'src', 'index.ts')],
    {
      cwd: RAIZ,
      env: {
        ...process.env,
        PORT: String(PORTA),
        SEM_LOGIN: '1',
        SEM_AQUECER: '1',
        SEM_POLLER: '1',
        // O cache de resposta desta rodada tem de ser só desta rodada. Um Redis
        // com a página já quente do run anterior transformaria a segunda tabela
        // em "tudo foi HIT", que não mede fila nenhuma.
        REDIS_URL: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  filho.stdout?.on('data', () => {});
  filho.stderr?.on('data', (d: Buffer) => {
    const t = d.toString().trim();
    if (t) console.error(`    [api] ${t.split('\n')[0]}`);
  });

  const limite = Date.now() + 60_000;
  for (;;) {
    try {
      await saude();
      return filho;
    } catch {
      if (Date.now() > limite) throw new Error('a API não subiu em 60 s');
      await new Promise((ok) => setImmediate(ok));
    }
  }
}

/** Espera uma condição na saúde da própria API — sem cronômetro chutado. */
async function ate(cond: (s: Saude) => boolean, oQue: string, ms = 120_000): Promise<void> {
  const limite = Date.now() + ms;
  for (;;) {
    if (cond(await saude())) return;
    if (Date.now() > limite) throw new Error(`não aconteceu em ${ms} ms: ${oQue}`);
  }
}

interface Pedido {
  pagina: string;
  classe: string;
  ms: number;
  status: number;
  cache: string;
}

async function pede(pagina: string, classe: string, fifo: boolean): Promise<Pedido> {
  // Em FIFO todo pedido é `interactive` — que é exatamente o comportamento de
  // antes da F3, sem precisar desligar código nenhum.
  const declarada = fifo ? 'interactive' : classe;
  const url =
    `http://127.0.0.1:${PORTA}/api/dashboards/${pagina}` +
    (declarada === 'interactive' ? '' : `?origem=${declarada}`);
  const t = Date.now();
  try {
    const r = await fetch(url);
    const corpo = (await r.json()) as { cache?: string };
    return { pagina, classe, ms: Date.now() - t, status: r.status, cache: corpo.cache ?? '-' };
  } catch (err) {
    console.error(`    ! ${pagina}: ${err instanceof Error ? err.message : String(err)}`);
    return { pagina, classe, ms: Date.now() - t, status: 0, cache: '-' };
  }
}

async function rodada(nome: string, fifo: boolean): Promise<void> {
  console.log(`\n${'='.repeat(72)}\n  RODADA: ${nome}\n${'='.repeat(72)}`);
  const api = await sobeApi();
  const t0 = Date.now();
  try {
    // 1) Os aquecimentos entram primeiro e enchem a fila.
    const deFundo = AQUECIDAS.map((p) => pede(p, 'warmup', fifo));

    // 2) O clique só faz sentido DEPOIS de haver fila. Sem isso a sonda mediria
    //    uma fila vazia e concluiria que prioridade não muda nada.
    await ate((s) => s.piscina.fila >= 3, 'a fila de aquecimento encher');
    console.log(`  fila formada em ${((Date.now() - t0) / 1000).toFixed(1)} s — soltando prefetch e cliques`);

    const antecipados = PREFETCHADAS.map((p) => pede(p, 'prefetch', fifo));
    const cliques = CLICADAS.map((p) => pede(p, 'interactive', fifo));

    const todos = await Promise.all([...deFundo, ...antecipados, ...cliques]);
    const s = await saude();

    console.log(`\n  Tempo de parede: ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);

    console.log('  Espera na FILA (ms) — o número que a prioridade existe para baixar');
    console.log('  classe        n    p50    p95    p99    max');
    for (const c of ['interactive', 'prefetch', 'warmup']) {
      const d = s.duracoes[`fila_ms_${c}`];
      if (!d) continue;
      console.log(
        `  ${c.padEnd(12)} ${String(d.n).padStart(2)}  ${String(d.p50Ms).padStart(5)}  ` +
          `${String(d.p95Ms).padStart(5)}  ${String(d.p99Ms).padStart(5)}  ${String(Math.round(d.maxMs)).padStart(6)}`,
      );
    }

    console.log('\n  CÁLCULO (ms) — não muda com prioridade, e é assim que tem de ser');
    console.log('  classe        n    p50    p95    max');
    for (const c of ['interactive', 'prefetch', 'warmup']) {
      const d = s.duracoes[`calculo_ms_${c}`];
      if (!d) continue;
      console.log(
        `  ${c.padEnd(12)} ${String(d.n).padStart(2)}  ${String(d.p50Ms).padStart(5)}  ` +
          `${String(d.p95Ms).padStart(5)}  ${String(Math.round(d.maxMs)).padStart(6)}`,
      );
    }

    console.log('\n  Quanto da fila era DUPLICAÇÃO (pedidos -> tarefas que entraram na fila)');
    for (const c of ['interactive', 'prefetch', 'warmup']) {
      const pedidos = s.contadores[`pedidos_${c}`] ?? 0;
      const entradas = s.contadores[`fila_entradas_${c}`] ?? 0;
      if (pedidos === 0) continue;
      console.log(`  ${c.padEnd(12)} ${pedidos} pedido(s) -> ${entradas} tarefa(s)`);
    }
    console.log(
      `  coalescidos: ${s.contadores.singleflight_coalescidos ?? 0}` +
        `   herdaram fila pior: ${s.contadores.voo_herdou_prioridade_pior_interactive ?? 0}`,
    );

    console.log('\n  Resposta ponta a ponta, por pedido (o que o usuário sente)');
    for (const p of [...todos].sort((a, b) => a.ms - b.ms)) {
      console.log(
        `  ${p.classe.padEnd(12)} ${p.pagina.padEnd(24)} ${String((p.ms / 1000).toFixed(1)).padStart(6)} s` +
          `  ${p.status}  ${p.cache}`,
      );
    }
    const cliqueMax = Math.max(...todos.filter((p) => p.classe === 'interactive').map((p) => p.ms));
    console.log(`\n  >> pior CLIQUE: ${(cliqueMax / 1000).toFixed(1)} s`);
  } finally {
    api.kill();
    await new Promise((ok) => setTimeout(ok, 500));
  }
}

if (SO !== 'fifo') await rodada('prioridade (interactive > prefetch > warmup)', false);
if (SO !== 'prioridade') await rodada('FIFO (todo pedido é interactive) — o de antes da F3', true);
process.exit(0);
