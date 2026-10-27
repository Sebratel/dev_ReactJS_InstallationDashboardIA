// Sonda da MEMÓRIA DA API como o contêiner a vê (fase 4, docs/DECISAO-AO-VIVO.md § Memória).
//
// O que ela responde: quanto o processo da API (pai + piscina de workers) ocupa depois de
// rodadas de cálculo de todas as páginas — e quanto disso volta ao sistema quando a API
// fica ociosa. É o número da linha da `api` no Grafana (memória do cgroup), e não o heap.
//
// **Rode DENTRO da imagem de produção** (Linux, `node:24-slim`): o que prende memória
// depois do cálculo é o alocador do sistema (glibc), e no Windows o alocador é outro. Ex.:
//
//   docker run --rm --memory=3072m -v <snapshot>:/repo/snapshot:ro <imagem> \
//     node --max-old-space-size=768 --expose-gc backend/tools/probe/src/memoria-workers.ts
//
// Variantes por ambiente, como em produção: `API_WORKERS`, `API_WORKER_HEAP_MB`,
// `API_DATASETS_POR_WORKER`, `MALLOC_ARENA_MAX`, `LD_PRELOAD` (jemalloc).
//
// Cada rodada é o reaquecimento depois de um refresh: as workers largam os conjuntos
// (`invalidaPagina`, o que a troca de carimbo faz) e o cache de resposta não guarda nada —
// toda página é carregada e calculada de novo, e cada seletor listado. Sem banco nenhum:
// acesso liberado de teste, snapshot do disco.
//
// Saída: só números (MB, ms, contagens) e ids de página — NUNCA valor de linha.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codificaFiltro } from '../../../packages/widget-engine/src/filtro-url.ts';
import { filtrosPadrao } from '../../../packages/widget-engine/src/filtros-padrao.ts';
import { loadDashboards } from '../../../packages/widget-engine/src/spec.ts';
import type { Cache } from '../../../packages/query-engine/src/types.ts';
import { segmentacaoDe } from '../../../api/src/calcula.ts';
import { PiscinaWorkers } from '../../../api/src/piscina-workers.ts';
import { Servidor } from '../../../api/src/servidor.ts';
import { ACESSO_LIBERADO } from '../../../api/test/fixtures/acesso.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const arg = (nome: string, padrao: number) => Number(process.argv.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3) ?? padrao);
const RODADAS = arg('rodadas', 3);
const OCIOSO_S = arg('ocioso', 60);
const SNAPSHOT = path.join(ROOT, 'snapshot');
const MB = (b: number) => Math.round(b / 1048576);

/** Um cache de resposta que não guarda nada: toda rodada calcula tudo. */
const semCache: Cache = {
  get: async () => undefined,
  set: async () => undefined,
  del: async () => undefined,
  delMany: async () => 0,
  keys: async () => [],
};

