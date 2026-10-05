#!/usr/bin/env node
// `npm run tela:entrada` — o instrumento de `docs/PLANO-CARREGAMENTO.md` (etapa 0): entra em
// cada página COMO O USUÁRIO (sessão nova, sem cache de navegador) e mede o tempo até ela
// ficar pronta, contra a meta de `entrada-avalia.ts`.
//
// **Por que não é `--perf` de `varre.ts`.** Aquele mede requisições, bytes e frio × quente
// na mesma sessão. Este responde outra pergunta: quem entra AGORA espera quanto? Por isso
// um contexto de navegador novo por página, e a pergunta repetida durante uma carga.
//
// **`--enquanto-carrega`: mede durante uma carga real, sem provocar nenhuma.** Espera a
// trava do snapshot aparecer (o refresh roda a cada ≤ 15 min; o snapshot das 03:00 também
// a toma) e mede rodada após rodada até ela sumir. Disparar carga daqui seria pôr peso no
// banco para medir, e uma carga numa CÓPIA do snapshot não ocupa a API — não reproduziria
// nada.
//
// Uso:
//   npm run tela:entrada                                  # todas, uma rodada, sem esperar carga
//   npm run tela:entrada -- --pagina=agendamento-field    # só a principal
//   npm run tela:entrada -- --enquanto-carrega            # espera a próxima carga e mede durante ela
//   npm run tela:entrada -- --base=http://localhost:3100  # direto na API, sem o proxy
//   npm run tela:entrada -- --enquanto-carrega --snapshot=../pasta-principal/snapshot  # numa worktree
//
// REGRA DE SAÍDA: nunca imprime valor de linha — só página, tempo e contagem.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { applyDotEnv } from '../../../packages/query-engine/src/config.ts';
import { loadDashboards } from '../../../packages/widget-engine/src/spec.ts';
import { ARQUIVO_DA_TRAVA } from '../../../packages/snapshot/src/trava.ts';
import { logaComoFerramenta } from './login-interno.ts';
import { avalia, ordemDeMedida, resume, type Medida, type Veredito } from './entrada-avalia.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
applyDotEnv(ROOT);

const TETO_MS = 60_000;

interface Args {
  base: string;
  paginas: string[] | null;
  enquantoCarrega: boolean;
  esperaMaxMin: number;
  snapshot: string;
}

