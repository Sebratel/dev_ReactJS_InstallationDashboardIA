#!/usr/bin/env node
// `npm run bench:filtro-pai-paridade` — a prova de que o reaproveitamento do contexto
// pai (ACHADOS #177, `measure-engine/src/filter.ts`) não muda número nenhum.
//
// Calcula cada página DUAS vezes, com o reaproveitamento desligado e ligado, cada vez
// num avaliador próprio (carregado do zero: nenhum cache de uma rodada pode fazer a
// outra parecer igual), sem filtro e com os primeiros valores das primeiras
// segmentações — é com filtro na tela que os contextos filhos aparecem. Compara o
// resultado inteiro, visual por visual.
//
// REGRA DE SAÍDA: nunca imprime valor de linha — só página, caso e o CAMINHO da
// primeira diferença (`visuais[3].linhas[17].c2`), como `colunar-paridade.ts`.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculaPagina, segmentacaoDe } from '../../../api/src/calcula.ts';
import { valoresDistintos } from '../../../api/src/valores-segmentacao.ts';
import { defineReaproveitamentoDoPai } from '../../../packages/measure-engine/src/filter.ts';
import { SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { carrega, todaFormaCompleta } from '../../../packages/snapshot/src/carrega.ts';
import { DIRETORIO_PADRAO } from '../../../packages/snapshot/src/manifesto.ts';
import { decodificaFiltros } from '../../../packages/widget-engine/src/filtro-url.ts';
import { loadDashboards, type DashboardSpec } from '../../../packages/widget-engine/src/spec.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const DIR = process.argv.find((a) => a.startsWith('--snapshot='))?.slice('--snapshot='.length) ?? path.join(ROOT, DIRETORIO_PADRAO);
const SO = process.argv.find((a) => a.startsWith('--pagina='))?.slice('--pagina='.length).split(',');
const SEGMENTACOES = 2;
const VALORES = 2;

function comparavel(v: unknown): unknown {
  if (v instanceof Date) return `@${v.getTime()}`;
  if (Array.isArray(v)) return v.map(comparavel);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'ms') continue;
      out[k] = comparavel(x);
    }
    return out;
  }
  return v;
}