/** A memória do cgroup (o que o Grafana mostra), ou `null` fora de contêiner. */
function cgroup(): { atual: number; pico: number | null; anon: number; arquivo: number } | null {
  try {
    const atual = Number(fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8'));
    const pico = fs.existsSync('/sys/fs/cgroup/memory.peak') ? Number(fs.readFileSync('/sys/fs/cgroup/memory.peak', 'utf8')) : null;
    const stat = fs.readFileSync('/sys/fs/cgroup/memory.stat', 'utf8');
    const campo = (n: string) => Number(new RegExp(`^${n} (\\d+)$`, 'm').exec(stat)?.[1] ?? 0);
    return { atual, pico, anon: campo('anon'), arquivo: campo('file') };
  } catch {
    return null;
  }
}

let picoRss = 0;
let picoCg = 0;
const amostra = () => {
  const rss = process.memoryUsage().rss;
  if (rss > picoRss) picoRss = rss;
  const cg = cgroup();
  if (cg && cg.atual > picoCg) picoCg = cg.atual;
};
const relogio = setInterval(amostra, 250);

const piscina = new PiscinaWorkers();
const servidor = new Servidor({
  acesso: ACESSO_LIBERADO,
  root: ROOT,
  snapshotDir: SNAPSHOT,
  webDir: path.join(ROOT, 'frontend', 'dist'),
  identifica: () => ({ usuario: 'sonda', papeis: ['autenticado'] }),
  piscinaWorkers: piscina,
  cache: semCache,
});
const http = servidor.criaHttp();
await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
const { port } = http.address() as { port: number };
const busca = async (rota: string) => {
  const r = await fetch(`http://127.0.0.1:${port}${rota}`);
  await r.arrayBuffer();
  return r.status;
};

const paginas = loadDashboards(path.join(ROOT, 'backend', 'specs'));
const linha = (rotulo: string, extra = '') => {
  amostra();
  const cg = cgroup();
  console.log(
    `${rotulo.padEnd(22)} rss ${String(MB(process.memoryUsage().rss)).padStart(5)} MB (pico ${MB(picoRss)})` +
      (cg ? `; cgroup ${MB(cg.atual)} MB (pico ${MB(picoCg)}; anon ${MB(cg.anon)}, arquivo ${MB(cg.arquivo)})` : '') +
      extra,
  );
};

console.log(
  `API_WORKERS=${process.env.API_WORKERS ?? '(padrão)'} API_WORKER_HEAP_MB=${process.env.API_WORKER_HEAP_MB ?? '(padrão)'} ` +
    `API_DATASETS_POR_WORKER=${process.env.API_DATASETS_POR_WORKER ?? '(padrão)'} MALLOC_ARENA_MAX=${process.env.MALLOC_ARENA_MAX ?? '-'} ` +
    `LD_PRELOAD=${process.env.LD_PRELOAD ? path.basename(process.env.LD_PRELOAD) : '-'}; ${paginas.length} páginas, ${RODADAS} rodadas`,
);
linha('subida');

let falhas = 0;
for (let rodada = 1; rodada <= RODADAS; rodada++) {
  for (const d of paginas) piscina.invalidaPagina(d.id);
  const t0 = Date.now();
  let pedidos = 0;
  for (const d of paginas) {
    const filtros = filtrosPadrao(d.id, new Date()).map((f) => `filtro=${encodeURIComponent(codificaFiltro(f))}`).join('&');
    const s = await busca(`/api/dashboards/${encodeURIComponent(d.id)}${filtros ? `?${filtros}` : ''}`);
    pedidos++;
    if (s !== 200) falhas++;
    for (const v of d.visuals ?? []) {
      const seg = segmentacaoDe(v);
      if (!seg || (seg.naoFiltra !== undefined && seg.niveis === undefined)) continue;
      const p = new URLSearchParams({ tabela: seg.tabela, coluna: seg.coluna });
      if (seg.nivel && !seg.niveis) p.set('nivel', seg.nivel);
      const sv = await busca(`/api/dashboards/${encodeURIComponent(d.id)}/valores?${p}`);
      pedidos++;
      if (sv !== 200 && sv !== 409) falhas++;
    }
  }
  linha(`rodada ${rodada}`, `; ${pedidos} pedidos em ${((Date.now() - t0) / 1000).toFixed(0)} s, ${falhas} falha(s) até aqui`);
}

// Ociosa: o que volta ao sistema sozinho, e depois de um GC forçado em cada isolate.
await new Promise((r) => setTimeout(r, OCIOSO_S * 1000));
linha(`ociosa ${OCIOSO_S} s`);
(globalThis as { gc?: () => void }).gc?.();
await new Promise((r) => setTimeout(r, 2000));
linha('ociosa + gc do pai');

const saude = await fetch(`http://127.0.0.1:${port}/api/saude`).then((r) => r.json() as Promise<{ memoria?: unknown }>);
console.log('memoria /api/saude:', JSON.stringify(saude.memoria ?? null));

clearInterval(relogio);
servidor.destroi();
http.closeAllConnections?.();
http.close();
piscina.destroi();

// Quanto da memória era das WORKERS: com elas encerradas, o que o processo devolve ao
// sistema é o que reciclar uma worker devolveria.
if (process.argv.includes('--encerra-workers')) {
  await new Promise((r) => setTimeout(r, 5000));
  (globalThis as { gc?: () => void }).gc?.();
  await new Promise((r) => setTimeout(r, 1000));
  linha('workers encerradas');
  // A coleta de último recurso do V8 também devolve as páginas que ele guarda para reuso.
  (globalThis as { gc?: (o?: unknown) => void }).gc?.({ type: 'major', execution: 'sync', flavor: 'last-resort' });
  await new Promise((r) => setTimeout(r, 2000));
  linha('+ gc último recurso');
}

// Onde está a memória do processo: as maiores regiões residentes (só endereço e tamanho)
// e as contas do V8 do processo principal. Para achar o dono do que não é heap.
if (process.argv.includes('--mapas')) {
  const v8 = await import('node:v8');
  const h = v8.getHeapStatistics();
  console.log(
    `v8 do pai: heap ${MB(h.total_heap_size)} MB, malloc ${MB(h.malloced_memory)} MB (pico ${MB(h.peak_malloced_memory)}), ` +
      `externo ${MB(h.external_memory)} MB; memoryUsage: ${JSON.stringify(Object.fromEntries(Object.entries(process.memoryUsage()).map(([k, v]) => [k, MB(v)])))}`,
  );
  try {
    const regioes: { faixa: string; nome: string; rss: number }[] = [];
    let atual: { faixa: string; nome: string; rss: number } | null = null;
    for (const l of fs.readFileSync('/proc/self/smaps', 'utf8').split('\n')) {
      const cab = /^([0-9a-f]+-[0-9a-f]+) \S+ \S+ \S+ \S+\s*(.*)$/.exec(l);
      if (cab) {
        atual = { faixa: cab[1]!, nome: cab[2]!.trim() || '[anônima]', rss: 0 };
        regioes.push(atual);
        continue;
      }
      const rss = /^Rss:\s+(\d+) kB$/.exec(l);
      if (rss && atual) atual.rss = Number(rss[1]) * 1024;
    }
    const porNome = new Map<string, { n: number; rss: number }>();
    for (const r of regioes) {
      const k = r.nome.startsWith('/') ? path.basename(r.nome) : r.nome;
      const e = porNome.get(k) ?? { n: 0, rss: 0 };
      porNome.set(k, { n: e.n + 1, rss: e.rss + r.rss });
    }
    console.log('rss por tipo de região:', [...porNome].sort((a, b) => b[1].rss - a[1].rss).slice(0, 8).map(([k, v]) => `${k} ${MB(v.rss)} MB em ${v.n}`).join('; '));
    const anonimas = regioes.filter((r) => r.nome === '[anônima]').sort((a, b) => b.rss - a.rss);
    const faixas = (min: number, max: number) => anonimas.filter((r) => r.rss >= min && r.rss < max);
    console.log(
      `anônimas: ${anonimas.length} regiões; ≥64 MB: ${faixas(64 << 20, Infinity).length} (${MB(faixas(64 << 20, Infinity).reduce((s, r) => s + r.rss, 0))} MB), ` +
        `1–64 MB: ${faixas(1 << 20, 64 << 20).length} (${MB(faixas(1 << 20, 64 << 20).reduce((s, r) => s + r.rss, 0))} MB), ` +
        `<1 MB: ${faixas(0, 1 << 20).length} (${MB(faixas(0, 1 << 20).reduce((s, r) => s + r.rss, 0))} MB); ` +
        `maiores: ${anonimas.slice(0, 6).map((r) => `${MB(r.rss)} MB`).join(', ')}`,
    );
  } catch (err) {
    console.log('sem /proc/self/smaps:', err instanceof Error ? err.message : String(err));
  }
}
process.exitCode = falhas > 0 ? 1 : 0;
