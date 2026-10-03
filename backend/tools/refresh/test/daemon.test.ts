import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { executaCiclo } from '../src/daemon.ts';
import type { GrupoDeRefresh } from '../src/grupos.ts';
import { leHistorico } from '../src/historico.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const DAEMON = path.join(ROOT, 'backend', 'tools', 'refresh', 'src', 'daemon.ts');

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

// `snapshotDir` EXPLÍCITO, e temporário. Sem ele, `executaCiclo` cai no padrão
// `path.join(raiz, 'snapshot')` — o snapshot REAL — e `persiste` sobrescreve o
// `refresh-status.json` de produção com três "sucessos" de 0 ms que não
// materializaram nada. Foi o que aconteceu em 16/09/2026: `npm test` às 08:13
// carimbou quente/medio/frio como recém-bem-sucedidos enquanto o dado em disco era
// das 02:57, `GET /api/saude` passou a mentir que o refresh estava saudável, e o
// próximo tick de verdade ainda esperaria o intervalo inteiro antes de rodar
// (`estaVencido` mede a idade do último SUCESSO). O `roda` mockado é o que torna
// isso invisível: ele devolve `ok` sem tocar em banco nenhum.
test('daemon.ts: executaCiclo com mock de roda executa grupos vencidos', async () => {
  const rodados: string[] = [];
  const res = await executaCiclo({
    raiz: ROOT,
    snapshotDir: fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-daemon-')),
    roda: (g: GrupoDeRefresh) => {
      rodados.push(g.id);
      return { ok: true };
    },
  });

  assert.ok(res.resultados.length >= 3);
  assert.equal(res.houveFalha, false);
});

test('daemon.ts: grupo em espera por falhas não roda e fica no histórico como grupo-adiado', async () => {
  // O caminho do Docker (o serviço `refresh` roda este daemon). ACHADOS #153: sem a
  // espera, `medio`/`frio` refaziam ~9 min de carga a cada 15 min para falhar igual.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-daemon-'));
  const agora = new Date().toISOString();
  const verde = { ultimaTentativa: agora, ultimoSucesso: agora, duracaoMs: 1, ok: true, falhasConsecutivas: 0 };
  const caido = { ultimaTentativa: agora, ultimoSucesso: null, duracaoMs: 1, ok: false, falhasConsecutivas: 2 };
  fs.writeFileSync(path.join(dir, 'refresh-status.json'), JSON.stringify({ quente: verde, medio: caido, frio: verde }));

  const rodados: string[] = [];
  const res = await executaCiclo({
    raiz: ROOT,
    snapshotDir: dir,
    roda: (g: GrupoDeRefresh) => {
      rodados.push(g.id);
      return { ok: true };
    },
  });

  assert.deepEqual(rodados, [], 'quente e frio estão frescos, medio está em espera');
  assert.ok(res.resultados.find((r) => r.id === 'medio')?.adiadoAte);
  const eventos = leHistorico(dir);
  assert.ok(eventos.some((e) => e.evento === 'grupo-adiado' && e.grupo === 'medio' && e.falhasConsecutivas === 2));
  fs.rmSync(dir, { recursive: true, force: true });
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
