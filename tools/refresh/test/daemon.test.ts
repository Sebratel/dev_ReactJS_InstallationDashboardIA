import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { executaCiclo } from '../src/daemon.ts';
import type { GrupoDeRefresh } from '../src/grupos.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DAEMON = path.join(ROOT, 'tools', 'refresh', 'src', 'daemon.ts');

function roda(args: string[]): { status: number | null; saida: string } {
  const r = spawnSync(process.execPath, [DAEMON, ...args], { cwd: ROOT, encoding: 'utf8' });
  return { status: r.status, saida: (r.stdout ?? '') + (r.stderr ?? '') };
}

test('daemon.ts: executaCiclo em modo --so-plano identifica grupos sem executar subprocesso', async () => {
  const res = await executaCiclo({
    raiz: ROOT,
    soPlano: true,
  });

  assert.equal(res.houveExecucao, false);
  assert.equal(res.houveFalha, false);
  assert.ok(res.resultados.length >= 3, 'deve conter pelo menos quente, medio e frio');
  const quente = res.resultados.find((r) => r.id === 'quente');
  assert.ok(quente, 'grupo quente deve estar presente');
});

test('daemon.ts: executaCiclo com mock de roda executa grupos vencidos', async () => {
  const rodados: string[] = [];
  const res = await executaCiclo({
    raiz: ROOT,
    roda: (g: GrupoDeRefresh) => {
      rodados.push(g.id);
      return { ok: true };
    },
  });

  assert.ok(res.resultados.length >= 3);
  assert.equal(res.houveFalha, false);
});

test('daemon.ts CLI: --so-plano --so-uma-vez executa e sai com código 0', () => {
  const { status, saida } = roda(['--so-plano', '--so-uma-vez']);
  assert.equal(status, 0, saida);
  assert.match(saida, /\[Refresh Daemon\] Agendador automático iniciado/);
  assert.match(saida, /quente: (vencido|não vencido)/);
});

test('daemon.ts CLI: recusa argumento desconhecido', () => {
  const { status, saida } = roda(['--invalido']);
  assert.equal(status, 2, saida);
  assert.match(saida, /argumento desconhecido: --invalido/);
});