function parseArgs(argv: readonly string[]): Args {
  const a: Args = { base: 'http://localhost', paginas: null, enquantoCarrega: false, esperaMaxMin: 20, snapshot: path.join(ROOT, 'snapshot') };
  for (const x of argv) {
    if (x.startsWith('--base=')) a.base = x.slice('--base='.length).replace(/\/$/, '');
    else if (x.startsWith('--pagina=')) a.paginas = x.slice('--pagina='.length).split(',').map((s) => s.trim()).filter(Boolean);
    else if (x === '--enquanto-carrega') a.enquantoCarrega = true;
    else if (x.startsWith('--espera-max-min=')) a.esperaMaxMin = Number(x.slice('--espera-max-min='.length));
    else if (x.startsWith('--snapshot=')) a.snapshot = path.resolve(x.slice('--snapshot='.length));
    else {
      console.error('use: --pagina=id,id | --enquanto-carrega [--espera-max-min=20] [--snapshot=DIR] | --base=URL');
      process.exit(2);
    }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
// O `snapshot/` que a stack monta. Numa worktree ele não existe: aponte `--snapshot=` para o
// da pasta principal, ou o modo `--enquanto-carrega` nunca vê carga nenhuma.
const trava = path.join(args.snapshot, ARQUIVO_DA_TRAVA);
const carregando = (): boolean => fs.existsSync(trava);
const hora = (): string => new Date().toISOString().slice(11, 19);

const todas = loadDashboards(path.join(ROOT, 'backend', 'specs')).map((d) => d.id);
const paginas = ordemDeMedida(args.paginas ?? todas);
const desconhecidas = paginas.filter((p) => !todas.includes(p));
if (desconhecidas.length) {
  console.error(`página(s) inexistente(s): ${desconhecidas.join(', ')}`);
  process.exit(2);
}

// O login vai direto na API: `/auth/interno` é a mesma rota pelo proxy, mas assim o
// instrumento funciona também quando é o proxy que está quebrado.
const cookie = await logaComoFerramenta(args.base.replace(/^(https?:\/\/[^/:]+)(:\d+)?$/, '$1:3100'));
const browser = await chromium.launch();

async function mede(pagina: string): Promise<Medida> {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await ctx.addCookies([{ ...cookie, url: args.base }]);
  await ctx.addInitScript(() => localStorage.setItem('modo-conferencia', '1'));
  const page = await ctx.newPage();
  const t0 = Date.now();
  let htmlMs: number | null = null;
  let prontaMs: number | null = null;
  try {
    await page.goto(`${args.base}/?pagina=${pagina}`, { waitUntil: 'domcontentloaded', timeout: TETO_MS });
    htmlMs = Date.now() - t0;
    await page.waitForSelector('.selo', { timeout: TETO_MS });
    prontaMs = Date.now() - t0;
  } catch {
    // o teto passou — a medida diz em qual das duas etapas
  }
  const n = await page.evaluate(() => (document.body.innerText.match(/carregando/gi) ?? []).length).catch(() => 0);
  await ctx.close();
  return { pagina, htmlMs, prontaMs, carregando: n };
}

function imprime(v: Veredito): void {
  const html = v.htmlMs === null ? `>${TETO_MS / 1000}s` : `${v.htmlMs} ms`;
  const pronta = v.prontaMs === null ? `>${TETO_MS / 1000}s` : `${v.prontaMs} ms`;
  console.log(`  ${v.passou ? 'ok ' : 'REP'} ${v.pagina.padEnd(24)} html ${html.padStart(7)} | pronta ${pronta.padStart(8)} | meta ${v.metaMs} ms${v.motivo ? ` — ${v.motivo}` : ''}`);
}

async function rodada(rotulo: string): Promise<Veredito[]> {
  console.log(`\n${hora()} ${rotulo}${carregando() ? ' (com carga gravando o snapshot)' : ''}`);
  const out: Veredito[] = [];
  for (const p of paginas) {
    const v = avalia(await mede(p));
    imprime(v);
    out.push(v);
  }
  return out;
}

const todasAsMedidas: Veredito[] = [];
try {
  if (!args.enquantoCarrega) {
    todasAsMedidas.push(...(await rodada('rodada única')));
  } else {
    console.log(`${hora()} esperando uma carga começar (até ${args.esperaMaxMin} min; a trava é ${path.relative(ROOT, trava)})…`);
    const limite = Date.now() + args.esperaMaxMin * 60_000;
    while (!carregando() && Date.now() < limite) await new Promise((r) => setTimeout(r, 2000));
    if (!carregando()) {
      console.error(`nenhuma carga começou em ${args.esperaMaxMin} min — nada medido.`);
      process.exitCode = 3;
    }
    for (let i = 1; carregando(); i++) todasAsMedidas.push(...(await rodada(`rodada ${i}`)));
  }
} finally {
  await browser.close();
}

if (todasAsMedidas.length) {
  console.log('\nresumo (o pior caso é o que o usuário sente):');
  for (const p of paginas) {
    const r = resume(todasAsMedidas.filter((v) => v.pagina === p));
    if (!r.rodadas) continue;
    const pior = r.piorMs === null ? 'não ficou pronta' : `${r.piorMs} ms`;
    console.log(`  ${r.reprovadas ? 'REP' : 'ok '} ${r.pagina.padEnd(24)} pior ${pior.padStart(16)} | mediana ${String(r.medianaMs ?? '—').padStart(6)} ms | ${r.reprovadas}/${r.rodadas} reprovada(s)`);
  }
  if (todasAsMedidas.some((v) => !v.passou)) process.exitCode = 1;
}