function ondeDifere(a: unknown, b: unknown, caminho = ''): string | null {
  if (a === b) return null;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb) return `${caminho || '(raiz)'}: ${ta} vs ${tb}`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${caminho || '(raiz)'}: ${a.length} itens vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = ondeDifere(a[i], b[i], `${caminho}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length || ka.some((k) => !kb.includes(k))) {
      return `${caminho || '(raiz)'}: chaves diferentes (${ka.length} vs ${kb.length})`;
    }
    for (const k of ka) {
      const d = ondeDifere((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], caminho ? `${caminho}.${k}` : k);
      if (d) return d;
    }
    return null;
  }
  return `${caminho || '(raiz)'}: dois ${ta} diferentes`;
}

// **Cada cálculo num processo próprio, com teto de memória e de tempo.** O motor antigo
// (reaproveitamento desligado) não termina o caso que motivou a correção — o TURNO na
// `agendamento-field` estourou 8 GB em 10 min —, e um processo só perderia a prova
// inteira nele. O filho devolve um hash por visual, nunca o resultado: nenhum valor sai
// do processo que o calculou.
const model = SemanticModel.fromSpecsDir(path.join(ROOT, 'backend', 'specs'));
const agora = new Date(process.env.AGORA_PARIDADE ?? Date.now());
const formaCompleta = todaFormaCompleta(model);

async function casosDe(dash: DashboardSpec, ev: Awaited<ReturnType<typeof carrega>>['ev']): Promise<string[][]> {
  const filtros: string[][] = [[]];
  defineReaproveitamentoDoPai(false);
  for (const v of (dash.visuals ?? []).map((x) => segmentacaoDe(x)).filter((s) => s && !s.nivel && !s.niveis && !s.naoFiltra).slice(0, SEGMENTACOES)) {
    let vals: unknown[] = [];
    try {
      vals = valoresDistintos(ev, v!.tabela, v!.coluna, null).slice(0, VALORES);
    } catch {
      continue;
    }
    for (const val of vals) filtros.push([JSON.stringify({ tabela: v!.tabela, coluna: v!.coluna, valores: [val] })]);
  }
  return filtros;
}

const filho = process.argv.find((a) => a.startsWith('--filho='))?.slice('--filho='.length);
if (filho) {
  const [id, caso, modo, soVisual] = filho.split('|');
  const dash = loadDashboards(path.join(ROOT, 'backend', 'specs')).find((d) => d.id === id)!;
  const c = await carrega({ dir: DIR, model, dashboards: [dash], now: agora, colunar: true, precisaFormaCompleta: formaCompleta });
  const casos = await casosDe(dash, c.ev);
  if (caso === 'lista') {
    console.log(JSON.stringify({ casos: casos.length }));
  } else {
    const alvo: DashboardSpec = {
      ...dash,
      ...(soVisual ? { visuals: (dash.visuals ?? []).filter((v) => v.id === soVisual) } : {}),
      filters: [...(dash.filters ?? []), ...decodificaFiltros(casos[Number(caso)]!)],
    };
    defineReaproveitamentoDoPai(modo === 'ligado');
    const t0 = Date.now();
    const p = calculaPagina(alvo, c.ev);
    const ms = Date.now() - t0;
    const { createHash } = await import('node:crypto');
    const hashes = p.visuais.map((v) => createHash('sha256').update(JSON.stringify(comparavel(v))).digest('hex'));
    console.log(JSON.stringify({ ms, hashes, ids: p.visuais.map((v) => v.id) }));
  }
} else {
  const { spawnSync } = await import('node:child_process');
  const roda = (arg: string, heapMB: number, tetoS: number): { ok: true; r: any } | { ok: false; porque: string } => {
    const out = spawnSync(process.execPath, [`--max-old-space-size=${heapMB}`, fileURLToPath(import.meta.url), `--filho=${arg}`, `--snapshot=${DIR}`], {
      encoding: 'utf8', timeout: tetoS * 1000, env: { ...process.env, AGORA_PARIDADE: agora.toISOString() }, maxBuffer: 64 * 1024 * 1024,
    });
    if (out.error || out.status !== 0) return { ok: false, porque: out.error ? `passou de ${tetoS} s` : /heap out of memory/.test(out.stderr) ? `estourou ${heapMB} MB` : `saiu com ${out.status}` };
    const linha = out.stdout.trim().split(/\r?\n/).filter((l) => l.startsWith('{')).pop();
    return linha ? { ok: true, r: JSON.parse(linha) } : { ok: false, porque: 'sem resposta' };
  };
  const paginas = loadDashboards(path.join(ROOT, 'backend', 'specs')).filter((d) => !SO || SO.includes(d.id));
  let iguais = 0, divergencias = 0, inviaveis = 0;
  for (const dash of paginas) {
    const lista = roda(`${dash.id}|lista|desligado`, 6144, 300);
    if (!lista.ok) { console.log(`?      ${dash.id}: não deu para listar os casos (${lista.porque})`); continue; }
    for (let i = 0; i < lista.r.casos; i++) {
      const rot = `${dash.id.padEnd(24)} caso ${i}${i === 0 ? ' (sem filtro)' : ''}`;
      const b = roda(`${dash.id}|${i}|ligado`, 6144, 300);
      const a = roda(`${dash.id}|${i}|desligado`, 6144, 300);
      if (!b.ok) { divergencias++; console.log(`FALHOU ${rot}: o motor NOVO ${b.porque}`); continue; }
      if (!a.ok) {
        // A página inteira não terminou no motor antigo: compara visual por visual, cada
        // um no seu processo. Só o visual que de fato não termina fica sem base.
        console.log(`base?  ${rot}: o motor antigo ${a.porque} na página inteira — comparando visual por visual`);
        let iv = 0, dv = 0, sv = 0;
        for (const [k, vid] of (b.r.ids as string[]).entries()) {
          const av = roda(`${dash.id}|${i}|desligado|${vid}`, 6144, 180);
          if (!av.ok) { sv++; console.log(`         visual ${vid}: o motor antigo ${av.porque} — sem base`); continue; }
          if (av.r.hashes[0] !== b.r.hashes[k]) { dv++; console.log(`DIFERE   visual ${vid}`); } else iv++;
        }
        console.log(`         ${iv} visual(is) igual(is), ${dv} diferente(s), ${sv} sem base`);
        if (dv > 0) divergencias++; else if (sv > 0) inviaveis++; else iguais++;
        continue;
      }
      const dif = a.r.hashes.findIndex((h: string, k: number) => h !== b.r.hashes[k]);
      if (dif >= 0 || a.r.hashes.length !== b.r.hashes.length) { divergencias++; console.log(`DIFERE ${rot}: visual ${a.r.ids[dif] ?? '?'}`); }
      else { iguais++; console.log(`igual  ${rot}: ${a.r.ms} ms → ${b.r.ms} ms`); }
    }
  }
  console.log(`\n${iguais} igual(is), ${divergencias} divergência(s), ${inviaveis} sem base (o motor antigo não terminou).`);
  if (divergencias > 0) process.exitCode = 1;
}
