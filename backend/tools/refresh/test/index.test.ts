// Fumaça de CLI, no mesmo espírito de backend/tools/snapshot/test/cli.test.ts: só
// `--plano`, que não spawna filho nenhum nem toca `snapshot/refresh-status.json`.
// A lógica de decisão (o que está vencido, série dentro do tick, persistência
// incremental) já está inteira em tick.test.ts, sem precisar de subprocesso.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const INDEX = path.join(ROOT, 'backend', 'tools', 'refresh', 'src', 'index.ts');

function roda(args: string[]): { status: number | null; saida: string } {
  const r = spawnSync(process.execPath, [INDEX, ...args], { cwd: ROOT, encoding: 'utf8' });
  return { status: r.status, saida: (r.stdout ?? '') + (r.stderr ?? '') };
}

test('index.ts --plano carrega, valida o refresh.yaml real e não crasha', () => {
  const { status, saida } = roda(['--plano']);
  assert.equal(status, 0, saida);
  assert.match(saida, /grupo\(s\) declarado\(s\)/);
});

test('index.ts recusa argumento desconhecido', () => {
  const { status, saida } = roda(['--bogus']);
  assert.equal(status, 2, saida);
  assert.match(saida, /argumento desconhecido: --bogus/);
});
