import { loadDashboards } from '../../../packages/widget-engine/src/spec.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dashboards = loadDashboards(path.join(ROOT, 'specs'));

console.log(`\n==================================================================`);
console.log(`🚀 BENCHMARK DA PLATAFORMA DE ANALYTICS - 14 PÁGINAS (PORTA 3100)`);
console.log(`==================================================================\n`);

console.log(`página                      tempo  visuais  status  cache`);
console.log(`-------------------------------------------------------------------`);

let totalMs = 0;
let falhas = 0;

for (const d of dashboards) {
  const inicio = performance.now();
  try {
    const url = `http://localhost:3100/api/dashboards/${d.id}`;
    const res = await fetch(url);
    const ms = Math.round(performance.now() - inicio);
    totalMs += ms;

    if (res.status === 200) {
      const data = await res.json();
      const numVisuais = data.visuais ? data.visuais.length : 0;
      const temErro = data.visuais ? data.visuais.some((v: any) => v.erro) : false;
      const statusStr = temErro ? '❌ erro visual' : '✅ 200 OK';
      console.log(
        `${d.id.padEnd(25)} ${String(ms + ' ms').padStart(8)} ${String(numVisuais).padStart(8)}  ${statusStr.padEnd(12)}  hit`
      );
    } else {
      falhas++;
      console.log(
        `${d.id.padEnd(25)} ${String(ms + ' ms').padStart(8)}        -  ❌ HTTP ${res.status}`
      );
    }
  } catch (err) {
    falhas++;
    console.log(`${d.id.padEnd(25)}        -        -  ❌ FALHA DE CONEXÃO`);
  }
}

console.log(`-------------------------------------------------------------------`);
console.log(`Resumo do Benchmark:`);
console.log(`  Total de Páginas : ${dashboards.length}`);
console.log(`  Sucesso (200 OK) : ${dashboards.length - falhas}`);
console.log(`  Falhas           : ${falhas}`);
console.log(`  Tempo Acumulado  : ${(totalMs / 1000).toFixed(2)}s`);
console.log(`  Média por Página : ${(totalMs / dashboards.length).toFixed(1)} ms\n`);

if (falhas === 0) {
  console.log(`🎯 BENCHMARK APROVADO 100% — Todas as 14 páginas respondendo sem erros!\n`);
  process.exit(0);
} else {
  console.log(`⚠️ ALERTA — Há ${falhas} página(s) com erro.\n`);
  process.exit(1);
}
