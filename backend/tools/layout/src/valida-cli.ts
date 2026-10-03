#!/usr/bin/env node
// `npm run layout:valida` — o CLI fino em cima de `valida.ts` (que é puro, sem tocar
// disco, para ser testável em `backend/tools/layout/test/valida.test.ts`).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDashboards } from '../../../packages/widget-engine/src/spec.ts';
import { carregaLayout, validaLayout } from './valida.ts';

async function main(): Promise<void> {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const dirLayout = path.join(ROOT, 'backend', 'specs', 'layout');
  if (!fs.existsSync(dirLayout)) {
    console.error(`'${dirLayout}' não existe — rode 'npm run layout:extrai' primeiro.`);
    process.exit(2);
  }

  const dashboards = loadDashboards(path.join(ROOT, 'backend', 'specs'));
  const idsPorPagina = new Map(dashboards.map((d) => [d.id, d.visuals.map((v) => v.id)]));

  let totalProblemas = 0;
  for (const arquivo of fs.readdirSync(dirLayout).filter((f) => f.endsWith('.layout.yaml')).sort()) {
    const layout = carregaLayout(path.join(dirLayout, arquivo));
    const ids = idsPorPagina.get(layout.pagina);
    if (!ids) {
      console.error(`✖ ${arquivo}: página '${layout.pagina}' não existe em backend/specs/dashboards/`);
      totalProblemas++;
      continue;
    }
    const problemas = validaLayout(layout, ids);
    if (problemas.length === 0) {
      console.log(`✔ ${arquivo}`);
    } else {
      console.log(`✖ ${arquivo}`);
      for (const p of problemas) console.log(`  - ${p.mensagem}`);
      totalProblemas += problemas.length;
    }
  }

  if (totalProblemas > 0) {
    console.error(`\n${totalProblemas} problema(s).`);
    process.exit(1);
  }
}

void main();
