// Quanta memória a API precisa DE VERDADE — por bisseção do próprio teto.
//
// POR QUE NÃO MEDIR RSS E PRONTO. Foi o que a medição de 04/09/2026 fez, e o
// número (6.625 MB depois de 14 páginas) responde à pergunta errada: RSS é heap
// crescido e não devolvido ao SO, então ele mede o teto que foi AUTORIZADO, não
// o que foi NECESSÁRIO. Com `maxOldGenerationSizeMb: 8192` por worker, o V8 não
// tem motivo para coletar antes disso — o RSS sobe até onde deixarem. Pior: numa
// máquina que já está paginando (esta, 1,7 GB livres de 15,7 GB), o RSS ainda
// MENTE PARA BAIXO, porque o SO tira páginas do processo.
//
// O QUE ESTA SONDA FAZ. Aperta o teto e vê o que quebra. Sobe a API com um par
// (nº de workers, heap por worker), pede as páginas do menu uma a uma, e anota
// se todas passaram. O menor teto que passa é a demanda real — número que
// sobrevive a paginação, porque `ERR_WORKER_OUT_OF_MEMORY` não é uma medida de
// desempenho, é um fato.
//
// Worker thread é thread do MESMO processo, então um RSS cobre pai + piscina.
// Ele é anotado como referência, não como critério.
//
// REGRA DE SAÍDA (a mesma de `npm run paginas`): nunca imprime valor de linha.
// Só id de página, contagem, tempo e memória.
//
// Uso:
//   node backend/tools/probe/src/memoria-api.ts
//   node backend/tools/probe/src/memoria-api.ts --heap=1024,2048 --workers=2 --pai=3072
//   node backend/tools/probe/src/memoria-api.ts --pagina=visao-geral --heap=512

import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..', '..', '..');

