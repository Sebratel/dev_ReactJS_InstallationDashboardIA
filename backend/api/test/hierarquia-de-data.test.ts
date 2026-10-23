// Toda página com hierarquia de data (Ano/Mês/Dia) precisa da árvore de período — ou
// seja, de uma linha em `filtros-padrao.ts`. Sem ela, a hierarquia vira um menu de datas
// soltas, e escolher uma manda texto contra data: na PREMIAÇÃO INSTALAÇÃO (20/10/2026) os
// três cards caíram em "não calculou" ao escolher 28/12/2026.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dataDaPagina } from '../../packages/widget-engine/src/filtros-padrao.ts';
import { loadDashboards } from '../../packages/widget-engine/src/spec.ts';
import { segmentacaoDe } from '../src/calcula.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('toda página com hierarquia de data tem a árvore de período, na mesma coluna', () => {
  const faltando: string[] = [];
  for (const d of loadDashboards(path.join(ROOT, 'backend', 'specs'))) {
    for (const v of d.visuals ?? []) {
      const s = segmentacaoDe(v);
      if (!s?.niveis) continue;
      const data = dataDaPagina(d.id);
      if (!data || data.tabela !== s.tabela || data.coluna !== s.coluna) {
        faltando.push(`${d.id}: ${s.tabela}[${s.coluna}] (${s.niveis.join('/')}) — árvore: ${JSON.stringify(data)}`);
      }
    }
  }
  assert.deepEqual(faltando, [], 'Acrescente a página em POR_PAGINA (filtros-padrao.ts).');
});
