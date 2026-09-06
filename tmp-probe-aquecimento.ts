// PROBE TEMPORÁRIO (06/09/2026) — a chave que o aquecedor enche é a mesma que o
// navegador pede? O aquecedor monta `?visual=...` SEM `filtro=` (aquecedor.ts:219),
// e 6 páginas abrem pré-filtradas (`filtros-padrao.ts`). Se a hipótese estiver certa,
// a primeira abertura real dessas 6 é SEMPRE fria.
//
// Só GET. Não escreve nada. Mede `cache` e `ms` que a própria resposta declara.
import { applyDotEnv } from './packages/query-engine/src/config.ts';
import { filtrosPadrao } from './apps/web/src/filtros-padrao.ts';
import { codificaFiltro } from './packages/widget-engine/src/filtro-url.ts';
import { idsIniciais } from './tools/layout/src/corte-eager.ts';

applyDotEnv(process.cwd());
const BASE = process.env.PROBE_BASE ?? 'http://localhost';
const PAGINAS = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const token = process.env.TOKEN_INTERNO;
if (!token) { console.error('TOKEN_INTERNO ausente'); process.exit(2); }

const r = await fetch(`${BASE}/auth/interno`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ token }),
});
const bruto = r.headers.get('set-cookie');
if (!r.ok || !bruto) { console.error(`login interno recusado: HTTP ${r.status}`); process.exit(2); }
const cookie = bruto.split(';')[0]!;

async function pega(url: string) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { cookie } });
  const corpo = (await res.json()) as { cache?: string; ms?: number };
  return { http: res.status, cache: corpo.cache ?? '?', msServidor: corpo.ms ?? null, msTotal: Math.round(performance.now() - t0) };
}

async function rss(): Promise<number> {
  const s = (await (await fetch(`${BASE}/api/saude`, { headers: { cookie } })).json()) as any;
  return s?.memoria?.rssMB ?? -1;
}

console.log(`base=${BASE}  rss inicial=${await rss()} MB\n`);
console.log('pagina                  | filtros | chave do AQUECEDOR (sem filtro) | chave do NAVEGADOR (1a)   | NAVEGADOR (2a)');
console.log('------------------------|---------|----------------------------------|---------------------------|----------------');

for (const pagina of PAGINAS) {
  const lay = await fetch(`${BASE}/api/dashboards/${encodeURIComponent(pagina)}/layout`, { headers: { cookie } });
  if (!lay.ok) { console.log(`${pagina.padEnd(23)} | layout HTTP ${lay.status}`); continue; }
  const eager = idsIniciais((await lay.json()) as any);
  const qsVisual = eager.map((id) => `visual=${encodeURIComponent(id)}`).join('&');
  const fs = filtrosPadrao(pagina);
  const qsFiltro = fs.map((f) => `filtro=${encodeURIComponent(codificaFiltro(f as any))}`).join('&');

  const urlAquecedor = `${BASE}/api/dashboards/${encodeURIComponent(pagina)}?${qsVisual}`;
  const urlNavegador = qsFiltro ? `${urlAquecedor}&${qsFiltro}` : urlAquecedor;

  const a = await pega(urlAquecedor);
  const n1 = await pega(urlNavegador);
  const n2 = await pega(urlNavegador);
  const fmt = (x: typeof a) => `${x.cache.padEnd(4)} ${String(x.msServidor ?? '-').padStart(6)}ms calc ${String(x.msTotal).padStart(6)}ms`;
  console.log(`${pagina.padEnd(23)} | ${String(fs.length).padStart(7)} | ${fmt(a).padEnd(32)} | ${fmt(n1).padEnd(25)} | ${fmt(n2)}`);
}
console.log(`\nrss final=${await rss()} MB`);