function listaDeNumeros(prefixo: string, padrao: number[]): number[] {
  const arg = process.argv.find((a) => a.startsWith(prefixo));
  if (!arg) return padrao;
  return arg
    .slice(prefixo.length)
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

const HEAPS = listaDeNumeros('--heap=', [1024, 2048, 3072]);
const WORKERS = listaDeNumeros('--workers=', [2]);
const PAIS = listaDeNumeros('--pai=', [3072]);
const PORTA_BASE = listaDeNumeros('--porta=', [3399])[0]!;

/**
 * As páginas do MENU, que é o que um usuário abre. As três `l-*` são Tooltip
 * oculto e a `capa` não tem visual pesado — incluí-las mediria trabalho que
 * ninguém pede. Lista fixa e não derivada de propósito: se uma página entrar no
 * menu, ela tem de entrar aqui à mão, e a revisão é o ponto.
 */
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

const pedidas = process.argv
  .filter((a) => a.startsWith('--pagina='))
  .map((a) => a.slice('--pagina='.length));
const PAGINAS = pedidas.length ? pedidas : PAGINAS_MENU;

interface ResultadoPagina {
  id: string;
  ok: boolean;
  ms: number;
  erro?: string;
}

interface Resultado {
  workers: number;
  heapMB: number;
  paiMB: number;
  paginas: ResultadoPagina[];
  rssPicoMB: number;
  subiu: boolean;
  morreu: boolean;
  saida?: number | null;
}

async function esperaSaude(porta: number, proc: ChildProcess, tetoMs = 90_000): Promise<boolean> {
  const limite = Date.now() + tetoMs;
  while (Date.now() < limite) {
    if (proc.exitCode !== null) return false;
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/api/saude`);
      if (r.ok) return true;
    } catch {
      /* ainda não escuta */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/**
 * RSS do processo, em MB, perguntado à própria API.
 *
 * `GET /api/saude` já devolve `memoria.rssMB` (`servidor.ts:489`), e worker
 * thread é thread do MESMO processo — então esse número cobre pai + piscina
 * inteira, sem depender de `tasklist` (Windows) ou `/proc` (Linux). É a leitura
 * portável, e é a mesma que o healthcheck do container usa.
 */
async function rssMB(porta: number): Promise<number> {
  try {
    const r = await fetch(`http://127.0.0.1:${porta}/api/saude`);
    if (!r.ok) return 0;
    const j = (await r.json()) as { memoria?: { rssMB?: number } };
    return j.memoria?.rssMB ?? 0;
  } catch {
    return 0;
  }
}

async function rodaConfiguracao(workers: number, heapMB: number, paiMB: number, porta: number): Promise<Resultado> {
  const proc = spawn(
    process.execPath,
    [
      `--max-old-space-size=${paiMB}`,
      '--expose-gc',
      'backend/api/src/index.ts',
      '--sem-poller',
      '--sem-aquecer',
    ],
    {
      cwd: RAIZ,
      env: {
        ...process.env,
        PORT: String(porta),
        API_WORKERS: String(workers),
        API_WORKER_HEAP_MB: String(heapMB),
        // Só para esta sonda: sem isto todo pedido levaria 401 antes de tocar a
        // piscina, e a medição mediria o portão, não o cálculo. NÃO toca o .env.
        GOOGLE_CLIENT_ID: '',
        // E desde 04/09/2026 a API RECUSA subir sem credencial a menos que a
        // intenção seja declarada — ver `backend/api/src/index.ts`. Medir é a
        // intenção legítima aqui.
        SEM_LOGIN: '1',
        // Cache de resposta em memória: com Redis, a segunda página poderia vir
        // de fora do processo e o pico de heap não apareceria.
        REDIS_URL: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let rssPico = 0;
  const amostra = setInterval(() => {
    if (proc.exitCode === null) void rssMB(porta).then((v) => (rssPico = Math.max(rssPico, v)));
  }, 750);

  let stderr = '';
  proc.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString();
  });
  proc.stdout?.resume();

  const res: Resultado = {
    workers,
    heapMB,
    paiMB,
    paginas: [],
    rssPicoMB: 0,
    subiu: false,
    morreu: false,
  };

  const subiu = await esperaSaude(porta, proc);
  res.subiu = subiu;

  if (subiu) {
    for (const id of PAGINAS) {
      const t0 = Date.now();
      try {
        const r = await fetch(`http://127.0.0.1:${porta}/api/dashboards/${id}`);
        const ms = Date.now() - t0;
        if (!r.ok) {
          res.paginas.push({ id, ok: false, ms, erro: `HTTP ${r.status}` });
          continue;
        }
        // Só a forma; nenhum valor de linha sai daqui.
        const v = (await r.json()) as { visuais?: unknown[] };
        const nVisuais = Array.isArray(v.visuais) ? v.visuais.length : 0;
        res.paginas.push({ id, ok: nVisuais > 0, ms, ...(nVisuais > 0 ? {} : { erro: 'sem visual' }) });
      } catch (e) {
        res.paginas.push({
          id,
          ok: false,
          ms: Date.now() - t0,
          erro: (e as Error).message.slice(0, 80),
        });
      }
      if (proc.exitCode !== null) {
        res.morreu = true;
        break;
      }
    }
  }

  clearInterval(amostra);
  res.rssPicoMB = rssPico;
  res.saida = proc.exitCode;
  res.morreu = res.morreu || proc.exitCode !== null;

  if (proc.exitCode === null) {
    proc.kill();
    await once(proc, 'exit').catch(() => undefined);
  }

  if (/heap|OUT_OF_MEMORY|Allocation failed/i.test(stderr)) {
    res.paginas.push({ id: '(processo)', ok: false, ms: 0, erro: 'estouro de heap no stderr' });
  }

  return res;
}

// ── saída ───────────────────────────────────────────────────────────────────

console.log(`\nDemanda de memória da API — bisseção do teto`);
console.log(`  pai: --max-old-space-size= ${PAIS.join(", ")} MB`);
console.log(`  ${PAGINAS.length} página(s) por configuração, uma por vez, todas frias`);
console.log(`  RSS pico vem de GET /api/saude — cobre pai + piscina (mesma thread pool)\n`);

const resultados: Resultado[] = [];
let porta = PORTA_BASE;

for (const paiMB of PAIS) {
  for (const workers of WORKERS) {
    for (const heapMB of HEAPS) {
      process.stdout.write(`  pai ${paiMB} + ${workers}w × ${heapMB} MB… `);
      const r = await rodaConfiguracao(workers, heapMB, paiMB, porta++);
      resultados.push(r);

      if (!r.subiu) {
        console.log(`NÃO SUBIU (saída ${r.saida})`);
        continue;
      }
      const okN = r.paginas.filter((p) => p.ok).length;
      const total = r.paginas.filter((p) => p.id !== '(processo)').length;
      const pior = Math.max(0, ...r.paginas.map((p) => p.ms));
      console.log(
        `${okN}/${total} páginas` +
          (r.morreu ? ' — PROCESSO MORREU' : '') +
          `  pior página ${(pior / 1000).toFixed(1)}s` +
          (r.rssPicoMB ? `  RSS pico ${r.rssPicoMB} MB` : ''),
      );
      for (const p of r.paginas.filter((x) => !x.ok)) {
        console.log(`      ✖ ${p.id}: ${p.erro ?? 'falhou'}`);
      }
    }
  }
}

console.log(`\nconfig                     autoriz.  páginas   pior pág.  RSS pico  morreu`);
console.log(`${'-'.repeat(74)}`);
for (const r of resultados) {
  const total = r.paginas.filter((x) => x.id !== '(processo)').length;
  const okN = r.paginas.filter((p) => p.ok).length;
  const pior = Math.max(0, ...r.paginas.map((p) => p.ms));
  console.log(
    `pai ${String(r.paiMB).padStart(5)} + ${r.workers}w×${String(r.heapMB).padStart(5)}`.padEnd(25) +
      `${String(r.paiMB + r.workers * r.heapMB).padStart(7)} MB` +
      `   ${okN}/${total}`.padEnd(10) +
      `${(pior / 1000).toFixed(1)}s`.padStart(9) +
      `${r.rssPicoMB ? String(r.rssPicoMB) : '?'} MB`.padStart(10) +
      `   ${r.morreu ? 'SIM' : 'não'}`,
  );
}

const menorQuePassa = resultados.find(
  (r) => r.subiu && !r.morreu && r.paginas.every((p) => p.ok) && r.paginas.length >= PAGINAS.length,
);

console.log('');
if (menorQuePassa) {
  const total = menorQuePassa.paiMB + menorQuePassa.workers * menorQuePassa.heapMB;
  console.log(
    `Menor configuração que serve as ${PAGINAS.length} páginas: ` +
      `${menorQuePassa.workers} worker(s) × ${menorQuePassa.heapMB} MB.`,
  );
  console.log(`Heap total autorizado: ${menorQuePassa.paiMB} (pai) + ${menorQuePassa.workers}×${menorQuePassa.heapMB} = ${total} MB.`);
  console.log(`É deste número que o mem_limit do compose tem de ser derivado — com folga.`);
} else {
  console.log(`NENHUMA das configurações testadas serviu todas as páginas.`);
  console.log(`Suba o --heap= e rode de novo antes de concluir qualquer coisa.`);
}
console.log('');
