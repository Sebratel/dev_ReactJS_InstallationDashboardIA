#!/usr/bin/env node
// `npm run tela:ao-vivo` — escuta `/api/eventos` como o navegador escuta (o mesmo SSE que faz
// os números mudarem na tela sem F5) e conta os avisos por página. Etapa 0 de
// `docs/PLANO-CARREGAMENTO.md`.
//
// **Para que serve.** Um aviso é a tela recalculando. Aviso verdadeiro é o tempo real
// funcionando; aviso FALSO (a tabela "muda" a cada volta sem o dado mudar) é página
// recalculada à toa e máquina roubada da VISÃO PRODUTIVA. Em 04/10/2026, 28 de 31 avisos
// em 5 min eram falsos (ACHADOS #173). O sinal de fantasma é o RITMO: a mesma página
// avisada em intervalos quase iguais, do tamanho do intervalo do poller, a qualquer hora.
//
// Uso:  npm run tela:ao-vivo -- [--minutos=5] [--base=http://localhost]
// REGRA DE SAÍDA: só página e horário — o evento não carrega valor de linha.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDotEnv } from '../../../packages/query-engine/src/config.ts';
import { logaComoFerramenta } from './login-interno.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
applyDotEnv(ROOT);

let minutos = 5;
let base = 'http://localhost';
for (const x of process.argv.slice(2)) {
  if (x.startsWith('--minutos=')) minutos = Number(x.slice('--minutos='.length));
  else if (x.startsWith('--base=')) base = x.slice('--base='.length).replace(/\/$/, '');
  else {
    console.error('use: --minutos=N | --base=URL');
    process.exit(2);
  }
}

const cookie = await logaComoFerramenta(base.replace(/^(https?:\/\/[^/:]+)(:\d+)?$/, '$1:3100'));
const hora = (): string => new Date().toISOString().slice(11, 19);
const porPagina = new Map<string, number[]>();
const ac = new AbortController();
setTimeout(() => ac.abort(), minutos * 60_000);
const t0 = Date.now();

try {
  const r = await fetch(`${base}/api/eventos`, {
    headers: { cookie: `${cookie.name}=${cookie.value}`, accept: 'text/event-stream' },
    signal: ac.signal,
  });
  console.log(`${hora()} conectado (${r.status}); ouvindo por ${minutos} min`);
  const dec = new TextDecoder();
  let buf = '';
  for await (const pedaco of r.body as AsyncIterable<Uint8Array>) {
    buf += dec.decode(pedaco, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const ev = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (ev.startsWith(':')) continue; // batimento do SSE
      const dado = ev.match(/^data: (.*)$/m)?.[1] ?? '';
      let paginas: string[] = [];
      try {
        paginas = (JSON.parse(dado) as { dashboards?: string[] }).dashboards ?? [];
      } catch {
        // evento que não é de página — fica fora da conta
      }
      for (const p of paginas) (porPagina.get(p) ?? porPagina.set(p, []).get(p)!).push(Date.now());
      if (paginas.length) console.log(`${hora()} ${paginas.join(', ')}`);
    }
  }
} catch (e) {
  if ((e as Error).name !== 'AbortError') {
    console.error(`o canal caiu: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

const dur = Math.round((Date.now() - t0) / 1000);
console.log(`\nresumo de ${dur} s (ritmo regular, do tamanho do intervalo do poller, sugere aviso falso):`);
if (!porPagina.size) console.log('  nenhum aviso de página.');
for (const [p, ts] of [...porPagina].sort((a, b) => b[1].length - a[1].length)) {
  const gaps = ts.slice(1).map((t, k) => (t - ts[k]!) / 1000).sort((a, b) => a - b);
  const med = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : null;
  console.log(`  ${p.padEnd(24)} ${String(ts.length).padStart(4)} aviso(s)${med === null ? '' : ` | intervalo mediano ${med.toFixed(0)} s`}`);
}
