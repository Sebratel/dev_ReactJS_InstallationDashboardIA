// `npm run seguranca:inventario -- [TABELA ...]` — onde cada coluna do modelo é usada
// (S6 de docs/PLANO-SEGURANCA.md). Sem argumento, todas as tabelas. Lê só as specs e o
// código: não toca banco nem `snapshot/`, e nunca imprime valor de linha.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { usoDeColunas } from './uso-de-colunas.ts';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const tabelas = process.argv.slice(2);
const uso = usoDeColunas(raiz);
const dir = path.join(raiz, 'backend', 'specs', '_catalog', 'tables');

for (const f of fs.readdirSync(dir).sort()) {
  const t = parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { name: string; columns?: { name: string }[] };
  if (tabelas.length > 0 && !tabelas.includes(t.name)) continue;
  for (const c of t.columns ?? []) {
    const onde = [...new Set(uso(t.name, c.name).map((u) => u.onde))];
    const resumo = onde.length === 0 ? 'NENHUM USO' : onde.slice(0, 3).join(' ; ') + (onde.length > 3 ? ` (+${onde.length - 3})` : '');
    console.log(`${t.name} | ${c.name} | ${resumo}`);
  }
}
